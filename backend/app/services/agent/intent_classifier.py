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

    category: str  # devops, deployment, mission, vm, knowledge, code, general, planning, search
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
# Order: high-signal specifics before broad keywords (Phase C).
_PATTERNS: list[tuple[re.Pattern, str, list[str], float]] = [
    # Local models / Ollama (must beat bare "list" → code)
    (
        re.compile(
            r"\blist\s+(my\s+)?(local\s+)?(ollama\s+)?models?\b|\b(ollama|llama|gemma|mistral)\b",
            re.I,
        ),
        "stats",
        ["verify_ollama_models"],
        0.55,
    ),
    # VM / Server
    (re.compile(r"\b(ssh|vm|server|vps|machine|host|connect)\b", re.I), "vm", ["ssh_command", "vm_health_check"], 0.3),
    (re.compile(r"\b(health|status|check|monitor|uptime|disk|memory|cpu)\b", re.I), "vm", ["vm_health_check"], 0.2),
    (re.compile(r"\b(diagnose|troubleshoot|debug|fix|issue|problem|error)\b", re.I), "vm", ["diagnose_vm"], 0.3),
    # Mission seed / register (before generic deploy — DB-only, preferred first step)
    (
        re.compile(
            r"\b(seed|ensure|register)\b.*\b(mission|deployment|tenant|board)\b"
            r"|\b(mission|deployment|tenant)\b.*\b(seed|ensure|register)\b"
            r"|\bmission\s*board\b"
            r"|\b(all|everything)\b.*\b(mission|deployment|board|container)\b"
            r"|\b(put|add)\s+them\b.*\b(mission|board)\b"
            r"|\bensure\s+that\s+they\b"
            r"|\blms-test\b|\bevolms-test\b|\bensure\s+lms\b"
            r"|^\s*(everything|all(\s+of\s+them)?)\s*$",
            re.I,
        ),
        "mission",
        ["ensure_missions"],
        0.7,
    ),
    # Deployment
    (re.compile(r"\b(deploy|deployment|pipeline|build|release|rollback)\b", re.I), "deployment", ["deploy", "ensure_missions"], 0.4),
    (re.compile(r"\b(docker|container|compose|service)\b", re.I), "deployment", ["ssh_command", "ensure_missions"], 0.2),
    # Knowledge / RAG
    (re.compile(r"\b(knowledge|document|search|find|lookup|rag)\b", re.I), "knowledge", ["search_knowledge"], 0.3),
    (re.compile(r"\b(ingest|upload|index)\b", re.I), "knowledge", ["search_knowledge"], 0.2),
    # Code — write vs browse (no bare "list")
    (re.compile(r"\b(code|file|write|edit|patch|create|workspace)\b", re.I), "code", ["write_file", "apply_patch"], 0.3),
    (
        re.compile(r"\b(browse|tree|directory)\b|\blist\s+(files?|paths?|dirs?|directories|folders?)\b", re.I),
        "code",
        ["list_host_path"],
        0.3,
    ),
    # Documents — require a document type word (do NOT match bare "generate")
    (
        re.compile(
            r"\b(pdf|xlsx|excel|docx|word|pptx|powerpoint|spreadsheet|presentation|report)\b"
            r"|\bgenerate\s+(a\s+)?(pdf|xlsx|excel|docx|word|pptx|powerpoint|spreadsheet|presentation|report)\b",
            re.I,
        ),
        "document",
        ["generate_pdf", "generate_xlsx", "generate_docx", "generate_pptx"],
        0.4,
    ),
    # Image — cover / illustration requests (boost above document ties)
    (
        re.compile(
            r"\b(image|picture|photo|draw|illustration|cover\s*art|course\s+cover)\b"
            r"|\b(generate|create|make)\s+(an?\s+)?(image|picture|photo|illustration|cover)\b",
            re.I,
        ),
        "image",
        ["generate_image"],
        0.7,
    ),
    # Web / Research
    (re.compile(r"\b(search|google|look\s*up|research|find\s+out|recommend)\b", re.I), "search", ["web_search", "fetch_url"], 0.3),
    (re.compile(r"https?://", re.I), "search", ["fetch_url"], 0.5),
    # Planning
    (re.compile(r"\b(plan|strategy|steps|roadmap|how\s+to|guide|migration)\b", re.I), "planning", ["create_plan"], 0.3),
    # Stats
    (re.compile(r"\b(stats|statistics|overview|dashboard|summary|platform)\b", re.I), "stats", ["get_platform_stats", "ensure_missions"], 0.3),
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

        # Research comparison tables → prefer search (live facts), never image/document
        _research_table = bool(
            re.search(
                r"\b(markdown\s+table|pipe\s+table|comparison\s+table)\b"
                r"|\bcompar(?:e|ison)\b.*\btable\b"
                r"|\btable\b.*\bcompar(?:e|ison)\b"
                r"|\bin\s+a\s+(markdown\s+)?table\b"
                r"|\b(show|make|create|render)\s+(a\s+|an\s+)?(comparison\s+)?table\b"
                r"|\bcompar(?:e|ison)\b.+\b(vs\.?|versus|,|and|with)\b"
                r"|\bwhich\s+is\s+better\b.+\b(vs\.?|or|and)\b"
                r"|\b(pros?\s*(?:&|and)\s*cons?)\b.+\b(of|for|vs\.?|versus)\b",
                message,
                re.I,
            )
        )
        _mermaid_structural = bool(
            re.search(
                r"\b(mermaid|flowchart|sequence\s*diagram|mind\s*map|mindmap|"
                r"er\s*diagram|gantt|xychart(-beta)?|pie\s*chart|bar\s*chart|line\s*chart|"
                r"xy\s*chart|architecture\s*diagram)\b"
                r"|\b(show|draw|make|render|create)\s+(a\s+|an\s+)?(mermaid\s+)?"
                r"(pie|bar|line|gantt|flow|mind\s*map|chart|diagram)\b",
                message,
                re.I,
            )
        )
        if _research_table or _mermaid_structural:
            scores.pop("image", None)
            tools.pop("image", None)
            hints.pop("image", None)
            scores.pop("document", None)
            tools.pop("document", None)
            hints.pop("document", None)
        if _research_table:
            scores["search"] = max(scores.get("search", 0), 0.9)
            tools.setdefault("search", []).extend(["web_search", "fetch_url", "kb_search"])
            hints["search"] = "research_table"
        elif _mermaid_structural:
            # Diagrams use chat Mermaid — do not open web/search tool loop by default
            scores.pop("search", None)
            tools.pop("search", None)
            hints.pop("search", None)

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
