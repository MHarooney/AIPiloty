"""Config API — exposes non-sensitive settings for the frontend settings page."""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.auth import require_auth
from ...core.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/config", tags=["Config"])


class ConfigUpdate(BaseModel):
    """Fields that can be updated at runtime (non-restart-required)."""
    ollama_model: Optional[str] = None
    ollama_temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    ollama_context_length: Optional[int] = Field(None, ge=512, le=131072)


class ServiceToggle(BaseModel):
    service: str  # "ollama" | "qdrant" | "image_gen"
    enabled: bool


# Runtime overrides stored in-memory (applied to settings singleton)
_runtime_overrides: dict[str, object] = {}

# Runtime service states — key = service name, value = enabled bool
_service_states: dict[str, bool] = {}


@router.get("/")
async def get_config(identity: str = Depends(require_auth)):
    """Return non-sensitive configuration values."""
    settings = get_settings()

    # Import tool registry to list registered tools
    from ...main import app_state
    registry = app_state.get("registry")
    tools = []
    if registry:
        for t in registry.all_tools():
            tools.append({
                "name": t.name,
                "description": t.description,
                "category": t.category,
                "risk_level": t.risk_level,
            })

    return {
        "app_name": settings.app_name,
        "app_env": settings.app_env,
        "ollama_base_url": settings.ollama_base_url,
        "ollama_model": _runtime_overrides.get("ollama_model", settings.ollama_model),
        "ollama_context_length": _runtime_overrides.get("ollama_context_length", settings.ollama_context_length),
        "ollama_temperature": _runtime_overrides.get("ollama_temperature", settings.ollama_temperature),
        "workspace_root": str(settings.resolved_workspace),
        "database_url": "sqlite:///***" if "sqlite" in settings.database_url else "***",
        "deploypilot_kb_url": settings.deploypilot_kb_url or "Not configured",
        "cors_origins": settings.cors_origins if hasattr(settings, "cors_origins") else ["http://localhost:3000", "http://localhost:3001"],
        "tools_registered": tools,
    }


@router.post("/")
async def update_config(body: ConfigUpdate, identity: str = Depends(require_auth)):
    """Update runtime-configurable settings (no restart required)."""
    updated = {}
    if body.ollama_model is not None:
        _runtime_overrides["ollama_model"] = body.ollama_model
        updated["ollama_model"] = body.ollama_model
    if body.ollama_temperature is not None:
        _runtime_overrides["ollama_temperature"] = body.ollama_temperature
        updated["ollama_temperature"] = body.ollama_temperature
    if body.ollama_context_length is not None:
        _runtime_overrides["ollama_context_length"] = body.ollama_context_length
        updated["ollama_context_length"] = body.ollama_context_length

    return {"success": True, "updated": updated}


@router.get("/models")
async def list_models(identity: str = Depends(require_auth)):
    """List available Ollama models."""
    from ...main import app_state
    orchestrator = app_state.get("orchestrator")
    if not orchestrator:
        return {"models": []}
    llm = orchestrator._llm
    raw = await llm.list_models()
    models = []
    for m in raw:
        models.append({
            "name": m.get("name", ""),
            "size": m.get("size", 0),
            "parameter_size": m.get("details", {}).get("parameter_size", ""),
            "family": m.get("details", {}).get("family", ""),
        })
    return {"models": models, "current": llm.model}


# ── Service management ────────────────────────────────────────────────────────

def _is_ollama_enabled() -> bool:
    """Returns current runtime ollama enabled state."""
    if "ollama" in _service_states:
        return _service_states["ollama"]
    return get_settings().ollama_enabled


async def _probe_ollama() -> bool:
    """Quick TCP-level reachability check for Ollama."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{get_settings().ollama_base_url}/api/tags")
            return r.status_code == 200
    except Exception:
        return False


async def _probe_qdrant() -> bool:
    """Quick reachability check for Qdrant."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            r = await client.get(f"{get_settings().qdrant_url}/healthz")
            return r.status_code == 200
    except Exception:
        return False


@router.get("/services")
async def get_services(identity: str = Depends(require_auth)):
    """Return enabled/reachable status of optional backend services."""
    from ...main import app_state
    settings = get_settings()

    ollama_enabled = _is_ollama_enabled()
    qdrant_enabled = _service_states.get("qdrant", True)
    image_enabled = _service_states.get("image_gen", bool(settings.image_gen_api_url or settings.image_provider))

    # Probe reachability concurrently (only if enabled)
    ollama_probe = _probe_ollama() if ollama_enabled else asyncio.sleep(0, result=False)
    qdrant_probe = _probe_qdrant() if qdrant_enabled else asyncio.sleep(0, result=False)
    ollama_reachable, qdrant_reachable = await asyncio.gather(ollama_probe, qdrant_probe)

    current_model: str = str(_runtime_overrides.get("ollama_model", settings.ollama_model))

    return {
        "ollama": {
            "enabled": ollama_enabled,
            "reachable": ollama_reachable,
            "model": current_model,
            "base_url": settings.ollama_base_url,
            "active": app_state.get("llm") is not None,
        },
        "qdrant": {
            "enabled": qdrant_enabled,
            "reachable": qdrant_reachable,
            "url": settings.qdrant_url,
            "active": app_state.get("qdrant_store") is not None,
        },
        "image_gen": {
            "enabled": image_enabled,
            "provider": settings.image_provider or "auto",
            "active": app_state.get("image_service") is not None,
        },
    }


@router.patch("/services")
async def toggle_service(body: ServiceToggle, identity: str = Depends(require_auth)):
    """Enable or disable a service at runtime (no restart required)."""
    from ...main import app_state

    service = body.service.lower()
    if service not in ("ollama", "qdrant", "image_gen"):
        raise HTTPException(status_code=400, detail=f"Unknown service '{service}'. Valid: ollama, qdrant, image_gen")

    _service_states[service] = body.enabled

    if service == "ollama":
        if not body.enabled:
            # Disable: clear all Ollama-dependent services from app_state
            app_state["llm"] = None
            app_state["orchestrator"] = None
            app_state["testing_orchestrator"] = None
            app_state["embedding_service"] = None
            logger.info("Ollama disabled at runtime — orchestrator cleared")
        else:
            # Re-enable: re-instantiate LLM + orchestrators
            try:
                from ...services.llm.ollama_service import OllamaService
                from ...services.agent.orchestrator import AgentOrchestrator
                from ...services.agent.testing_orchestrator import TestingOrchestrator
                from ...services.rag import EmbeddingService

                llm = OllamaService()
                embedding_service = EmbeddingService()

                guardrails = app_state.get("guardrails")
                registry = app_state.get("registry")
                attachment_storage = app_state.get("attachment_storage")

                from ...main import get_all_vms
                from ...services.agent.memory import AgentMemory
                memory = AgentMemory(storage_path="data/agent_memory.json")
                orchestrator = AgentOrchestrator(
                    llm, registry, guardrails,
                    get_all_vms_func=get_all_vms,
                    attachment_storage=attachment_storage,
                    memory=memory,
                )

                testing_registry = app_state.get("testing_registry") or registry
                testing_orchestrator = TestingOrchestrator(llm, testing_registry, guardrails)

                app_state["llm"] = llm
                app_state["orchestrator"] = orchestrator
                app_state["testing_orchestrator"] = testing_orchestrator
                app_state["embedding_service"] = embedding_service

                # Warm up in background
                asyncio.create_task(llm.warm_up())
                logger.info("Ollama re-enabled at runtime — orchestrator restored")
            except Exception as e:
                logger.error("Failed to re-enable Ollama: %s", e)
                raise HTTPException(status_code=500, detail=f"Failed to restart Ollama service: {e}")

    return {"success": True, "service": service, "enabled": body.enabled}
