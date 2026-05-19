"""Local filesystem browser — used by the project-picker dialog."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query

from ...core.auth import require_auth

router = APIRouter(prefix="/filesystem", tags=["Filesystem"])

# Paths that are never safe to browse
_BLOCKED = ("/proc", "/sys", "/dev", "/private/var/root", "/private/etc")

# Files/dirs whose presence indicate a project root
_PROJECT_MARKERS = {
    ".git", "package.json", "pyproject.toml",
    "Cargo.toml", "go.mod", "pom.xml", "Makefile",
    "build.gradle", "composer.json", ".xcode",
}


def _is_safe(p: Path) -> bool:
    s = str(p)
    return not any(s.startswith(b) for b in _BLOCKED)


@router.get("/home")
async def home_dir(identity: str = Depends(require_auth)):
    """Return the current user's home directory path."""
    return {"path": str(Path.home())}


@router.get("/browse")
async def browse(
    path: str = Query(..., description="Absolute path to list"),
    identity: str = Depends(require_auth),
):
    """List entries in a local directory (for project-picker navigation)."""
    p = Path(path).resolve()
    if not _is_safe(p):
        raise HTTPException(403, "Access to this path is restricted")
    if not p.exists():
        raise HTTPException(404, "Path not found")
    if not p.is_dir():
        raise HTTPException(400, "Not a directory")

    entries: list[dict] = []
    try:
        items = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
    except PermissionError:
        raise HTTPException(403, "Permission denied")

    for item in items:
        name = item.name
        # Skip hidden except .git (helpful project indicator)
        if name.startswith(".") and name != ".git":
            continue
        try:
            is_dir = item.is_dir()
            is_project = is_dir and any((item / m).exists() for m in _PROJECT_MARKERS)
            entries.append({
                "name": name,
                "path": str(item),
                "is_dir": is_dir,
                "is_project": is_project,
            })
        except (PermissionError, OSError):
            continue
        if len(entries) >= 500:
            break

    return {
        "path": str(p),
        "name": p.name or str(p),
        "parent": str(p.parent) if p.parent != p else None,
        "entries": entries,
    }
