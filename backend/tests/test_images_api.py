"""API tests for /images and /providers (auth, upsert no key echo, generate paths)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


def test_providers_list_requires_auth(client: TestClient):
    resp = client.get("/api/v1/providers/image")
    assert resp.status_code in (401, 403)


def test_providers_list_authenticated(authed):
    with patch(
        "app.api.v1.providers.list_secrets",
        new_callable=AsyncMock,
        return_value=[],
    ):
        resp = authed.get("/api/v1/providers/image")
    assert resp.status_code == 200
    body = resp.json()
    assert "secrets" in body
    assert "models" in body
    assert "supported_providers" in body


def test_providers_upsert_does_not_echo_key(authed):
    fake_row = MagicMock()
    fake_row.to_public_dict.return_value = {
        "provider": "openai",
        "configured": True,
        "key_hint": "sk-t…est",
        "default_model": "gpt-image-1",
        "is_active": True,
    }
    with patch(
        "app.api.v1.providers.upsert_secret",
        new_callable=AsyncMock,
        return_value=fake_row,
    ):
        resp = authed.put(
            "/api/v1/providers/image/openai",
            json={
                "provider": "openai",
                "api_key": "sk-secret-should-not-echo",
                "default_model": "gpt-image-1",
            },
        )
    assert resp.status_code == 200
    text = resp.text
    assert "sk-secret-should-not-echo" not in text
    assert resp.json()["success"] is True


def test_images_generate_requires_auth(client: TestClient):
    resp = client.post("/api/v1/images/generate", json={"prompt": "a cat"})
    assert resp.status_code in (401, 403)


def test_images_generate_needs_model_choice(authed):
    from app.services.image import ImageResult

    mock_svc = MagicMock()
    mock_svc.provider_name = "placeholder"
    mock_svc.generate = AsyncMock(
        return_value=ImageResult(
            success=False,
            error="Which image model should I use?",
            needs_input={
                "status": "needs_model_choice",
                "message": "Which image model should I use?",
                "options": [{"id": "gpt-image-1", "available": True}],
            },
        )
    )
    with patch("app.api.v1.images.app_state", {"image_service": mock_svc}):
        resp = authed.post("/api/v1/images/generate", json={"prompt": "course cover"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False
    assert body.get("error")


def test_images_generate_success(authed):
    from app.services.image import ImageResult
    from app.core.database import get_db

    mock_svc = MagicMock()
    mock_svc.provider_name = "openai:gpt-image-1"
    mock_svc.generate = AsyncMock(
        return_value=ImageResult(
            success=True,
            relative_path="generated/images/img_abc.png",
            seed=42,
            width=512,
            height=512,
            generation_time_ms=10,
            model="gpt-image-1",
            provider="openai:gpt-image-1",
            file_size=12,
        )
    )

    class _Rec:
        image_id = "img_test_1"

    mock_db = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.flush = AsyncMock()

    async def _refresh(rec):
        rec.image_id = "img_test_1"

    mock_db.refresh = _refresh

    async def _override_db():
        yield mock_db

    app = authed._c.app
    app.dependency_overrides[get_db] = _override_db
    try:
        with patch("app.api.v1.images.app_state", {"image_service": mock_svc}):
            # Bypass SQLAlchemy model construction by short-circuiting after generate
            with patch("app.api.v1.images.GeneratedImage", return_value=_Rec()):
                resp = authed.post(
                    "/api/v1/images/generate",
                    json={"prompt": "a logo", "model": "gpt-image-1"},
                )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is True
    assert body.get("image_id") == "img_test_1"
