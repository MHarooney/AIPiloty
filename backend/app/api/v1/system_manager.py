"""System Manager API — macOS local machine hygiene tools.

Endpoints:
  GET  /system-manager/disk           — disk usage stats
  GET  /system-manager/caches         — known cache dir sizes
  POST /system-manager/scan/large-files  — find large files under a path
  POST /system-manager/scan/duplicates   — find duplicate files under a path
  DELETE /system-manager/cleanup      — move selected paths to Trash
  GET  /system-manager/processes      — top processes by memory
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ...core.auth import require_auth

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/system-manager", tags=["System Manager"])

# ── Safety ────────────────────────────────────────────────────────────────────

_HOME = Path.home()
_TMP = Path("/tmp")

# Common macOS temp/cache locations considered safe to report/clean
_KNOWN_CACHES = [
    (_HOME / "Library" / "Caches",        "macOS App Caches",       True),
    (_HOME / "Library" / "Logs",           "macOS App Logs",         True),
    (_HOME / ".npm" / "_npx",              "npm npx cache",          True),
    (_HOME / ".npm" / "_cacache",          "npm install cache",      True),
    (_HOME / ".cache",                     "XDG cache (~/.cache)",   True),
    (_HOME / ".docker" / "tmp",            "Docker temp files",      True),
    (_HOME / ".gradle" / "caches",         "Gradle caches",          True),
    (_HOME / "Library" / "Developer" / "Xcode" / "DerivedData",
                                           "Xcode DerivedData",      True),
    (_TMP,                                 "/tmp (user files)",      False),  # not auto-safe
]


def _is_safe_path(p: Path) -> bool:
    """Return True only if p is under the user home dir or /tmp."""
    try:
        resolved = p.resolve()
        return resolved.is_relative_to(_HOME) or resolved.is_relative_to(_TMP)
    except Exception:
        return False


def _assert_safe(p: Path) -> None:
    if not _is_safe_path(p):
        raise HTTPException(status_code=403, detail=f"Access denied: path '{p}' is outside home directory.")


def _dir_size(path: Path) -> int:
    """Return total size in bytes of all files under path (non-recursive errors skipped)."""
    total = 0
    try:
        for entry in os.scandir(path):
            try:
                if entry.is_dir(follow_symlinks=False):
                    total += _dir_size(Path(entry.path))
                elif entry.is_file(follow_symlinks=False):
                    total += entry.stat(follow_symlinks=False).st_size
            except (PermissionError, FileNotFoundError):
                continue
    except (PermissionError, FileNotFoundError):
        pass
    return total


def _human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def _md5_partial(path: Path, size: int = 8192) -> str:
    h = hashlib.md5()
    try:
        with open(path, "rb") as f:
            h.update(f.read(size))
    except (PermissionError, OSError):
        return ""
    return h.hexdigest()


def _md5_full(path: Path) -> str:
    h = hashlib.md5()
    try:
        with open(path, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
    except (PermissionError, OSError):
        return ""
    return h.hexdigest()


# ── Request/Response models ───────────────────────────────────────────────────

class LargeFileScanRequest(BaseModel):
    path: str = "~"
    min_mb: int = 50
    limit: int = 50


class DuplicateScanRequest(BaseModel):
    path: str = "~"
    min_kb: int = 100


class CleanupRequest(BaseModel):
    paths: list[str]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/disk")
async def get_disk(identity: str = Depends(require_auth)):
    """Return disk usage for / and the user home directory."""
    root_usage = shutil.disk_usage("/")
    home_used = _dir_size(_HOME)
    return {
        "total": root_usage.total,
        "used": root_usage.used,
        "free": root_usage.free,
        "percent": round(root_usage.used / root_usage.total * 100, 1),
        "home_used": home_used,
        "total_human": _human(root_usage.total),
        "used_human": _human(root_usage.used),
        "free_human": _human(root_usage.free),
        "home_used_human": _human(home_used),
    }


@router.get("/caches")
async def get_caches(identity: str = Depends(require_auth)):
    """Return size of well-known cache directories."""
    result = []
    for cache_path, label, deletable in _KNOWN_CACHES:
        if cache_path.exists():
            size = _dir_size(cache_path)
            result.append({
                "path": str(cache_path),
                "label": label,
                "size_bytes": size,
                "size_human": _human(size),
                "deletable": deletable,
            })
    # Sort largest first
    result.sort(key=lambda x: x["size_bytes"], reverse=True)
    return {"caches": result}


@router.post("/scan/large-files")
async def scan_large_files(body: LargeFileScanRequest, identity: str = Depends(require_auth)):
    """Walk a directory and return files larger than min_mb, sorted desc."""
    scan_path = Path(body.path).expanduser().resolve()
    _assert_safe(scan_path)

    if not scan_path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {scan_path}")

    min_bytes = body.min_mb * 1024 * 1024
    found: list[dict[str, Any]] = []

    for root, _dirs, files in os.walk(scan_path):
        for fname in files:
            fpath = Path(root) / fname
            try:
                st = fpath.stat(follow_symlinks=False)
                if fpath.is_file(follow_symlinks=False) and st.st_size >= min_bytes:
                    found.append({
                        "path": str(fpath),
                        "size_bytes": st.st_size,
                        "size_human": _human(st.st_size),
                        "modified": st.st_mtime,
                    })
            except (PermissionError, FileNotFoundError):
                continue

    found.sort(key=lambda x: x["size_bytes"], reverse=True)
    found = found[: body.limit]
    return {"files": found, "count": len(found), "scanned_path": str(scan_path)}


@router.post("/scan/duplicates")
async def scan_duplicates(body: DuplicateScanRequest, identity: str = Depends(require_auth)):
    """Find duplicate files under a path using size + MD5 fingerprinting."""
    scan_path = Path(body.path).expanduser().resolve()
    _assert_safe(scan_path)

    if not scan_path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found: {scan_path}")

    min_bytes = body.min_kb * 1024

    # Step 1: group files by size
    by_size: dict[int, list[Path]] = {}
    for root, _dirs, files in os.walk(scan_path):
        for fname in files:
            fpath = Path(root) / fname
            try:
                st = fpath.stat(follow_symlinks=False)
                if fpath.is_file(follow_symlinks=False) and st.st_size >= min_bytes:
                    by_size.setdefault(st.st_size, []).append(fpath)
            except (PermissionError, FileNotFoundError):
                continue

    # Step 2: among same-size files, group by partial MD5
    candidate_groups: list[list[Path]] = []
    for size, paths in by_size.items():
        if len(paths) < 2:
            continue
        partial: dict[str, list[Path]] = {}
        for p in paths:
            h = _md5_partial(p)
            if h:
                partial.setdefault(h, []).append(p)
        for group in partial.values():
            if len(group) >= 2:
                candidate_groups.append(group)

    # Step 3: full MD5 for final confirmation
    dup_groups: list[dict[str, Any]] = []
    for group in candidate_groups:
        full: dict[str, list[dict]] = {}
        for p in group:
            h = _md5_full(p)
            if not h:
                continue
            try:
                st = p.stat()
                full.setdefault(h, []).append({
                    "path": str(p),
                    "size_bytes": st.st_size,
                    "size_human": _human(st.st_size),
                    "modified": st.st_mtime,
                })
            except (PermissionError, FileNotFoundError):
                continue
        for h, files in full.items():
            if len(files) >= 2:
                # Sort by modified desc so [0] = newest (the one to keep)
                files.sort(key=lambda x: x["modified"], reverse=True)
                dup_groups.append({
                    "hash": h,
                    "count": len(files),
                    "size_each_human": files[0]["size_human"],
                    "wasted_bytes": files[0]["size_bytes"] * (len(files) - 1),
                    "wasted_human": _human(files[0]["size_bytes"] * (len(files) - 1)),
                    "files": files,
                })

    dup_groups.sort(key=lambda x: x["wasted_bytes"], reverse=True)
    total_wasted = sum(g["wasted_bytes"] for g in dup_groups)
    return {
        "groups": dup_groups,
        "group_count": len(dup_groups),
        "total_wasted_bytes": total_wasted,
        "total_wasted_human": _human(total_wasted),
        "scanned_path": str(scan_path),
    }


@router.delete("/cleanup")
async def cleanup_paths(body: CleanupRequest, identity: str = Depends(require_auth)):
    """Move files/directories to ~/.Trash (macOS native, reversible)."""
    trash = _HOME / ".Trash"
    trash.mkdir(exist_ok=True)

    deleted = 0
    freed_bytes = 0
    errors: list[str] = []

    for raw in body.paths:
        p = Path(raw).expanduser().resolve()
        if not _is_safe_path(p):
            errors.append(f"SKIPPED (unsafe path): {raw}")
            continue
        if not p.exists():
            errors.append(f"NOT FOUND: {raw}")
            continue
        try:
            size = _dir_size(p) if p.is_dir() else p.stat().st_size
            dest = trash / p.name
            # Avoid name collision in Trash
            if dest.exists():
                dest = trash / f"{p.name}_{int(p.stat().st_mtime)}"
            shutil.move(str(p), str(dest))
            freed_bytes += size
            deleted += 1
        except Exception as e:
            errors.append(f"ERROR moving {raw}: {e}")

    return {
        "deleted": deleted,
        "freed_bytes": freed_bytes,
        "freed_human": _human(freed_bytes),
        "errors": errors,
    }


@router.get("/processes")
async def get_processes(identity: str = Depends(require_auth)):
    """Return top 20 processes by memory usage."""
    procs: list[dict[str, Any]] = []

    # Try psutil first (optional dep), fall back to ps aux
    try:
        import psutil  # type: ignore
        for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "status", "username"]):
            try:
                info = proc.info
                procs.append({
                    "pid": info["pid"],
                    "name": info["name"] or "",
                    "cpu_percent": round(info["cpu_percent"] or 0, 1),
                    "memory_percent": round(info["memory_percent"] or 0, 2),
                    "status": info["status"] or "",
                    "username": info["username"] or "",
                })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except ImportError:
        # Fallback: parse ps aux
        try:
            out = subprocess.check_output(
                ["ps", "aux", "--no-header"], text=True, timeout=5
            )
        except TypeError:
            # macOS ps doesn't support --no-header
            out = subprocess.check_output(["ps", "aux"], text=True, timeout=5)
            lines = out.strip().splitlines()[1:]  # skip header
        else:
            lines = out.strip().splitlines()

        for line in lines:
            parts = line.split(None, 10)
            if len(parts) < 11:
                continue
            try:
                procs.append({
                    "pid": int(parts[1]),
                    "name": parts[10].split("/")[-1][:40],
                    "cpu_percent": float(parts[2]),
                    "memory_percent": float(parts[3]),
                    "status": parts[7],
                    "username": parts[0],
                })
            except (ValueError, IndexError):
                continue

    procs.sort(key=lambda x: x["memory_percent"], reverse=True)
    return {"processes": procs[:20]}
