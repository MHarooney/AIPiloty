"""Optional cloud LLM fallback (Phase C) — OpenAI Chat Completions streaming.

Used only for hard GENERAL_QA reasoning when enabled. Tools / agent loops
always stay on local Ollama.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Optional

import httpx

from ...core.config import get_settings

logger = logging.getLogger(__name__)


def cloud_llm_configured() -> bool:
    settings = get_settings()
    return bool(settings.cloud_llm_enabled and (settings.openai_api_key or "").strip())


def should_use_cloud_for_qa(complexity: str) -> bool:
    """Whether this GENERAL_QA turn should try the cloud model."""
    if not cloud_llm_configured():
        return False
    settings = get_settings()
    mode = (settings.cloud_llm_for or "complex_qa").lower()
    if mode in ("never", "off", "false", "0"):
        return False
    if mode in ("always_qa", "always"):
        return True
    # default: complex_qa
    return complexity in ("complex", "code")


async def openai_chat_stream(
    messages: list[dict[str, Any]],
    *,
    model: Optional[str] = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Yield Ollama-shaped chunks: {\"message\": {\"content\": \"...\"}}."""
    settings = get_settings()
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not configured")

    model_name = model or settings.cloud_llm_model or "gpt-4o-mini"
    # Strip images / non-OpenAI fields
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
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    url = "https://api.openai.com/v1/chat/completions"
    async with httpx.AsyncClient(timeout=120.0) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode("utf-8", errors="replace")[:300]
                raise RuntimeError(f"OpenAI error {resp.status_code}: {body}")
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
