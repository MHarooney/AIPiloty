"""Phase B — message router unit tests (CONFIRMATION, CLARIFY, modes, tools)."""

from __future__ import annotations

import pytest

from app.services.agent.message_router import (
    MessageRoute,
    normalize_user_message,
    route_message,
)
from app.services.agent.pending_actions import PendingActionStore
from app.services.agent.tool_selector import MAX_TOOLS, resolve_tool_name, select_progressive_tools
from app.services.agent.intent_classifier import Intent
from app.services.tools.base import BaseTool, ToolResult
from app.services.tools.registry import ToolRegistry


@pytest.mark.parametrize(
    "msg,expected",
    [
        ("hello", MessageRoute.SMALLTALK),
        ("Hi!!!", MessageRoute.SMALLTALK),
        ("  thanks  ", MessageRoute.SMALLTALK),
        ("bye", MessageRoute.SMALLTALK),
        ("good morning", MessageRoute.SMALLTALK),
    ],
)
def test_greetings_are_smalltalk(msg: str, expected: MessageRoute) -> None:
    r = route_message(msg)
    assert r.route == expected
    assert r.static_reply


@pytest.mark.parametrize(
    "msg",
    ["yes", "no", "ok", "okay", "sure", "cool", "got it"],
)
def test_acknowledgements_are_general_qa_not_static(msg: str) -> None:
    r = route_message(msg, has_pending_action=False)
    assert r.route == MessageRoute.GENERAL_QA
    assert r.static_reply is None
    assert r.reason == "acknowledgement"


@pytest.mark.parametrize(
    "msg",
    [
        "who are you?",
        "are you a robot",
        "what is AIPiloty",
        "explain recursion in simple words",
    ],
)
def test_identity_and_concepts_are_general_qa(msg: str) -> None:
    r = route_message(msg)
    assert r.route == MessageRoute.GENERAL_QA
    assert r.static_reply is None


@pytest.mark.parametrize(
    "msg",
    [
        "ssh into the server and check disk",
        "deploy the frontend",
        "generate a pdf about taxes",
        "list my ollama models",
        "run docker ps on the host",
    ],
)
def test_tasks_are_agent(msg: str) -> None:
    r = route_message(msg, mode="auto")
    assert r.route == MessageRoute.AGENT_TASK
    assert r.intent is not None
    assert r.intent.suggested_tools


def test_normalize_strips_punctuation() -> None:
    assert normalize_user_message("Hello!!!") == "hello"
    assert normalize_user_message("  Hi  ") == "hi"


# ── Phase B: modes ───────────────────────────────────────────────────────


def test_ask_mode_forces_general_qa_even_for_tasks() -> None:
    r = route_message("deploy the frontend to production", mode="ask")
    assert r.route == MessageRoute.GENERAL_QA
    assert r.reason == "mode_ask"
    assert r.mode == "ask"


def test_ask_mode_still_allows_greetings() -> None:
    r = route_message("hello", mode="ask")
    assert r.route == MessageRoute.SMALLTALK


def test_agent_mode_routes_tasks() -> None:
    r = route_message("check disk on the server", mode="agent")
    assert r.route == MessageRoute.AGENT_TASK
    assert "mode_agent" in r.reason


def test_agent_mode_clarifies_ambiguous_short() -> None:
    r = route_message("stuff", mode="agent")
    assert r.route == MessageRoute.CLARIFY
    assert r.static_reply


def test_agent_mode_answers_identity_questions() -> None:
    r = route_message("who are you?", mode="agent")
    assert r.route == MessageRoute.GENERAL_QA


def test_vague_prompt_clarifies() -> None:
    r = route_message("help", mode="auto")
    assert r.route == MessageRoute.CLARIFY
    assert r.static_reply


# ── Phase B: confirmation ────────────────────────────────────────────────


def test_yes_with_pending_is_confirmation_affirm() -> None:
    r = route_message("yes", has_pending_action=True)
    assert r.route == MessageRoute.CONFIRMATION
    assert r.confirmation == "affirm"


def test_no_with_pending_is_confirmation_deny() -> None:
    r = route_message("no", has_pending_action=True)
    assert r.route == MessageRoute.CONFIRMATION
    assert r.confirmation == "deny"
    assert r.static_reply


def test_pending_store_set_get_pop() -> None:
    store = PendingActionStore()
    store.set("s1", tool_name="ssh_command", arguments={"cmd": "df -h"}, risk_level="high")
    assert store.has("s1")
    got = store.get("s1")
    assert got is not None
    assert got.tool_name == "ssh_command"
    popped = store.pop("s1")
    assert popped is not None
    assert not store.has("s1")


# ── Phase B: progressive tools ───────────────────────────────────────────


class _DummyTool(BaseTool):
    name = "dummy"
    description = "dummy"
    category = "test"
    risk_level = "low"

    def __init__(self, name: str):
        self.name = name

    async def execute(self, **kwargs) -> ToolResult:  # type: ignore[override]
        return ToolResult(success=True, output="ok")


def test_resolve_tool_alias() -> None:
    assert resolve_tool_name("search_knowledge") == "kb_search"
    assert resolve_tool_name("ssh_command") == "ssh_command"


def test_select_progressive_tools_caps_and_prefers_intent() -> None:
    reg = ToolRegistry()
    names = [
        "ssh_command",
        "vm_health_check",
        "diagnose_vm",
        "get_host_environment",
        "deploy",
        "run_terminal_command",
        "get_platform_stats",
        "create_plan",
        "web_search",
        "fetch_url",
        "kb_search",
        "generate_pdf",
        "write_file",
        "apply_patch",
        "list_host_path",
        "verify_ollama_models",
    ]
    for n in names:
        reg.register(_DummyTool(n))

    intent = Intent(
        category="vm",
        confidence=0.5,
        suggested_tools=["ssh_command", "vm_health_check"],
        context_hints={},
    )
    selected = select_progressive_tools(reg, intent)
    assert 1 <= len(selected) <= MAX_TOOLS
    selected_names = [t.name for t in selected]
    assert "ssh_command" in selected_names
    assert "vm_health_check" in selected_names
    assert len(selected_names) == len(set(selected_names))
