"""Logs API — expose recent structured log entries."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ...core.auth import require_auth
from ...core.logging import get_recent_logs

router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("/")
async def list_logs(
    limit: int = Query(100, ge=1, le=500),
    level: str | None = Query(None, description="Filter by log level: DEBUG, INFO, WARNING, ERROR"),
    identity: str = Depends(require_auth),
):
    """Return the most recent structured log entries."""
    entries = get_recent_logs(limit=limit, level=level)
    return {"count": len(entries), "entries": entries}
