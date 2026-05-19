"""Audit log API — list and record system events."""

from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.database import get_db
from ...models.audit_log import AuditLog

router = APIRouter(prefix="/audit-log", tags=["audit-log"])


@router.get("")
async def list_audit_logs(
    action: Optional[str] = Query(None, description="Filter by action type"),
    user: Optional[str] = Query(None, description="Filter by user"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    """List audit log entries with optional filters."""
    query = select(AuditLog)

    if action:
        query = query.where(AuditLog.action == action)
    if user:
        query = query.where(AuditLog.user == user)

    # Total count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Fetch page
    query = query.order_by(desc(AuditLog.created_at)).limit(limit).offset(offset)
    result = await db.execute(query)
    rows = result.scalars().all()

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "entries": [
            {
                "id": r.id,
                "action": r.action,
                "user": r.user,
                "resource": r.resource,
                "details": json.loads(r.details) if r.details else None,
                "ip_address": r.ip_address,
                "created_at": r.created_at.isoformat() if r.created_at else None,
            }
            for r in rows
        ],
    }


@router.get("/actions")
async def list_audit_actions(db: AsyncSession = Depends(get_db)):
    """List distinct action types recorded so far."""
    result = await db.execute(select(AuditLog.action).distinct())
    return {"actions": [row[0] for row in result.all()]}
