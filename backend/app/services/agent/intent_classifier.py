"""Intent classifier — categorize user messages for optimal tool routing."""

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
    """Rule-based intent classifier for routing user messages to tools."""

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

    def get_system_prompt_hint(self, intent: Intent) -> Optional[str]:
        """Generate a system prompt hint to guide tool selection."""
        hints = {
            "vm": "The user is asking about servers/VMs. Prefer vm_health_check or diagnose_vm for status, ssh_command for specific operations.",
            "deployment": "The user is asking about deployments. Use the deploy tool for actions.",
            "knowledge": "The user wants to search the knowledge base. Use search_knowledge.",
            "code": "The user wants to work with code/files. Use write_file, apply_patch, or list_host_path.",
            "document": "The user wants to generate a document. Use the appropriate generate_* tool.",
            "image": "The user wants to generate an image. Use generate_image.",
            "search": "The user wants web information. Use web_search or fetch_url.",
            "planning": "The user wants a structured plan. Use create_plan.",
            "stats": "The user wants platform statistics. Use get_platform_stats.",
            "devops": "The user wants to run a local command. Use run_terminal_command.",
        }
        return hints.get(intent.category)
