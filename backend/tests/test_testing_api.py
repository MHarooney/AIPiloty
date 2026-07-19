"""Backend tests for /api/v1/testing — targets + stream with mocked orchestrator."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_testing_targets_require_auth(client: TestClient):
    assert client.get("/api/v1/testing/targets").status_code in (401, 403)


def test_testing_stream_requires_auth(client: TestClient):
    resp = client.post(
        "/api/v1/testing/chat/stream",
        json={"messages": [{"role": "user", "content": "hi"}]},
    )
    assert resp.status_code in (401, 403)


def test_testing_stream_with_mocked_orchestrator(authed):
    async def _fake_run(*_a, **_k):
        from app.services.agent.orchestrator import SSEEvent

        yield SSEEvent("session", {"session_key": "demo-sess"})
        yield SSEEvent("token", {"token": "Demo target looks healthy.", "done": True})
        yield SSEEvent("done", {})

    orch = MagicMock()
    orch.run = _fake_run

    with patch("app.api.v1.testing._get_testing_orchestrator", return_value=orch):
        # Avoid DB session persistence complexity — mock db ops inside stream if needed
        with patch("app.api.v1.testing.get_db") as mock_get_db:
            mock_db = AsyncMock()
            mock_db.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))
            mock_db.add = MagicMock()
            mock_db.commit = AsyncMock()
            mock_db.refresh = AsyncMock()
            mock_db.flush = AsyncMock()

            async def _db():
                yield mock_db

            # Override on app
            from app.core.database import get_db

            app = authed._c.app
            app.dependency_overrides[get_db] = _db
            try:
                with authed._c.stream(
                    "POST",
                    "/api/v1/testing/chat/stream",
                    headers=authed._h,
                    json={
                        "messages": [{"role": "user", "content": "probe https://example.com"}],
                        "testing_context": {
                            "url": "https://example.com",
                            "env_label": "demo",
                        },
                    },
                ) as resp:
                    assert resp.status_code == 200
                    text = "".join(resp.iter_text())
            finally:
                app.dependency_overrides.pop(get_db, None)

    assert "Demo target" in text or "session" in text or "data:" in text


def test_testing_demo_fixture(authed):
    resp = authed.get("/api/v1/testing/demo")
    assert resp.status_code == 200
    body = resp.json()
    assert body["target"]["url"] == "https://example.com"
    assert "sample_report" in body


def test_testing_list_runs_authed(authed):
    from app.core.database import get_db

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalars.return_value.all.return_value = []
    mock_db.execute = AsyncMock(return_value=mock_result)

    async def _db():
        yield mock_db

    app = authed._c.app
    app.dependency_overrides[get_db] = _db
    try:
        resp = authed.get("/api/v1/testing/runs")
    finally:
        app.dependency_overrides.pop(get_db, None)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
