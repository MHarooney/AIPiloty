"""Mermaid / flowchart requests must not route to generate_image."""
from __future__ import annotations

from app.services.agent.intent_classifier import IntentClassifier
from app.services.agent.tool_packs import resolve_pack_name


def test_mermaid_flowchart_is_not_image_intent():
    clf = IntentClassifier()
    intent = clf.classify(
        "Draw a Mermaid flowchart for a typical user login flow "
        "(start → credentials → MFA → session → dashboard)."
    )
    assert intent.category != "image"
    assert "generate_image" not in intent.suggested_tools


def test_bar_chart_is_not_image_intent_or_image_pack():
    clf = IntentClassifier()
    msg = "Show a Mermaid bar chart of monthly deploys"
    intent = clf.classify(msg)
    assert intent.category != "image"
    assert "generate_image" not in intent.suggested_tools
    assert resolve_pack_name(intent, msg) != "image"
    assert resolve_pack_name(intent, msg) == "planning"


def test_pie_chart_pack_is_planning():
    msg = "Show a Mermaid pie chart of team time: coding 40%"
    assert resolve_pack_name(None, msg) == "planning"


def test_cover_image_still_image_intent():
    clf = IntentClassifier()
    intent = clf.classify("Generate a course cover image for Accounting")
    assert intent.category == "image"
    assert "generate_image" in intent.suggested_tools
