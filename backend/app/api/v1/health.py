"""Health check endpoint — deep probe of all system dependencies."""

from __future__ import annotations

import time
import logging

from fastapi import APIRouter
from sqlalchemy import text

from ...core.config import get_settings
from ...core.database import async_session_factory
from ...schemas.api import ComponentHealth, HealthOut
from ...services.llm.ollama_service import OllamaService
from ...services.rag.vector_store import QdrantStore

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Health"])


async def _probe_ollama() -> ComponentHealth:
    try:
        t0 = time.monotonic()
        ok = await OllamaService().is_available()
        latency = round((time.monotonic() - t0) * 1000, 1)
        return ComponentHealth(ok=ok, latency_ms=latency)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Ollama health probe failed: %s", exc)
        return ComponentHealth(ok=False, detail=str(exc))


async def _probe_db() -> ComponentHealth:
    try:
        t0 = time.monotonic()
        async with async_session_factory() as session:
            await session.execute(text("SELECT 1"))
        latency = round((time.monotonic() - t0) * 1000, 1)
        return ComponentHealth(ok=True, latency_ms=latency)
    except Exception as exc:  # noqa: BLE001
        logger.warning("DB health probe failed: %s", exc)
        return ComponentHealth(ok=False, detail=str(exc))


async def _probe_qdrant() -> ComponentHealth:
    try:
        t0 = time.monotonic()
        settings = get_settings()
        store = QdrantStore()
        client = await store._get_client()
        await client.get_collections()
        latency = round((time.monotonic() - t0) * 1000, 1)
        return ComponentHealth(ok=True, latency_ms=latency)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Qdrant health probe failed: %s", exc)
        return ComponentHealth(ok=False, detail=str(exc))


@router.get("/health", response_model=HealthOut)
async def health_check():
    """Deep health probe: checks Ollama, database, and Qdrant.

    Returns HTTP 200 even when degraded so load-balancers keep the instance
    in rotation; consumers should inspect ``status`` and ``components``.
    """
    settings = get_settings()

    ollama, db, qdrant = (
        await _probe_ollama(),
        await _probe_db(),
        await _probe_qdrant(),
    )

    components = {
        "ollama": ollama,
        "database": db,
        "qdrant": qdrant,
    }

    all_ok = all(c.ok for c in components.values())
    any_ok = any(c.ok for c in components.values())

    if all_ok:
        overall = "ok"
    elif any_ok:
        overall = "degraded"
    else:
        overall = "unhealthy"

    return HealthOut(
        status=overall,
        app_name=settings.app_name,
        ollama_connected=ollama.ok,
        db_connected=db.ok,
        components=components,
    )
