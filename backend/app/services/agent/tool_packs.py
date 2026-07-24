"""Named tool packs (Phase C) — MCP-style domain gating.

Each pack is a curated allowlist. Progressive loading picks ONE primary pack
(+ a tiny read-only core), never the full ~20+ tool catalog.
"""

from __future__ import annotations

import re
from typing import Optional

from .intent_classifier import Intent

# Tiny always-safe companions (no writes, no SSH, no deploy)
READ_CORE: list[str] = [
    "get_platform_stats",
    "ensure_missions",
    "kb_search",
    "create_plan",
]

# Domain packs — keep write/mutate tools out of read/query packs
TOOL_PACKS: dict[str, list[str]] = {
    "ollama": [
        "verify_ollama_models",
        "get_platform_stats",
        "get_host_environment",
    ],
    "stats": [
        "get_platform_stats",
        "ensure_missions",
        "verify_ollama_models",
        "get_host_environment",
    ],
    "vm_read": [
        "vm_health_check",
        "diagnose_vm",
        "ensure_missions",
        "get_host_environment",
    ],
    "vm_shell": [
        "ssh_command",
        "vm_health_check",
        "diagnose_vm",
        "ensure_missions",
        "get_host_environment",
    ],
    "deploy": [
        "deploy",
        "ensure_missions",
        "vm_health_check",
        "ssh_command",
    ],
    "mission": [
        "ensure_missions",
        "get_platform_stats",
        "vm_health_check",
        "create_plan",
    ],
    "devops_local": [
        "run_terminal_command",
        "list_host_path",
        "get_host_environment",
        "verify_ollama_models",
    ],
    "code_read": [
        "list_host_path",
        "get_host_environment",
    ],
    "code_write": [
        "write_file",
        "apply_patch",
        "list_host_path",
        "run_terminal_command",
    ],
    "document": [
        "generate_pdf",
        "generate_xlsx",
        "generate_docx",
        "generate_pptx",
    ],
    "image": [
        "generate_image",
    ],
    "knowledge": [
        "kb_search",
        "web_search",
        "fetch_url",
    ],
    "search": [
        "web_search",
        "fetch_url",
        "kb_search",
    ],
    "planning": [
        "create_plan",
        "web_search",
        "kb_search",
    ],
}

# Category → default pack (overridden by message heuristics)
_CATEGORY_PACK: dict[str, str] = {
    "vm": "vm_shell",
    "deployment": "deploy",
    "mission": "mission",
    "devops": "devops_local",
    "code": "code_read",
    "document": "document",
    "image": "image",
    "knowledge": "knowledge",
    "search": "search",
    "planning": "planning",
    "stats": "stats",
}

_WRITE_CODE_RE = re.compile(
    r"\b(write|edit|patch|create|implement|refactor|apply)\b",
    re.I,
)
_SSH_RE = re.compile(r"\b(ssh|shell into|connect to)\b", re.I)
_OLLAMA_RE = re.compile(
    r"\b(ollama|llama|gemma|mistral)\b|\blist\s+(my\s+)?(local\s+)?models?\b",
    re.I,
)
_HEALTH_ONLY_RE = re.compile(
    r"\b(health|status|uptime|disk|memory|cpu|diagnose|troubleshoot)\b",
    re.I,
)
_MISSION_SEED_RE = re.compile(
    r"\b(seed|ensure|register)\b.*\b(mission|deployment|tenant|board)\b"
    r"|\b(mission|deployment|tenant)\b.*\b(seed|ensure|register)\b"
    r"|\bmission\s*board\b"
    r"|\b(all|everything)\b.*\b(mission|deployment|board|container)\b"
    r"|\b(put|add)\s+them\b.*\b(mission|board)\b"
    r"|\bensure\s+that\s+they\b"
    r"|\blms-test\b|\bevolms-test\b|\bensure\s+lms\b"
    r"|^\s*(everything|all(\s+of\s+them)?)\s*$",
    re.I,
)
_IMAGE_RE = re.compile(
    r"\b(image|picture|photo|illustration|cover\s*art|course\s+cover)\b"
    r"|\b(generate|create|make)\s+(an?\s+)?(image|picture|photo|illustration|cover)\b",
    re.I,
)
_MERMAID_STRUCTURAL_RE = re.compile(
    r"\b(mermaid|flowchart|mindmap|mind\s*map|gantt|xychart(-beta)?|"
    r"pie\s*chart|bar\s*chart|line\s*chart|xy\s*chart|sequence\s*diagram|"
    r"er\s*diagram|architecture\s*diagram)\b"
    r"|\b(show|draw|make|render|create)\s+(a\s+|an\s+)?(mermaid\s+)?"
    r"(pie|bar|line|gantt|flow|mind\s*map|chart|diagram)\b",
    re.I,
)
_RESEARCH_TABLE_RE = re.compile(
    r"\b(markdown\s+table|pipe\s+table|comparison\s+table)\b"
    r"|\bcompar(?:e|ison)\b.*\btable\b"
    r"|\btable\b.*\bcompar(?:e|ison)\b"
    r"|\bin\s+a\s+(markdown\s+)?table\b"
    r"|\b(show|make|create|render)\s+(a\s+|an\s+)?(comparison\s+)?table\b"
    r"|\bcompar(?:e|ison)\b.+\b(vs\.?|versus|,|and|with)\b"
    r"|\bwhich\s+is\s+better\b.+\b(vs\.?|or|and)\b"
    r"|\b(pros?\s*(?:&|and)\s*cons?)\b.+\b(of|for|vs\.?|versus)\b",
    re.I,
)


def resolve_pack_name(intent: Optional[Intent], message: str = "") -> str:
    """Pick the safest pack that still covers the user intent."""
    msg = message or ""

    # Comparison / research tables → live web search (never static KB, never image pack)
    if _RESEARCH_TABLE_RE.search(msg) or (
        intent and (intent.context_hints or {}).get("rich_visual") == "research_table"
    ):
        return "search"

    # Mermaid diagrams → planning pack if agent somehow runs (usually GENERAL_QA)
    if _MERMAID_STRUCTURAL_RE.search(msg):
        return "planning"

    # High-signal message overrides (order matters)
    if _MISSION_SEED_RE.search(msg):
        return "mission"
    if _IMAGE_RE.search(msg) and not _MERMAID_STRUCTURAL_RE.search(msg):
        return "image"
    if _OLLAMA_RE.search(msg):
        return "ollama"
    if intent and intent.category == "code" and _WRITE_CODE_RE.search(msg):
        return "code_write"
    if intent and intent.category == "vm":
        if _SSH_RE.search(msg):
            return "vm_shell"
        if _HEALTH_ONLY_RE.search(msg) and not _SSH_RE.search(msg):
            return "vm_read"
        return "vm_shell"
    if intent and intent.category in _CATEGORY_PACK:
        return _CATEGORY_PACK[intent.category]
    if intent and intent.suggested_tools:
        # Map first suggested tool to a pack
        t0 = intent.suggested_tools[0]
        for pack, tools in TOOL_PACKS.items():
            if t0 in tools or t0.replace("search_knowledge", "kb_search") in tools:
                return pack
    return "search"


def pack_tool_names(pack: str, *, include_core: bool = True) -> list[str]:
    names = list(TOOL_PACKS.get(pack, TOOL_PACKS["search"]))
    if include_core:
        names = names + list(READ_CORE)
    # Dedupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return out


def mcp_category_gate(tool_category: str, pack: str) -> bool:
    """Whether a registry tool category is allowed for this pack.

    Used to gate dynamically registered MCP tools so a document pack
    does not pull in unrelated MCP servers.
    """
    allowed = {
        "ollama": {"host", "stats", "general", "platform"},
        "stats": {"host", "stats", "general", "platform", "devops"},
        "mission": {"devops", "deployment", "stats", "general", "platform"},
        "vm_read": {"devops", "vm", "host", "general"},
        "vm_shell": {"devops", "vm", "host", "general"},
        "deploy": {"devops", "deployment", "vm", "general"},
        "devops_local": {"host", "devops", "general"},
        "code_read": {"code", "host", "general"},
        "code_write": {"code", "host", "general"},
        "document": {"document", "documents", "generation", "general"},
        "image": {"image", "documents", "generation", "general"},
        "knowledge": {"knowledge", "search", "research", "general"},
        "search": {"search", "research", "knowledge", "web", "general"},
        "planning": {"planning", "knowledge", "search", "general"},
    }.get(pack, {"general"})
    cat = (tool_category or "general").lower()
    return cat in allowed or cat == "mcp"
