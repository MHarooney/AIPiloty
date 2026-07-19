"""Research-table fast path — general (any domain), no static KB."""
from __future__ import annotations

from app.services.agent.research_table import (
    build_format_user_prompt,
    extract_comparison_entities,
    extract_comparison_queries,
    extract_requested_columns,
    normalize_research_table_markdown,
    repair_vertical_pipe_table,
    unwrap_markdown_table_fences,
)
from app.services.agent.message_router import MessageRoute, route_message


COMPARE_MSG = (
    "Compare gpt-image-1, Gemini Flash Image, and DALL·E 3 in a markdown table "
    "(speed, quality, best for, notes)."
)
DOCKER_MSG = "Create a comparison table of Docker vs Podman vs containerd."
TEA_MSG = "Compare green tea vs black tea vs oolong in a table"


def test_extract_entities_any_domain():
    assert extract_comparison_entities(DOCKER_MSG) == ["Docker", "Podman", "containerd"]
    assert extract_comparison_entities(TEA_MSG) == ["green tea", "black tea", "oolong"]


def test_extract_queries_strip_scaffolding():
    qs = extract_comparison_queries(DOCKER_MSG)
    joined = " | ".join(qs).lower()
    assert "docker vs podman" in joined
    assert "a comparison table of docker" not in joined


def test_extract_requested_columns_from_parens():
    cols = extract_requested_columns(COMPARE_MSG)
    assert "speed" in [c.lower() for c in cols]
    assert "quality" in [c.lower() for c in cols]
    # Docker prompt has no explicit columns
    assert extract_requested_columns(DOCKER_MSG) == []


def test_format_prompt_has_no_static_domain_kb():
    prompt = build_format_user_prompt(DOCKER_MSG, [])
    assert "Docker" in prompt and "Podman" in prompt
    # Must NOT inject canned Docker facts / domain aspect lists
    assert "dockerd" not in prompt.lower()
    assert "Hard facts to respect" not in prompt
    assert "Suggested aspects" not in prompt
    assert "choose 6–8 high-signal aspects" in prompt or "aspects that fit" in prompt


def test_format_prompt_honors_user_columns():
    prompt = build_format_user_prompt(COMPARE_MSG, [])
    assert "User-requested criteria" in prompt
    assert "speed" in prompt.lower()
    assert "quality" in prompt.lower()


def test_no_domain_aspect_helper_exported():
    import app.services.agent.research_table as rt

    assert not hasattr(rt, "suggest_aspects")
    assert not hasattr(rt, "_DOMAIN_ASPECTS")
    assert not hasattr(rt, "_fact_seeds")


def test_repair_vertical_pipe_table():
    broken = """|
| Model
|
| Speed
|
| Quality
|
| ---
|
| A
|
| Fast
|
| High
|
| B
|
| Slow
|
| Medium
"""
    fixed = repair_vertical_pipe_table(broken)
    assert "| Model | Speed | Quality |" in fixed
    assert "| A | Fast | High |" in fixed


def test_unwrap_markdown_fence_around_table():
    md = "```markdown\n| Model | Speed |\n|---|---|\n| A | Fast |\n```\n\n### Quick takeaways\n- Prefer A"
    out = unwrap_markdown_table_fences(md)
    assert "```" not in out
    assert "| Model | Speed |" in out


def test_normalize_inserts_missing_separator_row():
    md = (
        "| Model | Speed | Quality |\n"
        "| GPT-Image-1 | Fast | High |\n"
        "| DALL-E 3 | Medium | Excellent |\n"
    )
    out = normalize_research_table_markdown(md)
    lines = out.splitlines()
    assert lines[0].startswith("| Model |")
    assert set(lines[1].replace(" ", "")) <= {"|", "-", ":"} and "-" in lines[1]


def test_normalize_does_not_duplicate_existing_separator():
    md = "| Model | Speed |\n| --- | --- |\n| A | Fast |\n| B | Slow |\n"
    out = normalize_research_table_markdown(md)
    sep_count = sum(
        1
        for ln in out.splitlines()
        if set(ln.strip().replace(" ", "")) <= {"|", "-", ":"} and "-" in ln
    )
    assert sep_count == 1


def test_routing_any_compare():
    for msg in (COMPARE_MSG, DOCKER_MSG, TEA_MSG):
        routed = route_message(msg, mode="auto")
        assert routed.route == MessageRoute.AGENT_TASK, msg
        assert routed.reason == "research_table", msg
