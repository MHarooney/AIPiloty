"""Progressive tool selection — Phase C tool packs + MCP category gating."""

from __future__ import annotations

from typing import Optional

from ..tools.base import BaseTool
from ..tools.registry import ToolRegistry
from .intent_classifier import Intent
from .tool_packs import (
    mcp_category_gate,
    pack_tool_names,
    resolve_pack_name,
)

_TOOL_ALIASES: dict[str, str] = {
    "search_knowledge": "kb_search",
}

MAX_TOOLS = 12


def resolve_tool_name(name: str) -> str:
    return _TOOL_ALIASES.get(name, name)


def select_progressive_tools(
    registry: ToolRegistry,
    intent: Optional[Intent] = None,
    *,
    message: str = "",
    max_tools: int = MAX_TOOLS,
) -> list[BaseTool]:
    """Return a curated subset of tools for an AGENT_TASK turn.

    Phase C: resolve a named pack first, then optionally admit MCP tools
    whose category is allowed for that pack.
    """
    pack = resolve_pack_name(intent, message)
    candidates: list[str] = []

    # Intent suggested tools first (aliased), but only if in pack or read-core
    pack_names = set(pack_tool_names(pack, include_core=True))
    if intent and intent.suggested_tools:
        for n in intent.suggested_tools:
            rn = resolve_tool_name(n)
            if rn in pack_names or rn in pack_tool_names(pack, include_core=False):
                candidates.append(rn)

    candidates.extend(pack_tool_names(pack, include_core=True))

    seen: set[str] = set()
    selected: list[BaseTool] = []
    for name in candidates:
        if name in seen:
            continue
        seen.add(name)
        tool = registry.get(name)
        if tool is not None:
            selected.append(tool)
        if len(selected) >= max_tools:
            return selected

    # MCP / extra registry tools gated by pack category
    for tool in registry.all_tools():
        if tool.name in seen:
            continue
        if not mcp_category_gate(getattr(tool, "category", "general"), pack):
            continue
        # Never auto-admit high-risk tools outside the pack allowlist
        if getattr(tool, "risk_level", "low") in ("high", "critical"):
            if tool.name not in pack_names:
                continue
        selected.append(tool)
        seen.add(tool.name)
        if len(selected) >= max_tools:
            break

    if not selected:
        # Absolute fallback: stats pack (safe-ish)
        for name in pack_tool_names("stats"):
            tool = registry.get(name)
            if tool is not None:
                selected.append(tool)
            if len(selected) >= max_tools:
                break

    return selected


def selected_pack_name(intent: Optional[Intent] = None, message: str = "") -> str:
    return resolve_pack_name(intent, message)
