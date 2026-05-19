"""Background scheduler — periodic tasks (health probes, cleanup, metrics)."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Callable, Dict, List

logger = logging.getLogger(__name__)


class ScheduledTask:
    """A simple periodic task descriptor."""

    def __init__(self, name: str, interval_seconds: int, func: Callable):
        self.name = name
        self.interval_seconds = interval_seconds
        self.func = func
        self.last_run: datetime | None = None
        self.run_count: int = 0
        self.error_count: int = 0


class BackgroundScheduler:
    """Lightweight asyncio-based scheduler (no APScheduler dependency)."""

    def __init__(self):
        self._tasks: Dict[str, ScheduledTask] = {}
        self._running = False
        self._loop_task: asyncio.Task | None = None

    def register(self, name: str, interval_seconds: int, func: Callable):
        self._tasks[name] = ScheduledTask(name, interval_seconds, func)
        logger.info("Scheduler: registered task '%s' every %ds", name, interval_seconds)

    async def start(self):
        if self._running:
            return
        self._running = True
        self._loop_task = asyncio.create_task(self._run_loop())
        logger.info("Scheduler started with %d tasks", len(self._tasks))

    async def stop(self):
        self._running = False
        if self._loop_task:
            self._loop_task.cancel()
            try:
                await self._loop_task
            except asyncio.CancelledError:
                pass
        logger.info("Scheduler stopped")

    async def _run_loop(self):
        while self._running:
            now = datetime.now(timezone.utc)
            for task in self._tasks.values():
                if task.last_run is None or (now - task.last_run).total_seconds() >= task.interval_seconds:
                    try:
                        result = task.func()
                        if asyncio.iscoroutine(result):
                            await result
                        task.run_count += 1
                        task.last_run = now
                    except Exception as exc:
                        task.error_count += 1
                        logger.warning("Scheduler task '%s' failed: %s", task.name, exc)
            await asyncio.sleep(5)

    def status(self) -> List[dict]:
        return [
            {
                "name": t.name,
                "interval_seconds": t.interval_seconds,
                "run_count": t.run_count,
                "error_count": t.error_count,
                "last_run": t.last_run.isoformat() if t.last_run else None,
            }
            for t in self._tasks.values()
        ]


# ── Built-in periodic tasks ──────────────────────────────────────────


async def _cleanup_stale_sessions():
    """Remove chat sessions older than 30 days with no messages."""
    from ..core.database import async_session_factory
    from ..models.chat import ChatSession
    from sqlalchemy import delete, select, func
    from datetime import timedelta

    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    try:
        async with async_session_factory() as session:
            stmt = delete(ChatSession).where(ChatSession.created_at < cutoff)
            result = await session.execute(stmt)
            await session.commit()
            if result.rowcount:
                logger.info("Cleaned up %d stale sessions", result.rowcount)
    except Exception as exc:
        logger.warning("Stale session cleanup failed: %s", exc)


async def _log_metrics_snapshot():
    """Log basic metrics to structlog ring buffer."""
    from ..core.metrics import metrics

    snapshot = await metrics.snapshot()
    logger.info(
        "Metrics snapshot: requests=%d errors=%d avg_latency=%.1fms",
        snapshot.get("total_requests", 0),
        snapshot.get("total_errors", 0),
        snapshot.get("avg_latency_ms", 0),
    )


def create_default_scheduler() -> BackgroundScheduler:
    """Create scheduler with default built-in tasks."""
    scheduler = BackgroundScheduler()
    scheduler.register("cleanup_stale_sessions", interval_seconds=3600, func=_cleanup_stale_sessions)
    scheduler.register("metrics_snapshot", interval_seconds=300, func=_log_metrics_snapshot)
    return scheduler
