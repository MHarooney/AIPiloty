"""Image provider secrets API — store OpenAI / Gemini keys encrypted in DB.

Never returns raw API keys. Keys are managed from Settings UI only.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...services.provider_secrets import (
    SUPPORTED_PROVIDERS,
    delete_secret,
    list_secrets,
    public_catalog,
    upsert_secret,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/providers", tags=["Providers"])


class UpsertProviderSecret(BaseModel):
    provider: str = Field(..., description="openai | gemini")
    api_key: str = Field(..., min_length=8, max_length=512)
    default_model: Optional[str] = None
    label: Optional[str] = None


class UpdateProviderDefaults(BaseModel):
    default_model: Optional[str] = None
    label: Optional[str] = None
    is_active: Optional[bool] = None


@router.get("/image")
async def list_image_providers(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List configured providers (masked) + full model catalog."""
    rows = await list_secrets(db)
    configured = {r.provider for r in rows if r.is_active and r.api_key_encrypted}
    return {
        "supported_providers": list(SUPPORTED_PROVIDERS),
        "secrets": [r.to_public_dict() for r in rows],
        "models": public_catalog(configured),
        "note": "API keys are stored encrypted. They are never returned by this API.",
    }


@router.put("/image/{provider}")
async def upsert_image_provider(
    provider: str,
    body: UpsertProviderSecret,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Create or replace an encrypted API key for a provider."""
    if body.provider.strip().lower() != provider.strip().lower():
        raise HTTPException(400, "URL provider must match body.provider")
    try:
        row = await upsert_secret(
            db,
            provider=provider,
            api_key=body.api_key,
            default_model=body.default_model,
            label=body.label,
        )
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    logger.info("Image provider secret upserted: %s (by %s)", provider, identity)
    return {"success": True, "secret": row.to_public_dict()}


@router.delete("/image/{provider}")
async def delete_image_provider(
    provider: str,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Remove a stored API key."""
    ok = await delete_secret(db, provider)
    if not ok:
        raise HTTPException(404, f"No secret for provider '{provider}'")
    logger.info("Image provider secret deleted: %s (by %s)", provider, identity)
    return {"success": True}


@router.get("/image/models")
async def list_image_models(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Models available given currently configured keys."""
    rows = await list_secrets(db)
    configured = {r.provider for r in rows if r.is_active and r.api_key_encrypted}
    return {"models": public_catalog(configured), "configured_providers": sorted(configured)}


# ── LLM ProviderRouter health ─────────────────────────────────────────────────

@router.get("/llm/health")
async def llm_provider_health(identity: str = Depends(require_auth)):
    """Return ProviderRouter health summary (active provider, backoffs, chain order)."""
    from ...main import app_state
    router_obj = app_state.get("provider_router")
    if router_obj is None:
        return {"active": "ollama", "chain": ["ollama"], "health": {}}
    return {
        "active": router_obj.active_provider,
        "chain": [a.name for a in router_obj.chain],
        "health": router_obj.health_summary(),
    }

