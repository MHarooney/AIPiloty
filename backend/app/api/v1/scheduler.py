"""Scheduler jobs API routes — CRUD + toggle."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.auth import require_auth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scheduler", tags=["Scheduler"])

# In-memory job store
_jobs: dict[int, dict[str, Any]] = {}
_next_id = 1


class JobCreate(BaseModel):
    name: str
    command: str
    cron: str = "0 * * * *"
    enabled: bool = True


class JobOut(BaseModel):
    id: int
    name: str
    command: str
    cron: str
    enabled: bool
    last_run: str | None = None
    created_at: str


@router.get("/jobs", response_model=list[JobOut])
async def list_jobs(identity: str = Depends(require_auth)):
    return list(_jobs.values())


@router.post("/jobs", response_model=JobOut)
async def create_job(payload: JobCreate, identity: str = Depends(require_auth)):
    global _next_id
    job = {
        "id": _next_id,
        "name": payload.name,
        "command": payload.command,
        "cron": payload.cron,
        "enabled": payload.enabled,
        "last_run": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _jobs[_next_id] = job
    _next_id += 1
    return job


@router.delete("/jobs/{job_id}")
async def delete_job(job_id: int, identity: str = Depends(require_auth)):
    if job_id not in _jobs:
        raise HTTPException(404, "Job not found")
    del _jobs[job_id]
    return {"status": "deleted"}


@router.post("/jobs/{job_id}/toggle")
async def toggle_job(job_id: int, identity: str = Depends(require_auth)):
    if job_id not in _jobs:
        raise HTTPException(404, "Job not found")
    _jobs[job_id]["enabled"] = not _jobs[job_id]["enabled"]
    return _jobs[job_id]


@router.get("/status")
async def scheduler_status(identity: str = Depends(require_auth)):
    """Return the built-in scheduler task statuses."""
    from ...main import app_state

    scheduler = app_state.get("scheduler")
    if not scheduler:
        return {"tasks": [], "running": False}
    return {"tasks": scheduler.status(), "running": True}
