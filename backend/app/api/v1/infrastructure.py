"""Infrastructure stats API — aggregated platform overview."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.deployment import Deployment, DeploymentStatus
from ...models.vm import VMCredential
from ...models.chat import ChatSession

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/infrastructure", tags=["Infrastructure"])


@router.get("/stats")
async def get_infrastructure_stats(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    # VM stats
    vm_total = (await db.execute(select(func.count(VMCredential.id)))).scalar() or 0
    vm_active = (await db.execute(
        select(func.count(VMCredential.id)).where(VMCredential.is_active == True)
    )).scalar() or 0

    # Deployment stats
    dep_total = (await db.execute(select(func.count(Deployment.id)))).scalar() or 0
    dep_running = (await db.execute(
        select(func.count(Deployment.id)).where(Deployment.status == DeploymentStatus.RUNNING)
    )).scalar() or 0
    dep_failed = (await db.execute(
        select(func.count(Deployment.id)).where(Deployment.status == DeploymentStatus.FAILED)
    )).scalar() or 0

    # Chat stats
    chat_total = (await db.execute(select(func.count(ChatSession.id)))).scalar() or 0

    # Scheduler
    from ...main import app_state
    scheduler = app_state.get("scheduler")
    scheduler_tasks = len(scheduler.status()) if scheduler else 0

    # Tool registry
    registry = app_state.get("registry")
    tools_count = len(registry.tool_names) if registry else 0

    return {
        "vms": {"total": vm_total, "active": vm_active},
        "deployments": {"total": dep_total, "running": dep_running, "failed": dep_failed},
        "chat_sessions": chat_total,
        "scheduler_tasks": scheduler_tasks,
        "registered_tools": tools_count,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
