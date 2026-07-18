"""Session-scoped pending high-risk actions for CONFIRMATION routing.

When the orchestrator emits ``approval_required``, it stores the proposed
tool call here. A later ``yes`` / ``no`` (typed in chat) can confirm or
cancel without relying only on the UI Approve button.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Any, Optional

_TTL_SECONDS = 30 * 60  # 30 minutes


@dataclass
class PendingAction:
    session_key: str
    tool_name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    risk_level: str = "high"
    summary: str = ""
    created_at: float = field(default_factory=time.time)

    def is_expired(self, now: float | None = None) -> bool:
        return ((now or time.time()) - self.created_at) > _TTL_SECONDS


class PendingActionStore:
    """Thread-safe in-memory pending-action registry (per process)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[str, PendingAction] = {}

    def set(
        self,
        session_key: str,
        *,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        risk_level: str = "high",
        summary: str = "",
    ) -> PendingAction:
        if not session_key:
            raise ValueError("session_key is required for pending actions")
        action = PendingAction(
            session_key=session_key,
            tool_name=tool_name,
            arguments=dict(arguments or {}),
            risk_level=risk_level,
            summary=summary or f"Execute {tool_name}",
        )
        with self._lock:
            self._prune_locked()
            self._items[session_key] = action
        return action

    def get(self, session_key: str | None) -> Optional[PendingAction]:
        if not session_key:
            return None
        with self._lock:
            self._prune_locked()
            action = self._items.get(session_key)
            if action and action.is_expired():
                self._items.pop(session_key, None)
                return None
            return action

    def pop(self, session_key: str | None) -> Optional[PendingAction]:
        if not session_key:
            return None
        with self._lock:
            self._prune_locked()
            return self._items.pop(session_key, None)

    def clear(self, session_key: str | None) -> None:
        if not session_key:
            return
        with self._lock:
            self._items.pop(session_key, None)

    def has(self, session_key: str | None) -> bool:
        return self.get(session_key) is not None

    def _prune_locked(self) -> None:
        now = time.time()
        expired = [k for k, v in self._items.items() if v.is_expired(now)]
        for k in expired:
            del self._items[k]


# Process singleton
pending_actions = PendingActionStore()
