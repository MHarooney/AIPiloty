"""Unit tests for image provider secret resolution and catalog aliases."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.services.provider_secrets import (
    apply_user_image_model_choice,
    catalog_entry,
    public_catalog,
    resolve_image_backend,
    user_named_image_model,
)

pytestmark = pytest.mark.unit


def _secret(provider: str, *, default_model: str | None = None, key: str = "sk-test") -> SimpleNamespace:
    return SimpleNamespace(
        provider=provider,
        is_active=True,
        api_key_encrypted="enc",
        api_key=key,
        default_model=default_model,
        last_used_at=None,
    )


def test_catalog_aliases_nano_banana_and_imagen():
    assert catalog_entry("nano banana")["id"] == "gemini-2.5-flash-image"
    assert catalog_entry("imagen-3.0-generate-002")["id"] == "gemini-3.1-flash-image"
    assert catalog_entry("dalle-3")["id"] == "dall-e-3"
    assert catalog_entry("gpt-image-1")["id"] == "gpt-image-1"


def test_user_named_image_model_and_generic_aliases():
    assert user_named_image_model('use model "gpt-image-1" please') == "gpt-image-1"
    assert user_named_image_model("nano banana cover") == "gemini-2.5-flash-image"
    # Ultra-generic aliases alone must not force a model
    assert user_named_image_model("talk about openai and gemini") is None


def test_apply_user_image_model_choice_strips_agent_invented_model():
    stripped = apply_user_image_model_choice(
        {"prompt": "a cat", "model": "dall-e-3", "provider": "openai"},
        "Generate a course cover image",
    )
    assert "model" not in stripped
    assert "provider" not in stripped
    assert stripped["prompt"] == "a cat"

    kept = apply_user_image_model_choice(
        {"prompt": "a cat", "model": "ignored"},
        'Generate the image now using model "gpt-image-1"',
    )
    assert kept["model"] == "gpt-image-1"


def test_public_catalog_marks_availability():
    cats = public_catalog({"openai"})
    by_id = {c["id"]: c for c in cats}
    assert by_id["gpt-image-1"]["available"] is True
    assert by_id["gemini-2.5-flash-image"]["available"] is False


@pytest.mark.asyncio
async def test_resolve_no_keys():
    with patch(
        "app.services.provider_secrets.list_secrets",
        new_callable=AsyncMock,
        return_value=[],
    ):
        backend, needs = await resolve_image_backend(db=AsyncMock())
    assert backend is None
    assert needs["status"] == "needs_api_key"


@pytest.mark.asyncio
async def test_resolve_provider_shortcut_picks_default():
    """One provider with multiple catalog models → needs choice unless provider/model set."""
    secrets = [_secret("openai", default_model="gpt-image-1")]
    with patch(
        "app.services.provider_secrets.list_secrets",
        new_callable=AsyncMock,
        return_value=secrets,
    ):
        backend, needs = await resolve_image_backend(db=AsyncMock())
    assert backend is None
    assert needs["status"] == "needs_model_choice"

    with patch(
        "app.services.provider_secrets.list_secrets",
        new_callable=AsyncMock,
        return_value=secrets,
    ):
        backend, needs = await resolve_image_backend(provider="openai", db=AsyncMock())
    assert needs is None
    assert backend is not None
    assert backend.model == "gpt-image-1"
    assert backend.provider == "openai"


@pytest.mark.asyncio
async def test_resolve_multi_model_needs_choice():
    secrets = [
        _secret("openai", default_model="gpt-image-1"),
        _secret("gemini", default_model="gemini-2.5-flash-image", key="AIza-test"),
    ]
    with patch(
        "app.services.provider_secrets.list_secrets",
        new_callable=AsyncMock,
        return_value=secrets,
    ):
        backend, needs = await resolve_image_backend(db=AsyncMock())
    assert backend is None
    assert needs["status"] == "needs_model_choice"
    assert len(needs["options"]) >= 2


@pytest.mark.asyncio
async def test_resolve_user_named_model():
    secrets = [
        _secret("openai", default_model="gpt-image-1"),
        _secret("gemini", default_model="gemini-2.5-flash-image", key="AIza-test"),
    ]
    with patch(
        "app.services.provider_secrets.list_secrets",
        new_callable=AsyncMock,
        return_value=secrets,
    ):
        backend, needs = await resolve_image_backend(
            model="nano banana",
            db=AsyncMock(),
        )
    assert needs is None
    assert backend is not None
    assert backend.model == "gemini-2.5-flash-image"
