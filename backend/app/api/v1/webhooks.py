"""Webhook configuration API routes — CRUD + test."""

from __future__ import annotations

import hashlib
import hmac
import logging
import secrets
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.auth import require_auth

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

# In-memory store (production would use DB)
_webhooks: dict[int, dict[str, Any]] = {}
_next_id = 1


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


@router.get("/", response_model=list[WebhookOut])
async def list_webhooks(identity: str = Depends(require_auth)):
    return list(_webhooks.values())


@router.post("/", response_model=WebhookOut)
async def create_webhook(payload: WebhookCreate, identity: str = Depends(require_auth)):
    global _next_id
    wh = {
        "id": _next_id,
        "name": payload.name,
        "url": payload.url,
        "secret": payload.secret or secrets.token_hex(16),
        "events": payload.events,
        "active": payload.active,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _webhooks[_next_id] = wh
    _next_id += 1
    return wh


@router.delete("/{webhook_id}")
async def delete_webhook(webhook_id: int, identity: str = Depends(require_auth)):
    if webhook_id not in _webhooks:
        raise HTTPException(404, "Webhook not found")
    del _webhooks[webhook_id]
    return {"status": "deleted"}


@router.post("/{webhook_id}/test")
async def test_webhook(webhook_id: int, identity: str = Depends(require_auth)):
    wh = _webhooks.get(webhook_id)
    if not wh:
        raise HTTPException(404, "Webhook not found")

    payload = {"event": "test.ping", "timestamp": datetime.now(timezone.utc).isoformat()}
    import json
    body = json.dumps(payload)

    headers = {"Content-Type": "application/json", "X-AIPiloty-Event": "test.ping"}
    if wh.get("secret"):
        sig = hmac.new(wh["secret"].encode(), body.encode(), hashlib.sha256).hexdigest()
        headers["X-AIPiloty-Signature"] = f"sha256={sig}"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(wh["url"], content=body, headers=headers)
        return {"status": "sent", "response_code": resp.status_code}
    except Exception as e:
        return {"status": "failed", "error": str(e)}
