"""Async Ollama LLM service with native tool calling and streaming."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncGenerator, Optional

import httpx

from ...core.config import get_settings

logger = logging.getLogger(__name__)

# Limit concurrent Ollama requests
_semaphore = asyncio.Semaphore(3)

# ── Persistent HTTP client (reuses TCP connections to Ollama) ─────────────
# Creating a new AsyncClient per request forces a new TCP connection each time.
# A module-level client reuses the connection pool for much lower overhead.
# Limits: 10 connections max (Ollama is single-threaded anyway).
_http_client: Optional[httpx.AsyncClient] = None


def _get_http_client() -> httpx.AsyncClient:
    """Return the shared persistent HTTP client, creating it on first call."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=5.0),
            limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
        )
    return _http_client


async def close_http_client() -> None:
    """Close the shared client on app shutdown."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


class OllamaService:
    """Async client for the Ollama REST API with native function calling."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        temperature: Optional[float] = None,
        context_length: Optional[int] = None,
    ):
        settings = get_settings()
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.ollama_model
        self.temperature = temperature if temperature is not None else settings.ollama_temperature
        self.context_length = context_length or settings.ollama_context_length
        self.num_predict = settings.ollama_num_predict

    # ── Health check ──────────────────────────────────────────────

    async def is_available(self) -> bool:
        try:
            client = _get_http_client()
            r = await client.get(f"{self.base_url}/api/tags")
            return r.status_code == 200
        except Exception:
            return False

    async def list_models(self) -> list[dict[str, Any]]:
        """Return available models from Ollama."""
        try:
            client = _get_http_client()
            r = await client.get(f"{self.base_url}/api/tags")
            if r.status_code == 200:
                return r.json().get("models", [])
        except Exception:
            pass
        return []

    async def warm_up(self) -> bool:
        """Pre-load the model into Ollama memory to eliminate cold-start latency.

        Sends a minimal generate request with keep_alive=-1 so the model stays
        in memory until the server shuts down.  Call this once during app startup.
        Returns True if the model loaded successfully.
        """
        logger.info("Warming up Ollama model '%s' (keep_alive=-1)...", self.model)
        try:
            client = _get_http_client()
            r = await client.post(
                f"{self.base_url}/api/generate",
                json={
                    "model": self.model,
                    "prompt": "",
                    "keep_alive": -1,
                    "options": {"num_ctx": self.context_length, "num_predict": 0},
                },
                timeout=httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=5.0),
            )
            if r.status_code == 200:
                logger.info("Model '%s' loaded and pinned in Ollama memory.", self.model)
                return True
            logger.warning("Warm-up got HTTP %s: %s", r.status_code, r.text[:200])
        except Exception as exc:
            logger.warning("Warm-up failed (Ollama may not be running): %s", exc)
        return False

    # ── Non-streaming chat (with tool calling) ────────────────────

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: Optional[list[dict]] = None,
        *,
        model_override: Optional[str] = None,
    ) -> dict[str, Any]:
        """Send a chat completion request and return the full response."""
        async with _semaphore:
            payload: dict[str, Any] = {
                "model": model_override or self.model,
                "messages": messages,
                "stream": False,
                # keep_alive=-1 pins the model in Ollama memory indefinitely,
                # eliminating the 7-8s cold-start reload between idle requests.
                "keep_alive": -1,
                "options": {
                    "temperature": self.temperature,
                    "num_ctx": self.context_length,
                    "num_predict": self.num_predict,
                },
            }
            if tools:
                payload["tools"] = tools

            client = _get_http_client()
            r = await client.post(f"{self.base_url}/api/chat", json=payload)
            if r.status_code != 200:
                body = r.text
                raise RuntimeError(f"Ollama error ({r.status_code}): {body}")
            return r.json()

    # ── Streaming chat ────────────────────────────────────────────

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: Optional[list[dict]] = None,
        *,
        model_override: Optional[str] = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Stream chat completion, yielding parsed JSON chunks."""
        async with _semaphore:
            payload: dict[str, Any] = {
                "model": model_override or self.model,
                "messages": messages,
                "stream": True,
                # keep_alive=-1 keeps the model loaded between requests (no cold start).
                "keep_alive": -1,
                "options": {
                    "temperature": self.temperature,
                    "num_ctx": self.context_length,
                    "num_predict": self.num_predict,
                },
            }
            if tools:
                payload["tools"] = tools

            client = _get_http_client()
            async with client.stream(
                "POST", f"{self.base_url}/api/chat", json=payload
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        yield json.loads(line)
                    except json.JSONDecodeError:
                        continue

    # ── Simple generate (for content generation) ──────────────────

    async def generate(self, prompt: str, system: Optional[str] = None) -> str:
        """Simple text generation (no tool calling). Returns the response text."""
        messages: list[dict[str, Any]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        result = await self.chat(messages)
        return result.get("message", {}).get("content", "")
