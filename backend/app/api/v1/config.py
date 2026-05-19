"""Config API — exposes non-sensitive settings for the frontend settings page."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Optional

from ...core.auth import require_auth
from ...core.config import get_settings

router = APIRouter(prefix="/config", tags=["Config"])


class ConfigUpdate(BaseModel):
    """Fields that can be updated at runtime (non-restart-required)."""
    ollama_model: Optional[str] = None
    ollama_temperature: Optional[float] = Field(None, ge=0.0, le=2.0)
    ollama_context_length: Optional[int] = Field(None, ge=512, le=131072)

# Runtime overrides stored in-memory (applied to settings singleton)
_runtime_overrides: dict[str, object] = {}


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
