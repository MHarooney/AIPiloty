"""Tests for the deep health check endpoint."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_health_returns_200(client: TestClient):
    resp = client.get("/api/v1/health")
    # Health endpoint may return 200 (ok/degraded) or 503 (unhealthy) — never 4xx
    assert resp.status_code in (200, 503)


def test_health_response_has_components(client: TestClient):
    resp = client.get("/api/v1/health")
    body = resp.json()
    assert "components" in body, "Health response must include a 'components' dict"


def test_health_response_has_status_field(client: TestClient):
    resp = client.get("/api/v1/health")
    body = resp.json()
    assert "status" in body
    assert body["status"] in ("ok", "degraded", "unhealthy")


def test_health_backwards_compat_fields(client: TestClient):
    """Legacy flat bool fields must still be present for old consumers."""
    resp = client.get("/api/v1/health")
    body = resp.json()
    assert "ollama_connected" in body
    assert "db_connected" in body


def test_health_request_id_echoed(client: TestClient):
    """The X-Request-ID header must be echoed back in the response."""
    resp = client.get(
        "/api/v1/health",
        headers={"X-Request-ID": "a3d6e8b0-1234-4abc-8def-0123456789ab"},
    )
    assert "x-request-id" in resp.headers
