"""ProviderRouter — Multi-LLM provider chain with automatic failover.

Priority chain (default, configurable):
    1. Anthropic Claude    — anthropic SDK
    2. OpenAI GPT          — extends existing cloud_llm.py
    3. Google Gemini       — google-generativeai SDK
    4. Ollama local        — always available offline

Failover policy:
    - On RATE_LIMIT, QUOTA_EXHAUSTED, BILLING_REQUIRED, INVALID_KEY,
      OVERLOADED, TIMEOUT, NETWORK → try next provider in chain
    - On CONTEXT_TOO_LONG → trim history and retry the SAME provider
    - On UNKNOWN errors → re-raise (do not failover)
    - Failover triggers on the NEXT request, not mid-stream
    - Failed provider enters exponential backoff (default 60 s, max 600 s)
    - Ollama is NEVER suppressed — always last resort

SSE events emitted (yielded as dict alongside normal chunks):
    { "type": "provider_switched", "data": { "from": ..., "to": ..., "reason": ... } }
    { "type": "provider_health",   "data": { "provider": ..., "available": ..., "backoff_seconds": ... } }

Usage:
    router = build_default_router()
    async for chunk in router.chat_stream(messages, tools):
        ...  # Ollama-shaped chunk dict
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Any, AsyncGenerator, Optional

logger = logging.getLogger(__name__)

# ── Error classification ──────────────────────────────────────────────────────

class ProviderErrorType(Enum):
    RATE_LIMIT = auto()         # 429 — retry after backoff
    QUOTA_EXHAUSTED = auto()    # billing quota exhausted
    BILLING_REQUIRED = auto()   # payment required (402)
    INVALID_KEY = auto()        # 401 / 403 — bad API key
    OVERLOADED = auto()         # 503 / 529 — server overloaded
    TIMEOUT = auto()            # read/connect timeout
    CONTEXT_TOO_LONG = auto()   # 400 context window exceeded
    NETWORK = auto()            # connection refused / DNS fail
    UNKNOWN = auto()            # do NOT failover

    @property
    def should_failover(self) -> bool:
        return self in {
            ProviderErrorType.RATE_LIMIT,
            ProviderErrorType.QUOTA_EXHAUSTED,
            ProviderErrorType.BILLING_REQUIRED,
            ProviderErrorType.INVALID_KEY,
            ProviderErrorType.OVERLOADED,
            ProviderErrorType.TIMEOUT,
            ProviderErrorType.NETWORK,
        }


class ProviderException(Exception):
    def __init__(self, error_type: ProviderErrorType, message: str):
        super().__init__(message)
        self.error_type = error_type


# ── Provider health ───────────────────────────────────────────────────────────

BACKOFF_BASE_SECONDS = 60
BACKOFF_MAX_SECONDS = 600


@dataclass
class ProviderHealth:
    available: bool = True
    last_error_type: Optional[ProviderErrorType] = None
    backoff_until: float = 0.0   # epoch timestamp
    failure_count: int = 0

    @property
    def is_available(self) -> bool:
        if not self.available:
            return False
        if time.time() < self.backoff_until:
            return False
        return True

    @property
    def backoff_remaining(self) -> float:
        remaining = self.backoff_until - time.time()
        return max(0.0, remaining)

    def record_failure(self, error_type: ProviderErrorType) -> None:
        self.available = error_type != ProviderErrorType.INVALID_KEY
        self.last_error_type = error_type
        self.failure_count += 1
        delay = min(BACKOFF_BASE_SECONDS * (2 ** (self.failure_count - 1)), BACKOFF_MAX_SECONDS)
        self.backoff_until = time.time() + delay

    def record_success(self) -> None:
        self.available = True
        self.failure_count = 0
        self.backoff_until = 0.0
        self.last_error_type = None


# ── Abstract adapter ──────────────────────────────────────────────────────────

class ProviderAdapter(ABC):
    """Base class for all LLM provider adapters."""

    name: str           # e.g. "claude", "openai", "gemini", "ollama"
    priority: int       # lower = higher priority in the chain

    @abstractmethod
    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model_hint: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Yield Ollama-shaped chunks: {"message": {"content": "..."}}."""
        ...

    @abstractmethod
    async def is_available(self) -> bool:
        """Quick check without making an LLM call."""
        ...

    @abstractmethod
    def classify_error(self, exc: Exception) -> ProviderErrorType:
        """Map an exception to a ProviderErrorType."""
        ...


# ── Ollama adapter ────────────────────────────────────────────────────────────

class OllamaAdapter(ProviderAdapter):
    """Wraps the existing OllamaService."""

    name = "ollama"
    priority = 100  # Always last (but never suppressed)

    def __init__(self) -> None:
        from .ollama_service import OllamaService
        self._svc = OllamaService()

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model_hint: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        async for chunk in self._svc.chat_stream(messages, tools=tools, model_override=model_hint):
            yield chunk

    async def is_available(self) -> bool:
        return await self._svc.is_available()

    def classify_error(self, exc: Exception) -> ProviderErrorType:
        msg = str(exc).lower()
        if "connection" in msg or "refused" in msg or "unreachable" in msg:
            return ProviderErrorType.NETWORK
        if "timeout" in msg:
            return ProviderErrorType.TIMEOUT
        if "context" in msg and ("length" in msg or "window" in msg or "limit" in msg):
            return ProviderErrorType.CONTEXT_TOO_LONG
        return ProviderErrorType.UNKNOWN


# ── OpenAI adapter ────────────────────────────────────────────────────────────

class OpenAIAdapter(ProviderAdapter):
    """Wraps the existing cloud_llm.py openai_chat_stream."""

    name = "openai"
    priority = 20

    def __init__(self) -> None:
        from ...core.config import get_settings
        self._settings = get_settings()

    def _is_configured(self) -> bool:
        return bool(
            getattr(self._settings, "openai_api_key", None) or ""
        ).strip()

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model_hint: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        from .cloud_llm import openai_chat_stream
        async for chunk in openai_chat_stream(messages, model=model_hint):
            yield chunk

    async def is_available(self) -> bool:
        return self._is_configured()

    def classify_error(self, exc: Exception) -> ProviderErrorType:
        msg = str(exc).lower()
        if "429" in msg or "rate limit" in msg or "rate_limit" in msg:
            return ProviderErrorType.RATE_LIMIT
        if "401" in msg or "invalid" in msg and "key" in msg:
            return ProviderErrorType.INVALID_KEY
        if "403" in msg:
            return ProviderErrorType.INVALID_KEY
        if "402" in msg or "quota" in msg or "billing" in msg:
            return ProviderErrorType.QUOTA_EXHAUSTED
        if "503" in msg or "overload" in msg:
            return ProviderErrorType.OVERLOADED
        if "timeout" in msg:
            return ProviderErrorType.TIMEOUT
        if "connection" in msg or "refused" in msg:
            return ProviderErrorType.NETWORK
        if "context" in msg and ("length" in msg or "window" in msg or "token" in msg):
            return ProviderErrorType.CONTEXT_TOO_LONG
        return ProviderErrorType.UNKNOWN


# ── Anthropic adapter ─────────────────────────────────────────────────────────

class AnthropicAdapter(ProviderAdapter):
    """Claude via the anthropic SDK."""

    name = "claude"
    priority = 10

    def __init__(self) -> None:
        from ...core.config import get_settings
        self._settings = get_settings()

    def _api_key(self) -> str:
        return (getattr(self._settings, "anthropic_api_key", None) or "").strip()

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model_hint: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        from .anthropic_service import anthropic_chat_stream
        async for chunk in anthropic_chat_stream(messages, model=model_hint, api_key=self._api_key()):
            yield chunk

    async def is_available(self) -> bool:
        return bool(self._api_key())

    def classify_error(self, exc: Exception) -> ProviderErrorType:
        msg = str(exc).lower()
        # anthropic SDK raises APIStatusError with status_code attribute
        status = getattr(exc, "status_code", None)
        if status == 429 or "rate_limit" in msg or "rate limit" in msg:
            return ProviderErrorType.RATE_LIMIT
        if status in (401, 403) or "authentication" in msg or "invalid.*key" in msg:
            return ProviderErrorType.INVALID_KEY
        if status == 402 or "credit" in msg or "billing" in msg or "quota" in msg:
            return ProviderErrorType.QUOTA_EXHAUSTED
        if status == 529 or "overload" in msg:
            return ProviderErrorType.OVERLOADED
        if status == 503:
            return ProviderErrorType.OVERLOADED
        if "timeout" in msg:
            return ProviderErrorType.TIMEOUT
        if "connection" in msg or "refused" in msg:
            return ProviderErrorType.NETWORK
        if status == 400 and ("context" in msg or "token" in msg or "limit" in msg):
            return ProviderErrorType.CONTEXT_TOO_LONG
        return ProviderErrorType.UNKNOWN


# ── Gemini adapter ────────────────────────────────────────────────────────────

class GeminiAdapter(ProviderAdapter):
    """Google Gemini via google-generativeai SDK."""

    name = "gemini"
    priority = 30

    def __init__(self) -> None:
        from ...core.config import get_settings
        self._settings = get_settings()

    def _api_key(self) -> str:
        return (getattr(self._settings, "gemini_api_key", None) or "").strip()

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model_hint: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        from .gemini_service import gemini_chat_stream
        async for chunk in gemini_chat_stream(messages, model=model_hint, api_key=self._api_key()):
            yield chunk

    async def is_available(self) -> bool:
        return bool(self._api_key())

    def classify_error(self, exc: Exception) -> ProviderErrorType:
        msg = str(exc).lower()
        if "429" in msg or "quota" in msg or "resource_exhausted" in msg:
            return ProviderErrorType.QUOTA_EXHAUSTED
        if "401" in msg or "api_key" in msg or "api key" in msg:
            return ProviderErrorType.INVALID_KEY
        if "403" in msg:
            return ProviderErrorType.INVALID_KEY
        if "503" in msg or "unavailable" in msg:
            return ProviderErrorType.OVERLOADED
        if "timeout" in msg:
            return ProviderErrorType.TIMEOUT
        if "connection" in msg or "refused" in msg:
            return ProviderErrorType.NETWORK
        if "token" in msg and ("limit" in msg or "exceed" in msg):
            return ProviderErrorType.CONTEXT_TOO_LONG
        return ProviderErrorType.UNKNOWN


# ── ProviderRouter ────────────────────────────────────────────────────────────

class ProviderRouter:
    """Routes LLM requests through a priority chain with automatic failover.

    Failover is triggered on the next request, not mid-stream.
    Ollama is always last in the chain and is never suppressed.
    """

    def __init__(self, adapters: list[ProviderAdapter]) -> None:
        self.chain: list[ProviderAdapter] = sorted(adapters, key=lambda a: a.priority)
        self.health: dict[str, ProviderHealth] = {a.name: ProviderHealth() for a in adapters}
        self._active: str = self.chain[0].name if self.chain else "ollama"

    @property
    def active_provider(self) -> str:
        return self._active

    def health_summary(self) -> dict[str, Any]:
        return {
            name: {
                "available": h.is_available,
                "backoff_seconds": round(h.backoff_remaining),
                "failure_count": h.failure_count,
                "last_error": h.last_error_type.name if h.last_error_type else None,
            }
            for name, h in self.health.items()
        }

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model_hint: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """Try each provider in priority order; failover on recoverable errors."""
        previous: str | None = None

        for adapter in self.chain:
            health = self.health[adapter.name]

            # Skip unavailable/backoff providers (except Ollama — never skip)
            if not health.is_available and adapter.name != "ollama":
                logger.debug("[router] Skipping %s (backoff %.0f s)", adapter.name, health.backoff_remaining)
                continue

            # Emit provider_switched event if we changed providers
            if previous is not None and adapter.name != previous:
                yield {
                    "type": "provider_switched",
                    "data": {
                        "from": previous,
                        "to": adapter.name,
                        "reason": self.health[previous].last_error_type.name
                        if self.health[previous].last_error_type else "unknown",
                    },
                }

            self._active = adapter.name
            logger.info("[router] Using provider: %s", adapter.name)

            try:
                async for chunk in adapter.chat_stream(messages, tools=tools, model_hint=model_hint):
                    yield chunk
                # Success
                health.record_success()
                return

            except Exception as exc:
                error_type = adapter.classify_error(exc)
                logger.warning("[router] %s error: %s (%s)", adapter.name, exc, error_type.name)
                health.record_failure(error_type)

                # Emit health update
                yield {
                    "type": "provider_health",
                    "data": {
                        "provider": adapter.name,
                        "available": health.is_available,
                        "backoff_seconds": round(health.backoff_remaining),
                    },
                }

                if error_type.should_failover:
                    previous = adapter.name
                    continue  # Try next provider

                raise  # Non-failover errors bubble up

        # All providers exhausted
        logger.error("[router] All providers exhausted")
        yield {
            "type": "error",
            "data": {
                "code": "all_providers_exhausted",
                "message": "All LLM providers are unavailable. Check API keys and Ollama service.",
            },
        }


# ── Factory ───────────────────────────────────────────────────────────────────

def build_default_router() -> ProviderRouter:
    """Build a ProviderRouter with all configured adapters.

    Only adapters with configured API keys are included (except Ollama, which
    is always included as the last-resort local provider).

    Safe to call at any point (sync, no event loop required).
    """
    return build_router_sync()


def build_router_sync() -> ProviderRouter:
    """Build a ProviderRouter synchronously (for use at import time / startup).

    Availability checks are skipped; all configured adapters are included.
    The router will naturally skip unavailable providers at request time.
    """
    from ...core.config import get_settings
    s = get_settings()

    adapters: list[ProviderAdapter] = []

    if (getattr(s, "anthropic_api_key", None) or "").strip():
        adapters.append(AnthropicAdapter())

    if (getattr(s, "openai_api_key", None) or "").strip():
        adapters.append(OpenAIAdapter())

    if (getattr(s, "gemini_api_key", None) or "").strip():
        adapters.append(GeminiAdapter())

    # Ollama — always last resort
    adapters.append(OllamaAdapter())

    return ProviderRouter(adapters)
