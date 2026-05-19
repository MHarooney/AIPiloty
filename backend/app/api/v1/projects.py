"""Project management — open local directories as named projects."""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.auth import require_auth

router = APIRouter(prefix="/projects", tags=["Projects"])

_STORE = Path.home() / ".aipiloty" / "projects.json"

_COLORS = [
    "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b",
    "#10b981", "#3b82f6", "#ef4444", "#14b8a6",
]


def _load() -> list[dict]:
    if not _STORE.exists():
        return []
    try:
        return json.loads(_STORE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(projects: list[dict]) -> None:
    _STORE.parent.mkdir(parents=True, exist_ok=True)
    _STORE.write_text(json.dumps(projects, indent=2), encoding="utf-8")


def get_project_root(project_id: str) -> Path:
    """Resolve project_id → absolute path. Raises HTTP 404 if unknown."""
    for p in _load():
        if p["id"] == project_id:
            return Path(p["path"])
    raise HTTPException(404, f"Project '{project_id}' not found")


class CreateProjectRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    path: str = Field(..., description="Absolute local path to the project root")


@router.get("")
async def list_projects(identity: str = Depends(require_auth)):
    return _load()


@router.post("", status_code=201)
async def create_project(
    req: CreateProjectRequest,
    identity: str = Depends(require_auth),
):
    p = Path(req.path).resolve()
    if not p.is_dir():
        raise HTTPException(400, f"Not a directory: {req.path}")
    projects = _load()
    # Deduplicate by resolved path
    for existing in projects:
        if existing["path"] == str(p):
            return existing
    color = _COLORS[len(projects) % len(_COLORS)]
    project = {
        "id": str(uuid.uuid4()),
        "name": req.name,
        "path": str(p),
        "color": color,
    }
    projects.append(project)
    _save(projects)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    identity: str = Depends(require_auth),
):
    projects = [p for p in _load() if p["id"] != project_id]
    _save(projects)
