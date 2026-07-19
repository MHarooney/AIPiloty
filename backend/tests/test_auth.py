"""Tests for authentication — API key and JWT Bearer."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_no_auth_succeeds(client: TestClient):
    """Health endpoint must be accessible without credentials."""
    resp = client.get("/api/v1/health")
    # Acceptable even if Ollama/Qdrant are offline — important is not 401/403
    assert resp.status_code not in (401, 403)


def test_missing_auth_returns_401(client: TestClient):
    """/api/v1/chat/stream must reject requests with no credentials."""
    resp = client.post("/api/v1/chat/stream", json={"messages": [{"role": "user", "content": "hi"}]})
    assert resp.status_code == 401


def test_invalid_api_key_returns_401(client: TestClient):
    resp = client.post(
        "/api/v1/chat/stream",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"X-API-Key": "not-a-real-key"},
    )
    assert resp.status_code == 401


def test_valid_api_key_passes_auth(client: TestClient):
    """A correct API key must pass authentication (may fail downstream for other reasons)."""
    from app.core.config import get_settings

    api_key = get_settings().api_key
    resp = client.post(
        "/api/v1/chat/stream",
        json={"messages": [{"role": "user", "content": "hello"}]},
        headers={"X-API-Key": api_key},
    )
    # 401/403 must not appear; 422/500/200 are all acceptable (Ollama may be offline)
    assert resp.status_code not in (401, 403)


def test_malformed_bearer_returns_401(client: TestClient):
    resp = client.post(
        "/api/v1/chat/stream",
        json={"messages": []},
        headers={"Authorization": "Bearer not-a-valid-jwt"},
    )
    assert resp.status_code == 401
