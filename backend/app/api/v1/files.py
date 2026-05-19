"""File download route for generated documents."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ...core.auth import require_auth
from ...core.config import get_settings

router = APIRouter(prefix="/files", tags=["Files"])


def _normalize_generated_filepath(filepath: str) -> str:
    """
    Document tools return paths relative to the workspace root, e.g. ``generated/foo.pdf``.
    This route already scopes to ``<workspace>/generated/``, so strip a leading
    ``generated/`` segment to avoid resolving to ``generated/generated/foo.pdf``.
    """
    fp = filepath.strip().replace("\\", "/").lstrip("/")
    if fp.startswith("generated/"):
        fp = fp[len("generated/") :]
    return fp


@router.get("/generated/{filepath:path}")
async def download_generated_file(
    filepath: str,
    identity: str = Depends(require_auth),
):
    """Download a generated file by relative path."""
    settings = get_settings()
    workspace = settings.resolved_workspace
    generated_dir = workspace / "generated"

    filepath = _normalize_generated_filepath(filepath)

    # Resolve and validate path stays inside generated/
    resolved = (generated_dir / filepath).resolve()
    if not str(resolved).startswith(str(generated_dir.resolve())):
        raise HTTPException(403, "Path traversal blocked")
    if not resolved.exists():
        raise HTTPException(404, "File not found")

    return FileResponse(
        path=str(resolved),
        filename=resolved.name,
        media_type="application/octet-stream",
    )
