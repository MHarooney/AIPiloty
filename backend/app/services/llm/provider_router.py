"""ProviderRouter — Multi-LLM provider chain with automatic failover.

Priority chain (default, configurable):
    1. OpenRouter          — OpenAI-compatible multi-model gateway
    2. Anthropic Claude    — anthropic SDK
    3. OpenAI GPT          — extends existing cloud_llm.py
    4. Google Gemini       — google-generativeai SDK
    5. Ollama local        — always available offline

Failover policy:
    - Default chain: OpenRouter (cloud) → … → Ollama (local)
    - Cloud adapters soft-fail to the next provider (Ollama last) on almost
      any error, including bad model IDs (CLIENT_ERROR) and UNKNOWN
    - On CONTEXT_TOO_LONG → do not blind-failover (prompt would fail locally too)
    - CLIENT_ERROR uses a short 5 s backoff so a bad pin does not take OpenRouter offline
    - Other failures use exponential backoff (default 60 s, max 600 s)
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
    CLIENT_ERROR = auto()       # bad model / bad request — failover, no long backoff
    UNKNOWN = auto()            # surface locally; cloud still soft-fails via adapter.name check

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
            ProviderErrorType.CLIENT_ERROR,
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
        self.last_error_type = error_type
        # Bad model / client 400 must not take the whole cloud route offline.
        if error_type == ProviderErrorType.CLIENT_ERROR:
            self.available = True
            self.backoff_until = time.time() + 5
            return
        self.available = error_type != ProviderErrorType.INVALID_KEY
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


class OpenRouterAdapter(ProviderAdapter):
    """OpenRouter — OpenAI-compatible multi-model gateway."""

    name = "openrouter"
    priority = 5

    def __init__(self) -> None:
        from ...core.config import get_settings
        self._settings = get_settings()

    def _api_key(self) -> str:
        return (getattr(self._settings, "openrouter_api_key", None) or "").strip()

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        model_hint: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        from .openrouter_service import openrouter_chat_stream
        async for chunk in openrouter_chat_stream(
            messages, model=model_hint, api_key=self._api_key()
        ):
            yield chunk

    async def is_available(self) -> bool:
        return bool(self._api_key())

    def classify_error(self, exc: Exception) -> ProviderErrorType:
        msg = str(exc).lower()
        if "429" in msg or "rate limit" in msg or "rate_limit" in msg:
            return ProviderErrorType.RATE_LIMIT
        if "401" in msg or "403" in msg or ("invalid" in msg and "key" in msg):
            return ProviderErrorType.INVALID_KEY
        if "402" in msg or "quota" in msg or "credits" in msg or "billing" in msg:
            return ProviderErrorType.QUOTA_EXHAUSTED
        if "503" in msg or "overload" in msg:
            return ProviderErrorType.OVERLOADED
        if "timeout" in msg:
            return ProviderErrorType.TIMEOUT
        if "connection" in msg or "refused" in msg:
            return ProviderErrorType.NETWORK
        if "context" in msg and ("length" in msg or "window" in msg or "token" in msg):
            return ProviderErrorType.CONTEXT_TOO_LONG
        # Invalid model IDs / generic 4xx — soft-fail to Ollama, don't kill the route
        if (
            "error 400" in msg
            or "error 404" in msg
            or "not a valid model" in msg
            or "model" in msg and ("not found" in msg or "does not exist" in msg)
        ):
            return ProviderErrorType.CLIENT_ERROR
        # Prefer local fallback over hard-fail for unexpected OpenRouter errors
        return ProviderErrorType.CLIENT_ERROR


KNOWN_PROVIDERS = frozenset({"openrouter", "claude", "openai", "gemini", "ollama"})


def parse_model_selection(
    model_hint: str | None,
) -> tuple[str | None, str | None]:
    """Parse UI model id into (pinned_provider, model_id).

    - ``auto`` / empty → (None, None) — full failover chain
    - ``openrouter:meta-llama/...`` → pin openrouter with that model
    - bare ``org/model`` → openrouter
    - otherwise (None, hint) — hint for Auto chain
    """
    if not model_hint:
        return None, None
    h = model_hint.strip()
    if not h or h.lower() == "auto":
        return None, None
    if ":" in h:
        left, right = h.split(":", 1)
        if left.lower() in KNOWN_PROVIDERS and right.strip():
            return left.lower(), right.strip()
    if "/" in h:
        return "openrouter", h
    return None, h


class ProviderRouter:
    """Routes LLM requests through a priority chain with automatic failover.

    Failover is triggered on the next request, not mid-stream.
    Ollama is always last in the chain and is never suppressed.
    """

    def __init__(self, adapters: list[ProviderAdapter]) -> None:
        self.chain: list[ProviderAdapter] = sorted(adapters, key=lambda a: a.priority)
        self.health: dict[str, ProviderHealth] = {a.name: ProviderHealth() for a in adapters}
        self._active: str = self.chain[0].name if self.chain else "ollama"
        self._by_name: dict[str, ProviderAdapter] = {a.name: a for a in self.chain}

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
        """Try each provider in priority order; failover on recoverable errors.

        When the UI pins ``provider:model``, only that provider is used.
        """
        pinned, resolved_hint = parse_model_selection(model_hint)

        if pinned:
            adapter = self._by_name.get(pinned)
            if adapter is None:
                yield {
                    "type": "error",
                    "data": {
                        "code": "provider_not_configured",
                        "message": (
                            f"Provider '{pinned}' is not configured. "
                            "Add an API key in Settings → LLM Providers."
                        ),
                    },
                }
                return
            try:
                async for chunk in self._run_adapter(
                    adapter, messages, tools=tools, model_hint=resolved_hint, previous=None
                ):
                    yield chunk
            except _FailoverSignal:
                # Soft fallback: cloud pin → local Ollama (never silent)
                ollama = self._by_name.get("ollama")
                if ollama is not None and pinned != "ollama":
                    logger.warning(
                        "[router] Pinned provider %s failed — falling back to Ollama",
                        pinned,
                    )
                    try:
                        async for chunk in self._run_adapter(
                            ollama,
                            messages,
                            tools=tools,
                            model_hint=None,
                            previous=pinned,
                        ):
                            yield chunk
                        return
                    except _FailoverSignal:
                        pass
                yield {
                    "type": "error",
                    "data": {
                        "code": "provider_failed",
                        "message": (
                            f"Provider '{pinned}' failed and local Ollama fallback "
                            "is unavailable. Check API keys and Ollama."
                        ),
                    },
                }
            return

        previous: str | None = None

        for adapter in self.chain:
            health = self.health[adapter.name]

            if not health.is_available and adapter.name != "ollama":
                logger.debug(
                    "[router] Skipping %s (backoff %.0f s)",
                    adapter.name,
                    health.backoff_remaining,
                )
                continue

            try:
                async for chunk in self._run_adapter(
                    adapter,
                    messages,
                    tools=tools,
                    model_hint=resolved_hint,
                    previous=previous,
                ):
                    yield chunk
                return
            except _FailoverSignal:
                previous = adapter.name
                continue

        logger.error("[router] All providers exhausted")
        yield {
            "type": "error",
            "data": {
                "code": "all_providers_exhausted",
                "message": "All LLM providers are unavailable. Check API keys and Ollama service.",
            },
        }

    async def _run_adapter(
        self,
        adapter: ProviderAdapter,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None,
        model_hint: str | None,
        previous: str | None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        health = self.health[adapter.name]

        if previous is not None and adapter.name != previous:
            yield {
                "type": "provider_switched",
                "data": {
                    "from": previous,
                    "to": adapter.name,
                    "reason": self.health[previous].last_error_type.name
                    if self.health[previous].last_error_type
                    else "unknown",
                },
            }

        self._active = adapter.name
        logger.info(
            "[router] Using provider: %s (model=%s)",
            adapter.name,
            model_hint or "default",
        )

        try:
            async for chunk in adapter.chat_stream(
                messages, tools=tools, model_hint=model_hint
            ):
                yield chunk
            health.record_success()
        except Exception as exc:
            error_type = adapter.classify_error(exc)
            logger.warning(
                "[router] %s error: %s (%s)", adapter.name, exc, error_type.name
            )
            health.record_failure(error_type)
            yield {
                "type": "provider_health",
                "data": {
                    "provider": adapter.name,
                    "available": health.is_available,
                    "backoff_seconds": round(health.backoff_remaining),
                },
            }
            # Cloud providers always soft-fail toward Ollama except context-length
            # (same prompt would also fail locally without trimming).
            if error_type == ProviderErrorType.CONTEXT_TOO_LONG:
                raise
            if adapter.name != "ollama":
                raise _FailoverSignal() from exc
            if error_type.should_failover:
                raise _FailoverSignal() from exc
            raise


class _FailoverSignal(Exception):
    """Internal: adapter failed with a recoverable error — try next provider."""


def build_default_router() -> ProviderRouter:
    """Build a ProviderRouter with all configured adapters."""
    return build_router_sync()


def _priority_map(settings) -> dict[str, int]:
    raw = (getattr(settings, "provider_priority", None) or "").strip()
    names = [p.strip().lower() for p in raw.split(",") if p.strip()]
    if not names:
        names = ["openrouter", "claude", "openai", "gemini", "ollama"]
    return {name: (i + 1) * 10 for i, name in enumerate(names)}


def build_router_sync() -> ProviderRouter:
    """Build a ProviderRouter synchronously (for use at import time / startup).

    Order follows ``settings.provider_priority``.
    """
    from ...core.config import get_settings

    s = get_settings()
    pri = _priority_map(s)

    adapters: list[ProviderAdapter] = []

    if (getattr(s, "openrouter_api_key", None) or "").strip():
        a = OpenRouterAdapter()
        a.priority = pri.get("openrouter", 5)
        adapters.append(a)

    if (getattr(s, "anthropic_api_key", None) or "").strip():
        a = AnthropicAdapter()
        a.priority = pri.get("claude", 10)
        adapters.append(a)

    if (getattr(s, "openai_api_key", None) or "").strip():
        a = OpenAIAdapter()
        a.priority = pri.get("openai", 20)
        adapters.append(a)

    if (getattr(s, "gemini_api_key", None) or "").strip():
        a = GeminiAdapter()
        a.priority = pri.get("gemini", 30)
        adapters.append(a)

    ollama = OllamaAdapter()
    ollama.priority = pri.get("ollama", 100)
    adapters.append(ollama)

    return ProviderRouter(adapters)
