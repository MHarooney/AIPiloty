"""Diagram / table routing — Mermaid stays tool-free; research tables use search."""
from __future__ import annotations

from app.services.agent.diagram_reply import try_synthesize_mermaid_reply
from app.services.agent.message_router import MessageRoute, route_message
from app.services.agent.tool_packs import resolve_pack_name


def test_xychart_request_routes_general_qa_with_static_mermaid():
    msg = (
        "Create a Mermaid xychart-beta bar chart of monthly deploys: "
        "Jan 12, Feb 18, Mar 9, Apr 22."
    )
    routed = route_message(msg, mode="auto")
    assert routed.route == MessageRoute.GENERAL_QA
    assert routed.reason == "structured_diagram"
    assert routed.static_reply
    assert "```mermaid" in routed.static_reply
    assert "xychart-beta" in routed.static_reply
    assert "bar [12, 18, 9, 22]" in routed.static_reply
    assert "Jan" in routed.static_reply


def test_synthesize_monthly_deploys():
    reply = try_synthesize_mermaid_reply(
        "Mermaid bar chart monthly deploys: Jan 12, Feb 18, Mar 9, Apr 22"
    )
    assert reply is not None
    assert "bar [12, 18, 9, 22]" in reply
    assert "x-axis [Jan, Feb, Mar, Apr]" in reply


def test_agent_mode_still_skips_tools_for_mermaid():
    msg = "Show a Mermaid pie chart of team time: coding 40%, meetings 25%"
    routed = route_message(msg, mode="agent")
    assert routed.route == MessageRoute.GENERAL_QA
    assert routed.static_reply
    assert "Coding" in routed.static_reply


def test_markdown_table_compare_routes_agent_search():
    msg = "Compare gpt-image-1 and Gemini Flash Image in a Markdown table"
    routed = route_message(msg, mode="auto")
    assert routed.route == MessageRoute.AGENT_TASK
    assert routed.reason == "research_table"
    assert routed.static_reply is None
    assert routed.intent is not None
    assert routed.intent.category == "search"
    assert "web_search" in (routed.intent.suggested_tools or [])
    assert resolve_pack_name(routed.intent, msg) == "search"


def test_cover_image_still_agent_capable():
    routed = route_message("Generate a course cover image for Accounting", mode="auto")
    assert routed.reason not in ("structured_diagram", "research_table")


def test_compare_prompt_has_no_static_mermaid_or_table_reply():
    msg = (
        "Compare gpt-image-1, Gemini Flash Image, and DALL·E 3 in a markdown table "
        "(speed, quality, best for, notes)."
    )
    from app.services.agent.diagram_reply import try_synthesize_rich_visual_reply

    assert try_synthesize_rich_visual_reply(msg) is None
    routed = route_message(msg, mode="auto")
    assert routed.static_reply is None
    assert routed.reason == "research_table"
