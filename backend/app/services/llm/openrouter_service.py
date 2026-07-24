"""OpenRouter chat completions — OpenAI-compatible streaming.

https://openrouter.ai/docs — one API key for many models/providers.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Optional

import httpx

from ...core.config import get_settings

logger = logging.getLogger(__name__)


def openrouter_configured() -> bool:
    settings = get_settings()
    return bool((settings.openrouter_api_key or "").strip())


async def openrouter_chat_stream(
    messages: list[dict[str, Any]],
    *,
    model: Optional[str] = None,
    api_key: Optional[str] = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Yield Ollama-shaped chunks: {\"message\": {\"content\": \"...\"}}."""
    settings = get_settings()
    key = (api_key or settings.openrouter_api_key or "").strip()
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY not configured")

    model_name = (model or settings.openrouter_default_model or "openrouter/auto").strip()
    clean: list[dict[str, str]] = []
    for m in messages:
        role = m.get("role") or "user"
        content = m.get("content")
        if content is None:
            continue
        if role not in ("system", "user", "assistant"):
            continue
        clean.append({"role": role, "content": str(content)})

    payload = {
        "model": model_name,
        "messages": clean,
        "stream": True,
        "temperature": 0.3,
    }
    base = (settings.openrouter_base_url or "https://openrouter.ai/api/v1").rstrip("/")
    url = f"{base}/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://aipiloty.local",
        "X-Title": "AIPiloty",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode("utf-8", errors="replace")[:400]
                raise RuntimeError(f"OpenRouter error {resp.status_code}: {body}")
            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data = line[6:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = (choices[0].get("delta") or {}).get("content") or ""
                if delta:
                    yield {"message": {"content": delta}, "done": False}
            yield {"message": {"content": ""}, "done": True}
