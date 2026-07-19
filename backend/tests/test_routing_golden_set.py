"""Phase C — golden-set routing eval (100+ utterances, CI thresholds).

Offline, no network. Fail the build if accuracy drops below threshold.
"""

from __future__ import annotations

import pytest

from app.services.agent.message_router import MessageRoute, route_message
from app.services.agent.tool_packs import resolve_pack_name
from app.services.agent.tool_selector import select_progressive_tools
from app.services.agent.intent_classifier import IntentClassifier
from app.services.agent.semantic_router import lexical_match
from app.services.tools.base import BaseTool, ToolResult
from app.services.tools.registry import ToolRegistry

pytestmark = pytest.mark.eval

PASS_THRESHOLD = 0.92  # senior bar for keyword+semantic cascade


def _cases() -> list[tuple[str, str, str, MessageRoute]]:
    """(id, mode, message, expected_route)"""
    out: list[tuple[str, str, str, MessageRoute]] = []

    greetings = [
        "hello", "hi", "hey", "thanks", "thank you", "bye", "goodbye",
        "good morning", "good evening", "Hi!!!", "  thanks  ",
    ]
    for i, g in enumerate(greetings):
        out.append((f"G{i}", "auto", g, MessageRoute.SMALLTALK))
        out.append((f"Gask{i}", "ask", g, MessageRoute.SMALLTALK))

    qa = [
        "who are you?",
        "what is AIPiloty",
        "are you a robot",
        "explain recursion in simple words",
        "what is SSH used for in general?",
        "explain blue-green deployment conceptually",
        "how does DNS work conceptually",
        "what does CI/CD mean",
        "difference between TCP and UDP",
        "why is caching useful",
    ]
    for i, q in enumerate(qa):
        out.append((f"Q{i}", "auto", q, MessageRoute.GENERAL_QA))
        out.append((f"Qag{i}", "agent", q, MessageRoute.GENERAL_QA))

    acks = ["yes", "no", "ok", "okay", "sure", "cool", "got it"]
    for i, a in enumerate(acks):
        out.append((f"A{i}", "auto", a, MessageRoute.GENERAL_QA))

    clarify = ["help", "fix", "stuff", "do it", "something"]
    for i, c in enumerate(clarify):
        out.append((f"C{i}", "auto", c, MessageRoute.CLARIFY))
    out.append(("Cag0", "agent", "stuff", MessageRoute.CLARIFY))

    # Ask mode forces QA even for task-shaped text
    ask_tasks = [
        "deploy the frontend",
        "ssh into the server",
        "generate a pdf about taxes",
        "list my ollama models",
        "run docker ps",
    ]
    for i, t in enumerate(ask_tasks):
        out.append((f"ASK{i}", "ask", t, MessageRoute.GENERAL_QA))

    # Real agent tasks
    tasks = [
        "list my ollama models",
        "generate a pdf about taxes",
        "deploy the frontend",
        "ssh into the server and check disk",
        "check disk on the server",
        "run docker ps on the host",
        "search the knowledge base for nginx",
        "write a file in the workspace called notes.md",
        "create a plan for a database migration",
        "generate an xlsx report of users",
        "fetch https://example.com and summarize",
        "diagnose the vm health issues",
    ]
    for i, t in enumerate(tasks):
        out.append((f"T{i}", "auto", t, MessageRoute.AGENT_TASK))
        out.append((f"Tag{i}", "agent", t, MessageRoute.AGENT_TASK))

    # Extra fuzzy / edge
    extras = [
        ("E0", "auto", "whats up", MessageRoute.SMALLTALK),
        ("E1", "auto", "thx", MessageRoute.SMALLTALK),
        ("E2", "auto", "howdy", MessageRoute.SMALLTALK),
        ("E3", "auto", "please", MessageRoute.CLARIFY),
        ("E4", "auto", "continue", MessageRoute.CLARIFY),
        ("E5", "auto", "What is Kubernetes in plain English?", MessageRoute.GENERAL_QA),
        ("E6", "auto", "how do load balancers work in general", MessageRoute.GENERAL_QA),
        ("E7", "agent", "hiya", MessageRoute.SMALLTALK),
        ("E8", "auto", "verify ollama models on this machine", MessageRoute.AGENT_TASK),
        ("E9", "auto", "show platform stats", MessageRoute.AGENT_TASK),
    ]
    out.extend(extras)

    # Bulk identity / conceptual variants to reach 100+
    for i, topic in enumerate([
        "HTTP", "REST", "GraphQL", "Redis", "Postgres", "Nginx", "TLS",
        "OAuth", "JWT", "Kafka", "gRPC", "Prometheus", "Grafana",
    ]):
        out.append((f"QB{i}", "auto", f"what is {topic} in simple terms?", MessageRoute.GENERAL_QA))
        out.append((f"QC{i}", "ask", f"explain {topic} conceptually", MessageRoute.GENERAL_QA))

    return out


GOLDEN = _cases()


def test_golden_set_size() -> None:
    assert len(GOLDEN) >= 100, f"golden set too small: {len(GOLDEN)}"


def test_golden_set_accuracy() -> None:
    failures = []
    for cid, mode, msg, expected in GOLDEN:
        r = route_message(msg, mode=mode, has_pending_action=False)
        if r.route != expected:
            failures.append(
                f"{cid}: mode={mode} msg={msg!r} expected={expected.value} got={r.route.value} reason={r.reason}"
            )
    accuracy = 1.0 - (len(failures) / len(GOLDEN))
    assert accuracy >= PASS_THRESHOLD, (
        f"routing accuracy {accuracy:.1%} < {PASS_THRESHOLD:.0%}\n"
        + "\n".join(failures[:40])
    )


class _Dummy(BaseTool):
    description = "d"
    category = "general"
    risk_level = "low"
    parameters = []

    def __init__(self, name: str, category: str = "general", risk: str = "low"):
        self.name = name
        self.category = category
        self.risk_level = risk

    async def execute(self, **kwargs) -> ToolResult:  # type: ignore[override]
        return ToolResult(success=True, output="ok")


def test_ollama_list_uses_ollama_pack_not_write_file() -> None:
    reg = ToolRegistry()
    for n, cat, risk in [
        ("verify_ollama_models", "host", "low"),
        ("get_platform_stats", "stats", "low"),
        ("get_host_environment", "host", "low"),
        ("write_file", "code", "medium"),
        ("apply_patch", "code", "medium"),
        ("list_host_path", "host", "low"),
        ("web_search", "search", "low"),
        ("fetch_url", "search", "low"),
        ("kb_search", "knowledge", "low"),
        ("create_plan", "planning", "low"),
        ("ssh_command", "devops", "high"),
        ("deploy", "deployment", "critical"),
    ]:
        reg.register(_Dummy(n, cat, risk))

    msg = "list my ollama models"
    intent = IntentClassifier().classify(msg)
    assert intent.category == "stats"
    pack = resolve_pack_name(intent, msg)
    assert pack == "ollama"
    tools = select_progressive_tools(reg, intent, message=msg)
    names = [t.name for t in tools]
    assert "verify_ollama_models" in names
    assert "write_file" not in names
    assert "deploy" not in names
    assert "ssh_command" not in names


def test_conceptual_deploy_question_is_general_qa() -> None:
    r = route_message("explain blue-green deployment conceptually", mode="auto")
    assert r.route == MessageRoute.GENERAL_QA


def test_lexical_semantic_match_basics() -> None:
    assert lexical_match("who are you").label == "general_qa"
    assert lexical_match("list my ollama models").label == "agent_task"
    assert lexical_match("help").label == "clarify"
