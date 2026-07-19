"""Shared pytest fixtures — replaces the duplicated `client` fixture in every test file.

Usage:
    def test_something(client, auth_headers):
        resp = client.get("/api/v1/health", headers=auth_headers)
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

# Shared file DB so all connections see the same schema (plain :memory: is per-connection).
_TEST_DB = Path(__file__).resolve().parent / ".pytest_aipiloty.sqlite"
os.environ.setdefault("TESTING", "1")
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TEST_DB}"
os.environ.setdefault("JWT_SECRET", "ci-test-secret-32-chars-minimum-ok")
os.environ.setdefault("API_KEY", "test-api-key-for-ci")

if _TEST_DB.exists():
    try:
        _TEST_DB.unlink()
    except OSError:
        pass


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

        from app.core.database import Base, engine
        from app.models import (  # noqa: F401
            audit_log,
            chat,
            deployment,
            doc_studio,
            image,
            provider_secret,
            testing,
            vm,
            webhook,
        )

        async def _create():
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)

        asyncio.get_event_loop().run_until_complete(_create())

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
def chat_session_dict():
    """Build a plain chat-session dict via factory_boy (no DB)."""
    from tests.factories import ChatSessionFactory

    return ChatSessionFactory.build()


@pytest.fixture()
def user_message_dict():
    """Build a user message dict via factory_boy (no DB)."""
    from tests.factories import UserMessageFactory

    return UserMessageFactory.build()


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

        def stream(self, method: str, url: str, **kwargs):
            kwargs.setdefault("headers", {}).update(self._h)
            return self._c.stream(method, url, **kwargs)

    return _AuthedClient(client, auth_headers)
