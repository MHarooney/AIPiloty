"""Intent classifier — categorize user messages for optimal tool routing.

Phase 2 (2026-07-17): Added ``needs_retrieval()`` for Self-RAG intent-gated
retrieval.  Purely conversational messages skip the RAG pipeline entirely,
reducing latency and avoiding irrelevant context injection.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class Intent:
    """Classified intent from user message."""

    category: str  # devops, deployment, vm, knowledge, code, general, planning, search
    confidence: float  # 0..1
    suggested_tools: list[str]
    context_hints: dict[str, str]


# ── Conversational patterns that never need RAG ───────────────────────────
# Short social exchanges where KB retrieval would add noise and latency.
_CONVERSATIONAL_RE = re.compile(
    r"^\s*("
    r"(hi|hello|hey|howdy|yo)\b[!?. ]*|"
    r"thank(s| you)[!?. ]*|"
    r"ok(ay)?[!?. ]*|"
    r"great[!?. ]*|"
    r"perfect[!?. ]*|"
    r"got it[!?. ]*|"
    r"understood[!?. ]*|"
    r"sounds good[!?. ]*|"
    r"cool[!?. ]*|"
    r"nice[!?. ]*|"
    r"awesome[!?. ]*|"
    r"sure[!?. ]*|"
    r"yes[!?. ]*|"
    r"no[!?. ]*|"
    r"bye[!?. ]*|"
    r"good(bye|night|morning|evening|afternoon)[!?. ]*"
    r")\s*$",
    re.IGNORECASE,
)

# Categories that should always trigger RAG (factual / technical)
_ALWAYS_RETRIEVE_CATEGORIES = frozenset({
    "knowledge", "vm", "deployment", "devops", "planning", "stats",
})

# Pattern → (category, tools, confidence_boost)
_PATTERNS: list[tuple[re.Pattern, str, list[str], float]] = [
    # VM / Server
    (re.compile(r"\b(ssh|vm|server|vps|machine|host|connect)\b", re.I), "vm", ["ssh_command", "vm_health_check"], 0.3),
    (re.compile(r"\b(health|status|check|monitor|uptime|disk|memory|cpu)\b", re.I), "vm", ["vm_health_check"], 0.2),
    (re.compile(r"\b(diagnose|troubleshoot|debug|fix|issue|problem|error)\b", re.I), "vm", ["diagnose_vm"], 0.3),
    # Deployment
    (re.compile(r"\b(deploy|deployment|pipeline|build|release|rollback)\b", re.I), "deployment", ["deploy"], 0.4),
    (re.compile(r"\b(docker|container|compose|service)\b", re.I), "deployment", ["ssh_command"], 0.2),
    # Knowledge / RAG
    (re.compile(r"\b(knowledge|document|search|find|lookup|rag)\b", re.I), "knowledge", ["search_knowledge"], 0.3),
    (re.compile(r"\b(ingest|upload|index)\b", re.I), "knowledge", ["search_knowledge"], 0.2),
    # Code
    (re.compile(r"\b(code|file|write|edit|patch|create|workspace)\b", re.I), "code", ["write_file", "apply_patch"], 0.3),
    (re.compile(r"\b(list|browse|tree|directory)\b", re.I), "code", ["list_host_path"], 0.2),
    # Documents
    (re.compile(r"\b(pdf|xlsx|excel|docx|word|pptx|powerpoint|generate|report)\b", re.I), "document", ["generate_pdf", "generate_xlsx", "generate_docx", "generate_pptx"], 0.4),
    # Image
    (re.compile(r"\b(image|picture|photo|draw|illustration)\b", re.I), "image", ["generate_image"], 0.4),
    # Web / Research
    (re.compile(r"\b(search|google|look\s*up|research|find\s+out|recommend)\b", re.I), "search", ["web_search", "fetch_url"], 0.3),
    (re.compile(r"https?://", re.I), "search", ["fetch_url"], 0.5),
    # Planning
    (re.compile(r"\b(plan|strategy|steps|roadmap|how\s+to|guide|migration)\b", re.I), "planning", ["create_plan"], 0.3),
    # Stats
    (re.compile(r"\b(stats|statistics|overview|dashboard|summary|platform)\b", re.I), "stats", ["get_platform_stats"], 0.3),
    # Terminal / local
    (re.compile(r"\b(run|execute|terminal|command|shell|bash)\b", re.I), "devops", ["run_terminal_command"], 0.2),
]


class IntentClassifier:
    """Rule-based intent classifier for routing user messages to tools.

    Phase 2: ``needs_retrieval()`` implements Self-RAG intent gating —
    the decision whether to invoke the RAG pipeline before answering.
    """

    def classify(self, message: str) -> Intent:
        scores: dict[str, float] = {}
        tools: dict[str, list[str]] = {}
        hints: dict[str, str] = {}

        for pattern, category, suggested, boost in _PATTERNS:
            match = pattern.search(message)
            if match:
                scores[category] = scores.get(category, 0) + boost
                tools.setdefault(category, []).extend(suggested)
                hints[category] = match.group(0)

        if not scores:
            return Intent(category="general", confidence=0.5, suggested_tools=[], context_hints={})

        # Pick highest scoring category
        best_cat = max(scores, key=scores.get)  # type: ignore[arg-type]
        confidence = min(scores[best_cat], 1.0)
        unique_tools = list(dict.fromkeys(tools.get(best_cat, [])))

        return Intent(
            category=best_cat,
            confidence=round(confidence, 2),
            suggested_tools=unique_tools,
            context_hints=hints,
        )

    def needs_retrieval(self, message: str, intent: Optional[Intent] = None) -> bool:
        """Decide whether the RAG pipeline should run before answering.

        Self-RAG gating:
          - Purely conversational messages → skip RAG (returns False).
          - High-confidence factual/technical intents → always retrieve (True).
          - Everything else → retrieve (safe default).

        Args:
            message: The latest user message (already stripped).
            intent:  Pre-computed Intent (pass to avoid double-classifying).

        Returns:
            True  → run RAG before answering.
            False → answer directly from LLM knowledge / tool results.
        """
        # Conversational short-circuits — never need KB context
        if _CONVERSATIONAL_RE.match(message.strip()):
            logger.debug("Self-RAG: skipping retrieval for conversational message %r", message[:40])
            return False

        if intent is None:
            intent = self.classify(message)

        # Technical / factual categories always benefit from KB context
        if intent.category in _ALWAYS_RETRIEVE_CATEGORIES:
            return True

        # Very short messages with high-confidence non-factual intent → skip
        if len(message.split()) <= 5 and intent.category == "general" and intent.confidence > 0.7:
            return False

        return True  # safe default


# Module-level logger (imported after class so it can be used in method bodies)
import logging  # noqa: E402
logger = logging.getLogger(__name__)
