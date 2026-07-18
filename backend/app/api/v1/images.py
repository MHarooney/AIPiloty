"""Image generation API routes — generate, history, serve, delete."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.image import GeneratedImage
from ...main import app_state

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/images", tags=["Images"])


class GenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    negative_prompt: str = Field("", max_length=1000)
    width: int = Field(512, ge=64, le=2048)
    height: int = Field(512, ge=64, le=2048)
    steps: int = Field(20, ge=1, le=100)
    seed: Optional[int] = None
    model: Optional[str] = None
    provider: Optional[str] = None


class GenerateResponse(BaseModel):
    success: bool
    image_id: Optional[str] = None
    path: Optional[str] = None
    seed: Optional[int] = None
    width: Optional[int] = None
    height: Optional[int] = None
    generation_time_ms: Optional[int] = None
    error: Optional[str] = None


class ImageInfo(BaseModel):
    id: int
    image_id: str
    prompt: str
    negative_prompt: Optional[str]
    width: int
    height: int
    steps: int
    seed: Optional[int]
    model: Optional[str]
    provider: str
    relative_path: str
    file_size: int
    generation_time_ms: int
    status: str
    created_at: str
    error_message: Optional[str] = None


class HistoryResponse(BaseModel):
    images: list[ImageInfo]
    total: int
    page: int
    per_page: int


def _get_image_service():
    svc = app_state.get("image_service")
    if not svc:
        raise HTTPException(503, "Image generation service not initialized")
    return svc


@router.get("/provider/status")
async def provider_status(identity: str = Depends(require_auth)):
    """Return info about the active image generation provider."""
    from ...services.provider_secrets import configured_provider_ids, public_catalog

    svc = _get_image_service()
    available = await svc.is_configured()
    configured = await configured_provider_ids()
    return {
        "provider": svc.provider_name,
        "available": available,
        "configured_providers": sorted(configured),
        "models": public_catalog(configured),
        "supported_providers": ["openai", "gemini", "placeholder", "external_api", "sdxl_turbo"],
        "secrets_ui": "Settings → Image Providers (keys encrypted in DB, not .env)",
    }


@router.post("/generate", response_model=GenerateResponse)
async def generate_image(
    req: GenerateRequest,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Generate an image from a text prompt."""
    svc = _get_image_service()

    result = await svc.generate(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        width=req.width,
        height=req.height,
        steps=req.steps,
        seed=req.seed,
        model=req.model,
        provider=req.provider,
    )

    if result.needs_input:
        return GenerateResponse(
            success=False,
            error=result.error or "Choose an image model or add an API key in Settings.",
        )

    # Persist to DB
    record = GeneratedImage(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        width=result.width if result.success else req.width,
        height=result.height if result.success else req.height,
        steps=req.steps,
        seed=result.seed if result.success else req.seed,
        model=result.model or req.model or svc.provider_name,
        provider=result.provider or svc.provider_name,
        relative_path=result.relative_path if result.success else "",
        file_size=result.file_size if result.success else 0,
        generation_time_ms=result.generation_time_ms if result.success else 0,
        status="completed" if result.success else "failed",
        error_message=result.error if not result.success else None,
    )
    db.add(record)
    await db.flush()
    await db.refresh(record)

    if not result.success:
        return GenerateResponse(success=False, error=result.error)

    return GenerateResponse(
        success=True,
        image_id=record.image_id,
        path=result.relative_path,
        seed=result.seed,
        width=result.width,
        height=result.height,
        generation_time_ms=result.generation_time_ms,
    )


@router.get("/history", response_model=HistoryResponse)
async def image_history(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get paginated image generation history."""
    total_q = await db.execute(
        select(func.count(GeneratedImage.id))
    )
    total = total_q.scalar() or 0

    rows_q = await db.execute(
        select(GeneratedImage)
        .order_by(desc(GeneratedImage.created_at))
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = rows_q.scalars().all()

    images = [
        ImageInfo(
            id=r.id,
            image_id=r.image_id,
            prompt=r.prompt or "",
            negative_prompt=r.negative_prompt,
            width=r.width or 512,
            height=r.height or 512,
            steps=r.steps or 20,
            seed=r.seed,
            model=r.model,
            provider=r.provider or "",
            relative_path=r.relative_path or "",
            file_size=r.file_size or 0,
            generation_time_ms=r.generation_time_ms or 0,
            status=r.status or "unknown",
            created_at=r.created_at.isoformat() if r.created_at else "",
            error_message=r.error_message,
        )
        for r in rows
    ]

    return HistoryResponse(images=images, total=total, page=page, per_page=per_page)


@router.get("/{image_id}")
async def get_image(
    image_id: str,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get image metadata by ID."""
    result = await db.execute(
        select(GeneratedImage).where(GeneratedImage.image_id == image_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Image not found")

    return ImageInfo(
        id=row.id,
        image_id=row.image_id,
        prompt=row.prompt or "",
        negative_prompt=row.negative_prompt,
        width=row.width or 512,
        height=row.height or 512,
        steps=row.steps or 20,
        seed=row.seed,
        model=row.model,
        provider=row.provider or "",
        relative_path=row.relative_path or "",
        file_size=row.file_size or 0,
        generation_time_ms=row.generation_time_ms or 0,
        status=row.status or "unknown",
        created_at=row.created_at.isoformat() if row.created_at else "",
        error_message=row.error_message,
    )


@router.delete("/{image_id}")
async def delete_image(
    image_id: str,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Delete an image by ID."""
    from pathlib import Path
    from ...core.config import get_settings

    result = await db.execute(
        select(GeneratedImage).where(GeneratedImage.image_id == image_id)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Image not found")

    # Delete file from disk
    if row.relative_path:
        settings = get_settings()
        file_path = settings.resolved_workspace / row.relative_path
        if file_path.exists():
            file_path.unlink()

    await db.delete(row)
    await db.flush()

    return {"success": True, "deleted": image_id}
