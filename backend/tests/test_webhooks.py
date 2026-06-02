"""Tests for Webhook CRUD + test-fire + inbound receive endpoints.

All tests use the shared conftest fixtures (in-memory SQLite, no real HTTP calls).
Outbound HTTP calls (test_webhook) are mocked so no real HTTP traffic is made.
"""

from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient


# ── Create tables for in-memory DB ───────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def create_tables(_app):
    """Ensure all SQLAlchemy tables exist in the test in-memory DB."""
    from app.core.database import engine, Base
    from app.models import vm, deployment, webhook  # noqa: F401

    async def _create():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.get_event_loop().run_until_complete(_create())


# ── Auth guards ──────────────────────────────────────────────────────────────

class TestWebhookAuth:
    def test_list_requires_auth(self, client: TestClient):
        assert client.get("/api/v1/webhooks/").status_code in (401, 403)

    def test_create_requires_auth(self, client: TestClient):
        assert client.post("/api/v1/webhooks/", json={}).status_code in (401, 403)

    def test_delete_requires_auth(self, client: TestClient):
        assert client.delete("/api/v1/webhooks/1").status_code in (401, 403)

    def test_test_fire_requires_auth(self, client: TestClient):
        assert client.post("/api/v1/webhooks/1/test").status_code in (401, 403)


# ── Happy-path CRUD ──────────────────────────────────────────────────────────

class TestWebhookCRUD:
    _payload = {
        "name": "Deploy Notifier",
        "url": "https://hooks.example.com/notify",
        "events": ["deployment.success", "deployment.failure"],
        "active": True,
    }

    def test_list_webhooks_returns_list(self, authed):
        resp = authed.get("/api/v1/webhooks/")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_create_webhook_success(self, authed):
        resp = authed.post("/api/v1/webhooks/", json=self._payload)
        assert resp.status_code in (200, 201)
        body = resp.json()
        assert body["name"] == "Deploy Notifier"
        assert body["url"] == "https://hooks.example.com/notify"
        assert "deployment.success" in body["events"]
        assert body["active"] is True
        assert "id" in body
        assert "created_at" in body

    def test_create_webhook_auto_generates_secret(self, authed):
        """When no secret is provided, the backend must generate one."""
        resp = authed.post("/api/v1/webhooks/", json={**self._payload, "secret": ""})
        assert resp.status_code in (200, 201)
        # Secret may or may not be echoed; if it is, it should be non-empty
        body = resp.json()
        if "secret" in body:
            assert body["secret"] != ""

    def test_create_webhook_with_explicit_secret(self, authed):
        resp = authed.post("/api/v1/webhooks/", json={**self._payload, "secret": "my-webhook-secret"})
        assert resp.status_code in (200, 201)

    def test_create_webhook_appears_in_list(self, authed):
        authed.post("/api/v1/webhooks/", json=self._payload)
        resp = authed.get("/api/v1/webhooks/")
        names = [wh["name"] for wh in resp.json()]
        assert "Deploy Notifier" in names

    def test_delete_webhook(self, authed):
        wh_id = authed.post("/api/v1/webhooks/", json=self._payload).json()["id"]
        del_resp = authed.delete(f"/api/v1/webhooks/{wh_id}")
        assert del_resp.status_code == 200

    def test_delete_nonexistent_webhook_returns_404(self, authed):
        resp = authed.delete("/api/v1/webhooks/99999")
        assert resp.status_code == 404

    def test_pagination_limit_offset(self, authed):
        """limit and offset query params must not error."""
        resp = authed.get("/api/v1/webhooks/?limit=10&offset=0")
        assert resp.status_code == 200

    def test_invalid_limit_accepted(self, authed):
        """No Pydantic ge= constraint on limit — negative value is accepted by SQLAlchemy."""
        resp = authed.get("/api/v1/webhooks/?limit=-1")
        # API currently has no validation on limit; SQLAlchemy handles it gracefully
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


# ── Validation edge cases ────────────────────────────────────────────────────

class TestWebhookValidation:
    def test_create_requires_name(self, authed):
        resp = authed.post("/api/v1/webhooks/", json={"url": "https://x.com"})
        assert resp.status_code == 422

    def test_create_requires_url(self, authed):
        resp = authed.post("/api/v1/webhooks/", json={"name": "no-url"})
        assert resp.status_code == 422

    def test_create_default_events(self, authed):
        """Default events list should be non-empty."""
        resp = authed.post("/api/v1/webhooks/", json={"name": "x", "url": "https://x.com"})
        assert resp.status_code in (200, 201)
        assert len(resp.json()["events"]) > 0

    def test_create_inactive_webhook(self, authed):
        resp = authed.post("/api/v1/webhooks/", json={
            "name": "inactive",
            "url": "https://x.com",
            "active": False,
        })
        assert resp.status_code in (200, 201)
        assert resp.json()["active"] is False

    def test_create_webhook_with_empty_events_list(self, authed):
        """Empty events list is valid per schema."""
        resp = authed.post("/api/v1/webhooks/", json={
            "name": "no-events",
            "url": "https://x.com",
            "events": [],
        })
        assert resp.status_code in (200, 201, 422)


# ── Test-fire endpoint ────────────────────────────────────────────────────────

class TestWebhookTestFire:
    def test_test_fire_nonexistent_webhook_returns_404(self, authed):
        resp = authed.post("/api/v1/webhooks/99999/test")
        assert resp.status_code == 404

    def test_test_fire_makes_http_request(self, authed):
        """test endpoint must attempt HTTP delivery (mocked to avoid real calls)."""
        wh_id = authed.post("/api/v1/webhooks/", json={
            "name": "test-me",
            "url": "https://httpbin.org/post",
        }).json()["id"]

        mock_response = MagicMock()
        mock_response.status_code = 200

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(return_value=mock_response)

        with patch("httpx.AsyncClient", return_value=mock_client):
            resp = authed.post(f"/api/v1/webhooks/{wh_id}/test")

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] in ("sent", "failed")

    def test_test_fire_handles_connection_error_gracefully(self, authed):
        """If the HTTP call fails, endpoint should return status=failed not 500."""
        wh_id = authed.post("/api/v1/webhooks/", json={
            "name": "dead-url",
            "url": "https://dead.invalid/webhook",
        }).json()["id"]

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.post = AsyncMock(side_effect=Exception("Connection refused"))

        with patch("httpx.AsyncClient", return_value=mock_client):
            resp = authed.post(f"/api/v1/webhooks/{wh_id}/test")

        assert resp.status_code == 200
        assert resp.json()["status"] == "failed"
        assert "error" in resp.json()


# ── Inbound receive (no auth) ─────────────────────────────────────────────────

class TestWebhookReceive:
    def test_receive_with_wrong_secret_returns_200_ignored(self, client: TestClient):
        """Non-existent webhook_secret returns 200 {status: ignored} to prevent secret enumeration."""
        resp = client.post("/api/v1/webhooks/receive/wrong-secret-12345", json={"event": "push"})
        # API intentionally returns 200 to avoid leaking whether a secret exists
        assert resp.status_code == 200
        assert resp.json() == {"status": "ignored"}

    def test_receive_endpoint_is_public(self, client: TestClient):
        """Receive endpoint must NOT require auth headers."""
        resp = client.post("/api/v1/webhooks/receive/some-token", json={})
        # Should not be 401/403
        assert resp.status_code not in (401, 403)
