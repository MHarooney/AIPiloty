"""Metrics API — expose runtime performance data."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ...core.auth import require_auth
from ...core.metrics import metrics

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/")
async def get_metrics(identity: str = Depends(require_auth)):
    """Return current metrics summary (timings, counters, errors)."""
    return await metrics.get_summary()
