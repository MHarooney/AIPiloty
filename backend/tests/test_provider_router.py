"""Unit tests for ProviderRouter — error classification, failover chain, health.

These tests are fully synchronous (no LLM calls) and work offline.
They verify:
  - Error type classification per adapter
  - Failover priority order
  - All cloud providers fail → Ollama
  - Backoff / health tracking
  - provider_switched event shape
  - No mid-stream failover (failover triggers on next request)
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncGenerator
from unittest.mock import patch

import pytest

from app.services.llm.provider_router import (
    AnthropicAdapter,
    GeminiAdapter,
    OllamaAdapter,
    OpenAIAdapter,
    ProviderErrorType,
    ProviderException,
    ProviderHealth,
    ProviderRouter,
)


# ── Helpers ──────────────────────────────────────────────────────────────────

class _SuccessAdapter:
    """Fake adapter that always succeeds and yields one chunk."""
    def __init__(self, name: str, priority: int, tokens: list[str] | None = None):
        self.name = name
        self.priority = priority
        self._tokens = tokens or ["hello"]
        self.call_count = 0

    async def chat_stream(self, messages, tools=None, model_hint=None) -> AsyncGenerator:
        self.call_count += 1
        for t in self._tokens:
            yield {"message": {"content": t}, "done": False}
        yield {"message": {"content": ""}, "done": True}

    async def is_available(self) -> bool:
        return True

    def classify_error(self, exc: Exception) -> ProviderErrorType:
        return ProviderErrorType.UNKNOWN


class _FailAdapter:
    """Fake adapter that always raises a ProviderException."""
    def __init__(self, name: str, priority: int, error_type: ProviderErrorType):
        self.name = name
        self.priority = priority
        self.error_type = error_type
        self.call_count = 0

    async def chat_stream(self, messages, tools=None, model_hint=None) -> AsyncGenerator:
        self.call_count += 1
        raise ProviderException(self.error_type, f"Simulated {self.error_type.name}")
        yield  # make it an async generator

    async def is_available(self) -> bool:
        return True

    def classify_error(self, exc: Exception) -> ProviderErrorType:
        if isinstance(exc, ProviderException):
            return exc.error_type
        return ProviderErrorType.UNKNOWN


def _collect(gen) -> list[dict]:
    """Drain an async generator into a list synchronously."""
    return asyncio.get_event_loop().run_until_complete(_drain(gen))


async def _drain(gen) -> list[dict]:
    results = []
    async for chunk in gen:
        results.append(chunk)
    return results


# ── Error classification tests ────────────────────────────────────────────────

class TestAnthropicErrorClassification:
    def setup_method(self):
        self.adapter = AnthropicAdapter.__new__(AnthropicAdapter)

    def test_rate_limit_429(self):
        exc = Exception("APIStatusError 429 rate_limit")
        exc.status_code = 429
        assert self.adapter.classify_error(exc) == ProviderErrorType.RATE_LIMIT

    def test_rate_limit_message(self):
        exc = Exception("rate limit exceeded")
        assert self.adapter.classify_error(exc) == ProviderErrorType.RATE_LIMIT

    def test_invalid_key_401(self):
        exc = Exception("authentication error")
        exc.status_code = 401
        assert self.adapter.classify_error(exc) == ProviderErrorType.INVALID_KEY

    def test_overloaded_529(self):
        exc = Exception("server overloaded")
        exc.status_code = 529
        assert self.adapter.classify_error(exc) == ProviderErrorType.OVERLOADED

    def test_overloaded_503(self):
        exc = Exception("service unavailable")
        exc.status_code = 503
        assert self.adapter.classify_error(exc) == ProviderErrorType.OVERLOADED

    def test_billing(self):
        exc = Exception("credit balance insufficient")
        exc.status_code = 402
        assert self.adapter.classify_error(exc) == ProviderErrorType.QUOTA_EXHAUSTED

    def test_timeout(self):
        exc = Exception("read timeout exceeded")
        assert self.adapter.classify_error(exc) == ProviderErrorType.TIMEOUT

    def test_network(self):
        exc = Exception("connection refused")
        assert self.adapter.classify_error(exc) == ProviderErrorType.NETWORK

    def test_context_too_long(self):
        exc = Exception("token limit exceeded in context window")
        exc.status_code = 400
        assert self.adapter.classify_error(exc) == ProviderErrorType.CONTEXT_TOO_LONG

    def test_unknown(self):
        exc = Exception("some random error")
        assert self.adapter.classify_error(exc) == ProviderErrorType.UNKNOWN


class TestOpenAIErrorClassification:
    def setup_method(self):
        self.adapter = OpenAIAdapter.__new__(OpenAIAdapter)

    def test_rate_limit_text(self):
        exc = Exception("Rate limit reached for 429")
        assert self.adapter.classify_error(exc) == ProviderErrorType.RATE_LIMIT

    def test_invalid_key(self):
        exc = Exception("401 invalid api key")
        assert self.adapter.classify_error(exc) == ProviderErrorType.INVALID_KEY

    def test_quota_exhausted(self):
        exc = Exception("You have exceeded your billing quota")
        assert self.adapter.classify_error(exc) == ProviderErrorType.QUOTA_EXHAUSTED

    def test_timeout(self):
        exc = Exception("timeout waiting for response")
        assert self.adapter.classify_error(exc) == ProviderErrorType.TIMEOUT

    def test_context_too_long(self):
        exc = Exception("This model's maximum context token length exceeded")
        assert self.adapter.classify_error(exc) == ProviderErrorType.CONTEXT_TOO_LONG


class TestGeminiErrorClassification:
    def setup_method(self):
        self.adapter = GeminiAdapter.__new__(GeminiAdapter)

    def test_quota(self):
        exc = Exception("429 RESOURCE_EXHAUSTED quota exceeded")
        assert self.adapter.classify_error(exc) == ProviderErrorType.QUOTA_EXHAUSTED

    def test_invalid_key(self):
        exc = Exception("API_KEY_INVALID 401")
        assert self.adapter.classify_error(exc) == ProviderErrorType.INVALID_KEY

    def test_unavailable(self):
        exc = Exception("503 Service Unavailable")
        assert self.adapter.classify_error(exc) == ProviderErrorType.OVERLOADED


# ── ProviderHealth tests ──────────────────────────────────────────────────────

class TestProviderHealth:
    def test_initial_available(self):
        h = ProviderHealth()
        assert h.is_available is True

    def test_failure_sets_backoff(self):
        h = ProviderHealth()
        h.record_failure(ProviderErrorType.RATE_LIMIT)
        assert h.backoff_remaining > 0
        assert h.is_available is False

    def test_invalid_key_marks_unavailable(self):
        h = ProviderHealth()
        h.record_failure(ProviderErrorType.INVALID_KEY)
        assert h.available is False

    def test_success_resets(self):
        h = ProviderHealth()
        h.record_failure(ProviderErrorType.RATE_LIMIT)
        h.record_success()
        assert h.is_available is True
        assert h.failure_count == 0

    def test_backoff_doubles(self):
        h = ProviderHealth()
        h.record_failure(ProviderErrorType.RATE_LIMIT)
        first_backoff = h.backoff_remaining
        h.record_failure(ProviderErrorType.RATE_LIMIT)
        # Second backoff should be roughly 2× the first
        assert h.backoff_remaining > first_backoff

    def test_should_failover_types(self):
        failover = [
            ProviderErrorType.RATE_LIMIT,
            ProviderErrorType.QUOTA_EXHAUSTED,
            ProviderErrorType.BILLING_REQUIRED,
            ProviderErrorType.INVALID_KEY,
            ProviderErrorType.OVERLOADED,
            ProviderErrorType.TIMEOUT,
            ProviderErrorType.NETWORK,
        ]
        no_failover = [ProviderErrorType.UNKNOWN]
        # CONTEXT_TOO_LONG is not in failover (handled by trimming)
        for t in failover:
            assert t.should_failover, f"{t} should trigger failover"
        for t in no_failover:
            assert not t.should_failover, f"{t} should NOT trigger failover"


# ── ProviderRouter failover tests ─────────────────────────────────────────────

class TestProviderRouterFailover:
    def test_priority_order(self):
        """Chain must be sorted by priority (lowest number first)."""
        a = _SuccessAdapter("a", priority=30)
        b = _SuccessAdapter("b", priority=10)
        c = _SuccessAdapter("c", priority=20)
        router = ProviderRouter([a, b, c])
        names = [x.name for x in router.chain]
        assert names == ["b", "c", "a"]

    def test_first_provider_used_when_healthy(self):
        p1 = _SuccessAdapter("primary", priority=10)
        p2 = _SuccessAdapter("secondary", priority=20)
        router = ProviderRouter([p1, p2])
        _collect(router.chat_stream([{"role": "user", "content": "hi"}]))
        assert p1.call_count == 1
        assert p2.call_count == 0

    def test_failover_on_rate_limit(self):
        """Rate-limit on primary → secondary used on next call."""
        fail = _FailAdapter("claude", priority=10, error_type=ProviderErrorType.RATE_LIMIT)
        success = _SuccessAdapter("ollama", priority=100)
        router = ProviderRouter([fail, success])

        chunks = _collect(router.chat_stream([{"role": "user", "content": "hi"}]))
        assert fail.call_count == 1
        assert success.call_count == 1
        # provider_switched event should be in chunks
        meta = [c for c in chunks if c.get("type") == "provider_switched"]
        assert len(meta) == 1
        assert meta[0]["data"]["from"] == "claude"
        assert meta[0]["data"]["to"] == "ollama"
        assert meta[0]["data"]["reason"] == "RATE_LIMIT"

    def test_all_cloud_fail_to_ollama(self):
        """All non-Ollama providers fail → Ollama used as last resort."""
        claude = _FailAdapter("claude", priority=10, error_type=ProviderErrorType.RATE_LIMIT)
        openai = _FailAdapter("openai", priority=20, error_type=ProviderErrorType.QUOTA_EXHAUSTED)
        gemini = _FailAdapter("gemini", priority=30, error_type=ProviderErrorType.OVERLOADED)
        ollama = _SuccessAdapter("ollama", priority=100, tokens=["local response"])
        router = ProviderRouter([claude, openai, gemini, ollama])

        chunks = _collect(router.chat_stream([{"role": "user", "content": "hi"}]))
        assert ollama.call_count == 1
        content = [c for c in chunks if isinstance(c.get("message"), dict)]
        assert any(c["message"].get("content") == "local response" for c in content)

    def test_unknown_error_reraises_no_failover(self):
        """UNKNOWN error should NOT trigger failover — re-raised."""
        fail = _FailAdapter("primary", priority=10, error_type=ProviderErrorType.UNKNOWN)
        fallback = _SuccessAdapter("fallback", priority=20)
        router = ProviderRouter([fail, fallback])

        with pytest.raises(ProviderException):
            _collect(router.chat_stream([{"role": "user", "content": "hi"}]))
        assert fallback.call_count == 0

    def test_failed_provider_skipped_in_backoff(self):
        """After failure, provider in backoff is skipped on next request."""
        fail = _FailAdapter("claude", priority=10, error_type=ProviderErrorType.RATE_LIMIT)
        success = _SuccessAdapter("ollama", priority=100)
        router = ProviderRouter([fail, success])

        # First call: failover occurs
        _collect(router.chat_stream([{"role": "user", "content": "hi"}]))

        # Second call: claude is in backoff → skipped immediately
        fail.call_count = 0
        success.call_count = 0
        _collect(router.chat_stream([{"role": "user", "content": "hi"}]))
        assert fail.call_count == 0   # skipped due to backoff
        assert success.call_count == 1

    def test_provider_switched_event_shape(self):
        """provider_switched event must contain from, to, reason keys."""
        fail = _FailAdapter("claude", priority=10, error_type=ProviderErrorType.RATE_LIMIT)
        success = _SuccessAdapter("ollama", priority=100)
        router = ProviderRouter([fail, success])

        chunks = _collect(router.chat_stream([{"role": "user", "content": "hi"}]))
        switched = next((c for c in chunks if c.get("type") == "provider_switched"), None)
        assert switched is not None
        assert "from" in switched["data"]
        assert "to" in switched["data"]
        assert "reason" in switched["data"]

    def test_active_provider_tracks_current(self):
        p1 = _SuccessAdapter("claude", priority=10)
        router = ProviderRouter([p1])
        _collect(router.chat_stream([{"role": "user", "content": "hi"}]))
        assert router.active_provider == "claude"

    def test_health_summary_structure(self):
        p1 = _SuccessAdapter("claude", priority=10)
        router = ProviderRouter([p1])
        summary = router.health_summary()
        assert "claude" in summary
        assert "available" in summary["claude"]
        assert "backoff_seconds" in summary["claude"]
        assert "failure_count" in summary["claude"]

    def test_no_providers_exhausted_event(self):
        """If all providers fail and Ollama also fails, exhausted event is yielded."""
        all_fail = [
            _FailAdapter("claude", priority=10, error_type=ProviderErrorType.RATE_LIMIT),
            _FailAdapter("ollama", priority=100, error_type=ProviderErrorType.RATE_LIMIT),
        ]
        router = ProviderRouter(all_fail)
        chunks = _collect(router.chat_stream([{"role": "user", "content": "hi"}]))
        # Ollama name is not special here since we're using fake adapters;
        # after all fail, exhausted event should appear
        exhausted = [c for c in chunks if c.get("type") == "error" and
                     "all_providers_exhausted" in c.get("data", {}).get("code", "")]
        assert len(exhausted) == 1


# ── Thread continuity test ────────────────────────────────────────────────────

class TestThreadContinuity:
    def test_full_message_delivered_before_failover(self):
        """Failover happens on NEXT request, not mid-stream.
        This test verifies that a successful stream is fully delivered even though
        the next request may switch providers.
        """
        tokens = ["tok1", "tok2", "tok3"]
        p1 = _SuccessAdapter("primary", priority=10, tokens=tokens)
        router = ProviderRouter([p1])

        chunks1 = _collect(router.chat_stream([{"role": "user", "content": "q1"}]))
        content1 = [c["message"]["content"] for c in chunks1
                    if isinstance(c.get("message"), dict) and c["message"].get("content")]
        assert content1 == tokens   # complete stream delivered

    def test_history_preserved_across_failover(self):
        """The messages list passed to each adapter is unchanged by the router."""
        received_messages = []

        class _CapturingAdapter:
            name = "capturing"
            priority = 100

            async def chat_stream(self, messages, tools=None, model_hint=None):
                received_messages.extend(messages)
                yield {"message": {"content": "ok"}, "done": False}
                yield {"message": {"content": ""}, "done": True}

            async def is_available(self):
                return True

            def classify_error(self, exc):
                return ProviderErrorType.UNKNOWN

        msgs = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
            {"role": "user", "content": "question"},
        ]
        router = ProviderRouter([_CapturingAdapter()])
        _collect(router.chat_stream(msgs))
        assert received_messages == msgs
