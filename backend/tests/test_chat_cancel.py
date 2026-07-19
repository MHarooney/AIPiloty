"""Tests for SSE stream cancellation."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def auth_header():
    from app.core.config import get_settings

    return {"X-API-Key": get_settings().api_key}


def test_cancel_nonexistent_session_returns_404(client: TestClient, auth_header: dict):
    """Cancelling a session that doesn't exist must return 404 (not 401)."""
    resp = client.post(
        "/api/v1/chat/sessions/no-such-session-key/cancel",
        headers=auth_header,
    )
    assert resp.status_code == 404


def test_cancel_without_auth_returns_401(client: TestClient):
    """Cancel endpoint must require authentication."""
    resp = client.post("/api/v1/chat/sessions/whatever/cancel")
    assert resp.status_code == 401


def test_request_id_middleware_generates_id(client: TestClient):
    """Requests without X-Request-ID must get one generated and returned."""
    resp = client.get("/api/v1/health")
    assert "x-request-id" in resp.headers
    rid = resp.headers["x-request-id"]
    assert len(rid) == 36, "Expected UUID4 format (36 chars with dashes)"


def test_request_id_middleware_echoes_client_id(client: TestClient):
    """Valid client-supplied X-Request-ID should be echoed back unchanged."""
    my_id = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
    resp = client.get("/api/v1/health", headers={"X-Request-ID": my_id})
    assert resp.headers.get("x-request-id") == my_id


def test_request_id_middleware_rejects_injection(client: TestClient):
    """Malformed X-Request-ID (injection attempt) must be replaced by a fresh UUID."""
    resp = client.get("/api/v1/health", headers={"X-Request-ID": "../../etc/passwd"})
    rid = resp.headers.get("x-request-id", "")
    assert rid != "../../etc/passwd", "Injection attempt must not be echoed"
    assert len(rid) == 36
