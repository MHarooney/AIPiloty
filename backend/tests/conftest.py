"""Shared pytest fixtures — replaces the duplicated `client` fixture in every test file.

Usage:
    def test_something(client, auth_headers):
        resp = client.get("/api/v1/health", headers=auth_headers)
"""

from __future__ import annotations

import os
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch

# ── Environment setup ───────────────────────────────────────────────────────
os.environ.setdefault("TESTING", "1")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://")
os.environ.setdefault("JWT_SECRET", "ci-test-secret-32-chars-minimum-ok")
os.environ.setdefault("API_KEY", "test-api-key-for-ci")


# ── App factory ─────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def _app():
    """Create the FastAPI app once per session with all external services mocked."""
    with (
        patch("app.core.database.init_db", new_callable=AsyncMock),
        patch("app.services.rag.QdrantStore.ensure_collection", new_callable=AsyncMock),
    ):
        from app.core.config import get_settings
        get_settings.cache_clear()
        from app.main import create_app
        app = create_app()
        yield app
        get_settings.cache_clear()


@pytest.fixture()
def client(_app) -> TestClient:
    """HTTP test client.  Use this instead of defining a local client fixture."""
    with TestClient(_app, raise_server_exceptions=False) as c:
        yield c


@pytest.fixture()
def auth_headers() -> dict[str, str]:
    """Valid API key headers for authenticated requests."""
    from app.core.config import get_settings
    return {"X-API-Key": get_settings().api_key}


@pytest.fixture()
def authed(client: TestClient, auth_headers: dict[str, str]):
    """Convenience: a pre-authenticated test client wrapper.

    Usage:
        def test_foo(authed):
            resp = authed.get("/api/v1/health")
    """
    class _AuthedClient:
        def __init__(self, base_client: TestClient, headers: dict):
            self._c = base_client
            self._h = headers

        def get(self, url: str, **kwargs):
            kwargs.setdefault("headers", {}).update(self._h)
            return self._c.get(url, **kwargs)

        def post(self, url: str, **kwargs):
            kwargs.setdefault("headers", {}).update(self._h)
            return self._c.post(url, **kwargs)

        def put(self, url: str, **kwargs):
            kwargs.setdefault("headers", {}).update(self._h)
            return self._c.put(url, **kwargs)

        def delete(self, url: str, **kwargs):
            kwargs.setdefault("headers", {}).update(self._h)
            return self._c.delete(url, **kwargs)

    return _AuthedClient(client, auth_headers)
