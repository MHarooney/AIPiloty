"""Metrics collection — lightweight in-memory counters and timing."""

from __future__ import annotations

import asyncio
import collections
import time
from typing import Any


class _MetricsStore:
    """Async-safe in-memory metrics with sliding window.

    Uses asyncio.Lock instead of threading.Lock so it is safe to use
    inside async route handlers and SSE generators without risking a
    deadlock if a coroutine suspends at an await point while the lock
    is held.
    """

    def __init__(self, window_seconds: int = 3600):
        self._lock: asyncio.Lock | None = None  # created lazily after the event loop starts
        self._window = window_seconds
        # event_name -> list of (timestamp, duration_ms)
        self._timings: dict[str, list[tuple[float, float]]] = collections.defaultdict(list)
        # event_name -> count
        self._counters: dict[str, int] = collections.defaultdict(int)
        self._errors: dict[str, int] = collections.defaultdict(int)

    def _get_lock(self) -> asyncio.Lock:
        # asyncio.Lock must be created inside a running event loop.
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    def _prune(self, entries: list[tuple[float, float]]) -> list[tuple[float, float]]:
        cutoff = time.time() - self._window
        return [e for e in entries if e[0] >= cutoff]

    async def record_timing(self, name: str, duration_ms: float) -> None:
        async with self._get_lock():
            self._timings[name].append((time.time(), duration_ms))

    async def increment(self, name: str, count: int = 1) -> None:
        async with self._get_lock():
            self._counters[name] += count

    async def record_error(self, name: str) -> None:
        async with self._get_lock():
            self._errors[name] += 1

    async def get_summary(self) -> dict[str, Any]:
        async with self._get_lock():
            result: dict[str, Any] = {}

            # Timing summaries
            timing_summary = {}
            for name, entries in self._timings.items():
                pruned = self._prune(entries)
                self._timings[name] = pruned
                if pruned:
                    durations = sorted(d for _, d in pruned)
                    n = len(durations)
                    timing_summary[name] = {
                        "count": n,
                        "p50_ms": durations[n // 2] if n else 0,
                        "p95_ms": durations[int(n * 0.95)] if n else 0,
                        "avg_ms": round(sum(durations) / n, 1),
                        "max_ms": round(max(durations), 1),
                    }
            result["timings"] = timing_summary

            # Counters
            result["counters"] = dict(self._counters)

            # Errors
            result["errors"] = dict(self._errors)

            return result

    async def snapshot(self) -> dict[str, Any]:
        """Compact summary for periodic logging (scheduler)."""
        summary = await self.get_summary()
        counters = summary.get("counters", {})
        err_by_name = summary.get("errors", {})
        total_err = int(counters.get("errors", 0)) + sum(int(v) for v in err_by_name.values())
        chat_timing = summary.get("timings", {}).get("chat_response", {})
        return {
            "total_requests": int(counters.get("chat_requests", 0)),
            "total_errors": total_err,
            "avg_latency_ms": float(chat_timing.get("avg_ms", 0) or 0),
        }


# Singleton
metrics = _MetricsStore()
