"""Agent golden trajectories — deterministic pack/route gate (no live LLM).

Fixtures live in tests/fixtures/agent_trajectories/*.json (Git-versioned).
CI fails if accuracy < PASS_THRESHOLD.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.agent.intent_classifier import IntentClassifier
from app.services.agent.message_router import MessageRoute, route_message
from app.services.agent.tool_packs import pack_tool_names, resolve_pack_name
from app.services.provider_secrets import apply_user_image_model_choice

pytestmark = pytest.mark.eval

PASS_THRESHOLD = 0.90
FIXTURES_DIR = Path(__file__).parent / "fixtures" / "agent_trajectories"


def _load_cases() -> list[dict]:
    cases: list[dict] = []
    for path in sorted(FIXTURES_DIR.glob("*.json")):
        data = json.loads(path.read_text())
        assert isinstance(data, list), f"{path} must be a JSON array"
        for item in data:
            item["_fixture"] = path.name
            cases.append(item)
    return cases


CASES = _load_cases()


def _normalize_route(value: str) -> str:
    if value == "task":
        return MessageRoute.AGENT_TASK.value
    return value


def _evaluate(case: dict) -> tuple[bool, str]:
    msg = case["user"]
    mode = case.get("mode", "auto")
    routed = route_message(msg, mode=mode, has_pending_action=False)
    expected_route = _normalize_route(case["expect_route"])
    if routed.route.value != expected_route:
        return False, f"route expected={expected_route} got={routed.route.value}"

    expect_pack = case.get("expect_pack")
    allowed: set[str] = set()
    if expect_pack is None:
        # Non-task routes: no tool pack — treat allowed as empty for must_* checks
        if case.get("must_call"):
            return False, "must_call non-empty but expect_pack is null"
    else:
        intent = IntentClassifier().classify(msg)
        pack = resolve_pack_name(intent, msg)
        if pack != expect_pack:
            return False, f"pack expected={expect_pack} got={pack}"
        allowed = set(pack_tool_names(pack))

    for name in case.get("must_call") or []:
        if name not in allowed:
            return False, f"must_call missing from pack: {name} (allowed={sorted(allowed)[:12]})"

    for name in case.get("must_not_call") or []:
        if name in allowed:
            return False, f"must_not_call present in pack: {name}"

    # Optional: agent must omit model when user did not name one
    gi = case.get("generate_image") or {}
    if gi.get("omit_model"):
        stripped = apply_user_image_model_choice(
            {"prompt": msg, "model": "dall-e-3"},
            msg,
        )
        if "model" in stripped:
            return False, "generate_image model was not stripped for unnamed prompt"

    return True, "ok"


def test_trajectory_fixture_count() -> None:
    assert len(CASES) >= 30, f"need ≥30 trajectory cases, got {len(CASES)}"


def test_trajectory_accuracy() -> None:
    failures: list[str] = []
    for case in CASES:
        ok, reason = _evaluate(case)
        if not ok:
            failures.append(f"{case['id']} ({case['_fixture']}): {reason} | user={case['user']!r}")

    accuracy = 1.0 - (len(failures) / len(CASES))
    assert accuracy >= PASS_THRESHOLD, (
        f"trajectory accuracy {accuracy:.1%} < {PASS_THRESHOLD:.0%} "
        f"({len(failures)}/{len(CASES)} failed)\n" + "\n".join(failures[:40])
    )
