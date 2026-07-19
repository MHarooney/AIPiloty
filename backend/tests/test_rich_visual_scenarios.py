"""Golden scenarios for rich visuals — charts, live research tables, no fake tools."""
from __future__ import annotations

import pytest

from app.services.agent.diagram_reply import (
    RESEARCH_TABLE_ADDENDUM,
    is_document_file_tool,
    is_markdown_only_tool,
    looks_like_markdown_pipe_table,
    markdown_only_tool_nudge,
    research_table_document_nudge,
    strip_mermaid_fence_around_pipe_tables,
    try_synthesize_rich_visual_reply,
)
from app.services.agent.intent_classifier import IntentClassifier
from app.services.agent.message_router import MessageRoute, route_message
from app.services.agent.tool_packs import resolve_pack_name


MERMAID_SCENARIOS = [
    (
        "Create a Mermaid xychart-beta bar chart of monthly deploys: Jan 12, Feb 18, Mar 9, Apr 22.",
        "xychart",
    ),
    (
        "Show a Mermaid pie chart of team time: coding 40%, meetings 25%, reviews 20%, docs 15%.",
        "pie",
    ),
    (
        "Draw a Mermaid flowchart for login: start → credentials → MFA → session.",
        "flow",
    ),
]


@pytest.mark.parametrize("msg,kind", MERMAID_SCENARIOS)
def test_mermaid_routes_general_qa_no_tools(msg: str, kind: str):
    routed = route_message(msg, mode="auto")
    assert routed.route == MessageRoute.GENERAL_QA, kind
    assert routed.reason in ("structured_diagram", "mode_ask_diagram")
    routed_agent = route_message(msg, mode="agent")
    assert routed_agent.route == MessageRoute.GENERAL_QA


def test_compare_table_routes_agent_with_search():
    msg = (
        "Compare gpt-image-1, Gemini Flash Image, and DALL·E 3 in a markdown table "
        "(speed, quality, best for, notes)."
    )
    routed = route_message(msg, mode="auto")
    assert routed.route == MessageRoute.AGENT_TASK
    assert routed.reason == "research_table"
    assert routed.static_reply is None
    assert routed.intent is not None
    assert routed.intent.category == "search"
    assert resolve_pack_name(routed.intent, msg) == "search"

    # Agent mode still researches (never a hardcoded table)
    routed_agent = route_message(msg, mode="agent")
    assert routed_agent.route == MessageRoute.AGENT_TASK
    assert routed_agent.reason == "research_table"


def test_ask_mode_table_stays_general_qa_no_static_kb():
    msg = "Compare gpt-image-1 and Gemini Flash Image in a Markdown table"
    routed = route_message(msg, mode="ask")
    assert routed.route == MessageRoute.GENERAL_QA
    assert routed.reason == "mode_ask_table"
    assert routed.static_reply is None


def test_xychart_static_reply():
    msg = (
        "Create a Mermaid xychart-beta bar chart of monthly deploys: "
        "Jan 12, Feb 18, Mar 9, Apr 22."
    )
    routed = route_message(msg, mode="auto")
    assert routed.static_reply
    assert "bar [12, 18, 9, 22]" in routed.static_reply
    assert "```mermaid" in routed.static_reply


def test_pie_static_reply():
    msg = "Show a Mermaid pie chart: coding 40%, meetings 25%"
    reply = try_synthesize_rich_visual_reply(msg)
    assert reply
    assert '"Coding" : 40' in reply
    assert "%" not in reply.split("```mermaid")[1]


def test_generate_table_is_markdown_only_alias():
    assert is_markdown_only_tool("generate_table")
    assert is_markdown_only_tool("Generate_Table")
    nudge = markdown_only_tool_nudge("generate_table")
    assert "Markdown" in nudge
    assert "no generate_table" in nudge.lower() or "There is no generate_table" in nudge


def test_research_table_blocks_pdf_nudge():
    assert is_document_file_tool("generate_pdf")
    assert is_document_file_tool("generate_docx")
    assert not is_document_file_tool("web_search")
    msg = research_table_document_nudge("generate_pdf")
    assert "Markdown" in msg
    assert "generate_pdf" in msg
    assert "mermaid" in msg.lower()


def test_research_table_addendum_forbids_mermaid_around_tables():
    assert "mermaid" in RESEARCH_TABLE_ADDENDUM.lower()
    assert "pipe" in RESEARCH_TABLE_ADDENDUM.lower()
    assert "generate_pdf" in RESEARCH_TABLE_ADDENDUM.lower()


def test_strip_mermaid_fence_around_pipe_tables():
    md = (
        "Here is the comparison:\n\n"
        "```mermaid\n"
        "| Model | Speed |\n"
        "|---|---|\n"
        "| A | Fast |\n"
        "| B | Slow |\n"
        "```\n\n"
        "### Quick takeaways\n"
        "- Prefer A for speed.\n"
    )
    assert looks_like_markdown_pipe_table(
        "| Model | Speed |\n|---|---|\n| A | Fast |"
    )
    out = strip_mermaid_fence_around_pipe_tables(md)
    assert "```mermaid" not in out.lower()
    assert "| Model | Speed |" in out
    assert "Quick takeaways" in out


def test_strip_preserves_real_mermaid_diagrams():
    md = "```mermaid\nflowchart TD\n  A-->B\n```"
    assert strip_mermaid_fence_around_pipe_tables(md) == md


def test_table_request_not_document_or_image_intent():
    clf = IntentClassifier()
    msg = "Compare gpt-image-1 and Gemini Flash Image in a Markdown table"
    intent = clf.classify(msg)
    assert intent.category != "image"
    assert intent.category != "document"
    assert "generate_image" not in intent.suggested_tools
    assert resolve_pack_name(intent, msg) == "search"


def test_cover_image_still_image():
    clf = IntentClassifier()
    intent = clf.classify("Generate a course cover image for Accounting")
    assert intent.category == "image"
    assert resolve_pack_name(intent, "Generate a course cover image for Accounting") == "image"


def test_no_static_comparison_kb():
    """Hardcoded product comparison tables must not exist."""
    reply = try_synthesize_rich_visual_reply(
        "Compare gpt-image-1 and Gemini Flash Image in a Markdown table"
    )
    assert reply is None
