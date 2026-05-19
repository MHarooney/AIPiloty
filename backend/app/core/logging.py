"""Structured logging configuration with in-memory ring buffer for /logs endpoint."""

from __future__ import annotations

import collections
import json
import logging
import sys
import time
from datetime import datetime, timezone
from typing import Any

import structlog


# ── Ring buffer for recent log entries ─────────────
_MAX_ENTRIES = 500
_log_buffer: collections.deque[dict] = collections.deque(maxlen=_MAX_ENTRIES)


def get_recent_logs(limit: int = 100, level: str | None = None) -> list[dict]:
    """Return the most recent log entries, optionally filtered by level."""
    entries = list(_log_buffer)
    if level:
        entries = [e for e in entries if e.get("level", "").upper() == level.upper()]
    return entries[-limit:]


def _buffer_processor(logger: Any, method_name: str, event_dict: dict) -> dict:
    """structlog processor that pushes each log entry into the ring buffer."""
    entry = {
        "timestamp": event_dict.get("timestamp", datetime.now(timezone.utc).isoformat()),
        "level": method_name.upper(),
        "event": event_dict.get("event", ""),
        "logger": event_dict.get("logger", ""),
    }
    # Include extra keys (excluding structlog internals)
    for k, v in event_dict.items():
        if k not in ("timestamp", "event", "logger", "level", "_record"):
            try:
                json.dumps(v)  # only include JSON-serializable extras
                entry[k] = v
            except (TypeError, ValueError):
                entry[k] = str(v)
    _log_buffer.append(entry)
    return event_dict


def _inject_request_id(logger: Any, method_name: str, event_dict: dict) -> dict:
    """structlog processor that injects the current X-Request-ID into every log record."""
    from ..middleware.request_id import request_id_ctx
    req_id = request_id_ctx.get("")
    if req_id:
        event_dict["request_id"] = req_id
    return event_dict


def setup_logging(log_level: str = "INFO") -> None:
    """Configure structlog + stdlib logging with JSON output and ring buffer."""

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        _inject_request_id,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        _buffer_processor,
    ]

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty()),
        ],
        foreign_pre_chain=shared_processors,
    )

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(getattr(logging, log_level.upper(), logging.INFO))

    # Quiet noisy libraries
    for name in ("uvicorn.access", "httpcore", "httpx", "asyncio"):
        logging.getLogger(name).setLevel(logging.WARNING)
