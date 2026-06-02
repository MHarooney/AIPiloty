"""Webhook configuration API routes — CRUD + test + inbound receive."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import secrets
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.webhook import Webhook

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


class WebhookCreate(BaseModel):
    name: str
    url: str
    secret: str = ""
    events: list[str] = Field(default_factory=lambda: ["deployment.success"])
    active: bool = True


class WebhookOut(BaseModel):
    id: int
    name: str
    url: str
    secret: str = ""
    events: list[str]
    active: bool
    created_at: str


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[WebhookOut])
async def list_webhooks(
    limit: int = 100,
    offset: int = 0,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Webhook).order_by(Webhook.id.desc()).limit(limit).offset(offset)
    )
    return [WebhookOut(**w.to_dict()) for w in result.scalars().all()]


@router.post("/", response_model=WebhookOut)
async def create_webhook(
    payload: WebhookCreate,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    wh = Webhook(
        name=payload.name,
        url=payload.url,
        secret=payload.secret or secrets.token_hex(16),
        active=payload.active,
    )
    wh.events = payload.events
    db.add(wh)
    await db.flush()
    await db.refresh(wh)
    return WebhookOut(**wh.to_dict())


@router.delete("/{webhook_id}")
async def delete_webhook(
    webhook_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Webhook).where(Webhook.id == webhook_id))
    wh = result.scalar_one_or_none()
    if not wh:
        raise HTTPException(404, "Webhook not found")
    await db.delete(wh)
    await db.commit()
    return {"status": "deleted"}


@router.post("/{webhook_id}/test")
async def test_webhook(
    webhook_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Webhook).where(Webhook.id == webhook_id))
    wh = result.scalar_one_or_none()
    if not wh:
        raise HTTPException(404, "Webhook not found")

    body_dict = {"event": "test.ping", "timestamp": datetime.now(timezone.utc).isoformat()}
    body = json.dumps(body_dict)
    headers = {"Content-Type": "application/json", "X-AIPiloty-Event": "test.ping"}
    if wh.secret:
        sig = hmac.new(wh.secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        headers["X-AIPiloty-Signature"] = f"sha256={sig}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(wh.url, content=body, headers=headers)
        return {"status": "sent", "response_code": resp.status_code}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


# ── Inbound receive (public — no auth) ───────────────────────────────────────

@router.post("/receive/{webhook_secret}")
async def receive_webhook(
    webhook_secret: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Public endpoint. A CI/CD system (e.g. GitHub Actions) POSTs here to trigger
    a deployment pipeline. Validates optional HMAC-SHA256 signature when present.
    """
    from ...models.deployment import Deployment, DeploymentRun, DeploymentStatus, RunStatus, TriggerType
    from ...main import app_state
    from ...services.deployment.pipeline_executor import PipelineExecutor

    # Find deployment by webhook_secret
    dep_result = await db.execute(
        select(Deployment).where(Deployment.webhook_secret == webhook_secret)
    )
    dep = dep_result.scalar_one_or_none()
    if not dep:
        # Return 200 to avoid leaking existence — but log it
        logger.warning("Received webhook for unknown secret (masked)")
        return {"status": "ignored"}

    # Validate HMAC if provided
    raw_body = await request.body()
    sig_header = request.headers.get("X-Hub-Signature-256") or request.headers.get("X-AIPiloty-Signature")
    if sig_header and dep.webhook_secret:
        expected = "sha256=" + hmac.new(
            dep.webhook_secret.encode(), raw_body, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(sig_header, expected):
            raise HTTPException(403, "Invalid webhook signature")

    # Create run record
    run = DeploymentRun(
        deployment_id=dep.id,
        trigger=TriggerType.WEBHOOK,
        triggered_by="webhook",
        status=RunStatus.RUNNING,
    )
    db.add(run)
    await db.flush()
    run_id = run.id
    dep.status = DeploymentStatus.DEPLOYING
    dep_config = dep.to_dict()
    await db.commit()

    # Fire-and-forget background pipeline (non-SSE — logs saved to DeploymentRun.log)
    executor = PipelineExecutor(app_state.get("ssh_executor"))

    async def _consume_stream() -> None:
        async for _ in executor.stream_run(dep_config, run_id):
            pass  # _finalize_run handles DB updates

    asyncio.create_task(_consume_stream())

    return {"status": "triggered", "deployment_id": dep.id, "run_id": run_id}
