"""Unit tests for image providers — Gemini remap + OpenAI soft-fallback."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.image import (
    GeminiImagesProvider,
    ImageGenerationService,
    ImageResult,
    build_provider_from_secret,
)

pytestmark = pytest.mark.unit


def test_gemini_model_alias_remap():
    p = GeminiImagesProvider(api_key="k", model="imagen-3.0-generate-002")
    assert p.name == "gemini:gemini-3.1-flash-image"
    p2 = GeminiImagesProvider(api_key="k", model="nano-banana")
    assert p2.name == "gemini:gemini-2.5-flash-image"


def test_build_provider_from_secret():
    o = build_provider_from_secret("openai", "sk-x", "gpt-image-1")
    assert o.name.startswith("openai")
    g = build_provider_from_secret("gemini", "AIza", "gemini-2.5-flash-image")
    assert g.name.startswith("gemini")


@pytest.mark.asyncio
async def test_generate_returns_needs_model_choice(tmp_path: Path):
    svc = ImageGenerationService(workspace_root=str(tmp_path), provider=None)
    needs = {
        "status": "needs_model_choice",
        "message": "Which image model?",
        "options": [{"id": "gpt-image-1", "available": True}],
    }
    with patch(
        "app.services.provider_secrets.resolve_image_backend",
        new_callable=AsyncMock,
        return_value=(None, needs),
    ):
        result = await svc.generate(prompt="a cat")
    assert result.success is False
    assert result.needs_input == needs


@pytest.mark.asyncio
async def test_gemini_429_soft_fallback_to_openai(tmp_path: Path):
    svc = ImageGenerationService(workspace_root=str(tmp_path), provider=None)
    gemini = MagicMock()
    gemini.name = "gemini:gemini-2.5-flash-image"
    gemini.generate = AsyncMock(side_effect=RuntimeError("Gemini Image API 429: quota"))

    openai_prov = MagicMock()
    openai_prov.name = "openai:gpt-image-1"
    openai_prov.generate = AsyncMock(return_value=b"\x89PNG\r\n\x1a\nfake")

    backend = SimpleNamespace(
        provider="gemini",
        model="gemini-2.5-flash-image",
        api_key="AIza",
        label="Nano Banana",
    )
    openai_backend = SimpleNamespace(
        provider="openai",
        model="gpt-image-1",
        api_key="sk-x",
        label="GPT Image 1",
    )

    async def _resolve(*, model=None, provider=None, db=None):
        if provider == "openai" or model == "gpt-image-1":
            return openai_backend, None
        return backend, None

    with (
        patch(
            "app.services.provider_secrets.resolve_image_backend",
            side_effect=_resolve,
        ),
        patch(
            "app.services.image.build_provider_from_secret",
            side_effect=lambda provider, api_key, model: (
                openai_prov if provider == "openai" else gemini
            ),
        ),
        patch(
            "app.services.image.try_gemini_web_fallback",
            new_callable=AsyncMock,
            return_value=None,
        ),
    ):
        result = await svc.generate(
            prompt="cover art",
            model="gemini-2.5-flash-image",
        )

    assert result.success is True
    assert result.relative_path
    assert (tmp_path / result.relative_path).exists()
    openai_prov.generate.assert_awaited()


@pytest.mark.asyncio
async def test_gemini_429_prefers_website_session_over_openai(tmp_path: Path):
    svc = ImageGenerationService(workspace_root=str(tmp_path), provider=None)
    gemini = MagicMock()
    gemini.name = "gemini:gemini-2.5-flash-image"
    gemini.generate = AsyncMock(side_effect=RuntimeError("Gemini Image API 429: quota"))

    backend = SimpleNamespace(
        provider="gemini",
        model="gemini-2.5-flash-image",
        api_key="AIza",
        label="Nano Banana",
    )

    with (
        patch(
            "app.services.provider_secrets.resolve_image_backend",
            new_callable=AsyncMock,
            return_value=(backend, None),
        ),
        patch(
            "app.services.image.build_provider_from_secret",
            return_value=gemini,
        ),
        patch(
            "app.services.image.try_gemini_web_fallback",
            new_callable=AsyncMock,
            return_value=(b"\x89PNG\r\n\x1a\nweb", "gemini-web:BASIC_FLASH"),
        ),
    ):
        result = await svc.generate(
            prompt="A course cover image for Agentic Course",
            model="gemini-2.5-flash-image",
        )

    assert result.success is True
    assert result.provider == "gemini-web:BASIC_FLASH"
    assert result.model == "gemini-2.5-flash-image"
    assert (tmp_path / result.relative_path).read_bytes().startswith(b"\x89PNG")


@pytest.mark.asyncio
async def test_generate_image_tool_needs_input_vs_error():
    from app.services.tools.documents.tools import GenerateImage
    from app.services.tools.base import ToolResult

    class _Doc:
        async def generate_image(self, **kw):
            return {"ok": True}

    tool = GenerateImage(_Doc())
    needs = ImageResult(
        success=False,
        error="pick a model",
        needs_input={"status": "needs_model_choice", "options": []},
    )
    mock_svc = MagicMock()
    mock_svc.generate = AsyncMock(return_value=needs)

    with patch("app.main.app_state", {"image_service": mock_svc}):
        out = await tool.execute(prompt="x")
    assert isinstance(out, ToolResult)
    assert out.error is None
    assert out.output["status"] == "needs_model_choice"

    mock_svc.generate = AsyncMock(
        return_value=ImageResult(success=False, error="boom")
    )
    with patch("app.main.app_state", {"image_service": mock_svc}):
        err = await tool.execute(prompt="x")
    assert err.error == "boom"


@pytest.mark.asyncio
async def test_generate_image_tool_coerces_null_width_height():
    """LLMs often pass width/height: null — must not crash with int(None)."""
    from app.services.tools.documents.tools import GenerateImage

    class _Doc:
        async def generate_image(self, **kw):
            return {"success": False, "error": "unused"}

    tool = GenerateImage(_Doc())
    ok = ImageResult(
        success=True,
        relative_path="generated/test.png",
        model="gpt-image-1",
        provider="openai",
        generation_time_ms=1,
    )
    mock_svc = MagicMock()
    mock_svc.generate = AsyncMock(return_value=ok)

    with patch("app.main.app_state", {"image_service": mock_svc}):
        out = await tool.execute(
            prompt="HTML course cover",
            model="gpt-image-1",
            width=None,
            height=None,
            steps=None,
        )

    assert out.error is None
    assert out.output["success"] is True
    kwargs = mock_svc.generate.await_args.kwargs
    assert kwargs["width"] == 1024
    assert kwargs["height"] == 1024
    assert kwargs["steps"] == 20
    assert kwargs["model"] == "gpt-image-1"


def test_openai_pick_size_for_gpt_image():
    from app.services.image import OpenAIImagesProvider

    assert OpenAIImagesProvider._pick_size(1024, 1024, "gpt-image-1") == "1024x1024"
    assert OpenAIImagesProvider._pick_size(1792, 1024, "gpt-image-1") == "1536x1024"
    assert OpenAIImagesProvider._pick_size(1024, 1792, "gpt-image-1") == "1024x1536"
    assert OpenAIImagesProvider._pick_size(1792, 1024, "dall-e-3") == "1792x1024"
