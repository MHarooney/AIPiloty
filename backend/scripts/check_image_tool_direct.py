#!/usr/bin/env python3
"""Direct generate_image tool call — no LLM — to verify null width fix + image providers."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


async def test_null_coercion() -> None:
    from app.services.tools.documents.tools import GenerateImage
    from app.services.image import ImageResult

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
    print("null_coercion_ok", out.error is None, out.output)
    print("passed_args", mock_svc.generate.await_args.kwargs)


async def test_live_image_service() -> None:
    """Hit real ImageGenerationService if app can boot lightly."""
    from app.core.config import settings
    from app.services.image import ImageGenerationService
    from app.services.provider_secrets import resolve_image_backend

    print("settings_api_key_set", bool(settings.api_key))
    # Try resolve without full app
    try:
        from app.db.session import async_session_factory
    except Exception as e:
        print("no_db", e)
        return

    async with async_session_factory() as db:
        backend, needs = await resolve_image_backend(db, model="gpt-image-1")
        print("resolve", backend, needs)
        if needs:
            print("needs_input", json.dumps(needs)[:400])
            return
        # Don't actually call paid API unless available — just report resolution
        print("resolved_provider", backend.provider, "model", backend.model)


async def main() -> None:
    await test_null_coercion()
    try:
        await test_live_image_service()
    except Exception as e:
        print("live_err", type(e).__name__, e)


if __name__ == "__main__":
    asyncio.run(main())
