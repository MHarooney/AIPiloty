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
        "verify_ollama_models",
        "get_host_environment",
    ],
    "vm_read": [
        "vm_health_check",
        "diagnose_vm",
        "get_host_environment",
    ],
    "vm_shell": [
        "ssh_command",
        "vm_health_check",
        "diagnose_vm",
        "get_host_environment",
    ],
    "deploy": [
        "deploy",
        "vm_health_check",
        "ssh_command",
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
_IMAGE_RE = re.compile(
    r"\b(image|picture|photo|illustration|cover\s*art|course\s+cover)\b"
    r"|\b(generate|create|make)\s+(an?\s+)?(image|picture|photo|illustration|cover)\b",
    re.I,
)


def resolve_pack_name(intent: Optional[Intent], message: str = "") -> str:
    """Pick the safest pack that still covers the user intent."""
    msg = message or ""

    # High-signal message overrides (order matters)
    if _IMAGE_RE.search(msg):
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
        "stats": {"host", "stats", "general", "platform"},
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
