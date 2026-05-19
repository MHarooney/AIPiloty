"""Workspace file browser API — directory & file access with read/write."""

from __future__ import annotations

import os
import re
import shutil
import time
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from ...core.auth import require_auth
from ...core.config import get_settings
from .projects import get_project_root

router = APIRouter(prefix="/workspace", tags=["Workspace"])

# Directories to skip in tree listing
_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", "venv", ".venv",
    "dist", "build", ".next", ".nuxt", ".cache", "coverage",
    # Package manager / dependency dirs
    "vendor",          # PHP Composer
    "target",          # Java Maven / Rust Cargo
    "Pods",            # CocoaPods
    ".gradle",         # Gradle
    # Laravel / framework storage
    "storage",
    # Misc large dirs
    ".turbo", ".eggs",
}

# Additional skip logic for name patterns
def _skip_dir_name(name: str) -> bool:
    if name in _SKIP_DIRS:
        return True
    if name.endswith(".egg-info"):
        return True
    return False

_MAX_ENTRIES = 10000
_MAX_FILE_SIZE = 512 * 1024  # 500KB

# Blocked file patterns (security-sensitive files)
_BLOCKED_FILE_PATTERNS = {
    re.compile(r"\.env($|\..*)"),       # .env, .env.local, .env.production, etc.
    re.compile(r"\.secret[s]?$"),
    re.compile(r"\.pem$"),
    re.compile(r"\.key$"),
    re.compile(r"id_rsa$|id_ed25519$|id_ecdsa$"),
}

# Directories blocked for writes
_WRITE_BLOCKED_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv"}


class WriteFileRequest(BaseModel):
    path: str = Field(..., description="Relative file path within workspace")
    content: str = Field(..., description="File content to write")


class PatchFileRequest(BaseModel):
    path: str = Field(..., description="Relative file path within workspace")
    old_str: str = Field(..., description="Exact string to find (must occur exactly once)")
    new_str: str = Field(..., description="Replacement string")


class SearchRequest(BaseModel):
    query: str = Field(..., description="Regex pattern to search for")
    path: str = Field(".", description="Relative directory to search in")
    max_results: int = Field(100, ge=1, le=500)

# Extension → language mapping for Monaco
_LANG_MAP = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".tsx": "typescriptreact", ".jsx": "javascriptreact",
    ".json": "json", ".md": "markdown", ".yml": "yaml", ".yaml": "yaml",
    ".html": "html", ".css": "css", ".scss": "scss",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".sql": "sql", ".toml": "toml", ".ini": "ini",
    ".xml": "xml", ".svg": "xml", ".env": "dotenv",
    ".rs": "rust", ".go": "go", ".java": "java",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
    ".rb": "ruby", ".php": "php", ".dart": "dart",
    ".dockerfile": "dockerfile", ".tf": "hcl",
}


# Extensions that are always binary — never show in the tree
_BINARY_EXTS = {
    ".pyc", ".pyo", ".pyd",
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tiff", ".avif",
    ".mp3", ".mp4", ".wav", ".ogg", ".flac", ".avi", ".mov", ".mkv", ".webm",
    ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z", ".rar",
    ".exe", ".dll", ".so", ".dylib", ".bin", ".dat",
    ".db", ".sqlite", ".sqlite3",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".class", ".jar", ".war",
    ".lock",  # package-lock / yarn.lock can be huge; hide silently
}


def _is_binary_file(path: Path) -> bool:
    """Return True if the file is binary (not displayable as UTF-8 text)."""
    if path.suffix.lower() in _BINARY_EXTS:
        return True
    # Quick null-byte sniff for unknown extensions
    try:
        chunk = path.read_bytes()[:512]
        return b"\x00" in chunk
    except OSError:
        return True


def _resolve_workspace(project_id: Optional[str] = None) -> Path:
    """Return workspace base path — from a registered project or the default."""
    if project_id:
        return get_project_root(project_id)
    return get_settings().resolved_workspace


def _validate_path(base: Path, rel_path: str) -> Path:
    """Resolve and validate a path stays within workspace root."""
    resolved = (base / rel_path).resolve()
    if not str(resolved).startswith(str(base.resolve())):
        raise HTTPException(403, "Path traversal blocked")
    return resolved


def _is_blocked_file(path: Path) -> bool:
    """Check if a file matches security-sensitive patterns."""
    name = path.name
    return any(p.search(name) for p in _BLOCKED_FILE_PATTERNS)


def _is_write_blocked(path: Path, base: Path) -> bool:
    """Check if a path is in a write-blocked directory."""
    rel = path.relative_to(base)
    return any(part in _WRITE_BLOCKED_DIRS for part in rel.parts)


def _build_tree(root: Path, base: Path, depth: int, max_entries: int, count: list) -> list[dict]:
    """Recursively build directory tree."""
    if depth <= 0 or count[0] >= max_entries:
        return []

    entries = []
    try:
        items = sorted(root.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError:
        return []

    for item in items:
        if count[0] >= max_entries:
            break

        name = item.name
        if name.startswith(".") and name not in {".gitignore", ".dockerignore"}:
            continue

        rel = str(item.relative_to(base))

        if item.is_dir():
            if _skip_dir_name(name):
                continue
            count[0] += 1
            children = _build_tree(item, base, depth - 1, max_entries, count)
            entries.append({"name": name, "type": "directory", "path": rel, "children": children})
        else:
            # Skip files that cannot be served (blocked security files, binary, too large)
            if _is_blocked_file(item):
                continue
            if _is_binary_file(item):
                continue
            try:
                size = item.stat().st_size
            except OSError:
                continue
            if size > _MAX_FILE_SIZE:
                continue
            count[0] += 1
            entries.append({"name": name, "type": "file", "path": rel, "size": size})

    return entries


@router.get("/tree")
async def workspace_tree(
    path: str = Query(".", description="Relative path from workspace root"),
    depth: int = Query(4, ge=1, le=8),
    project_id: Optional[str] = Query(None, description="Project ID (omit for default workspace)"),
    identity: str = Depends(require_auth),
):
    """Get recursive directory listing of the workspace."""
    base = _resolve_workspace(project_id)
    target = _validate_path(base, path)

    if not target.is_dir():
        raise HTTPException(400, "Path is not a directory")

    count = [0]
    tree = _build_tree(target, base, depth, _MAX_ENTRIES, count)

    return {
        "root": str(target.relative_to(base)) if target != base else ".",
        "tree": tree,
        "total_entries": count[0],
        "truncated": count[0] >= _MAX_ENTRIES,
    }


@router.get("/file")
async def workspace_file(
    path: str = Query(..., description="Relative file path"),
    project_id: Optional[str] = Query(None),
    identity: str = Depends(require_auth),
):
    """Read a file's text content from the workspace."""
    base = _resolve_workspace(project_id)
    target = _validate_path(base, path)

    if not target.is_file():
        raise HTTPException(404, "File not found")

    if _is_blocked_file(target):
        raise HTTPException(403, "Access to this file type is blocked for security reasons")

    if _is_binary_file(target):
        raise HTTPException(415, "Binary file — cannot display as text")

    size = target.stat().st_size
    if size > _MAX_FILE_SIZE:
        raise HTTPException(413, f"File too large ({size} bytes, max {_MAX_FILE_SIZE})")

    # Detect language from extension
    ext = target.suffix.lower()
    language = _LANG_MAP.get(ext, "plaintext")

    # Handle Dockerfile specifically
    if target.name.lower() in {"dockerfile", "docker-compose.yml", "docker-compose.yaml"}:
        language = "dockerfile" if "dockerfile" in target.name.lower() else "yaml"

    try:
        content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(415, "Binary file — cannot display as text")

    return {
        "path": str(target.relative_to(base)),
        "content": content,
        "size": size,
        "language": language,
    }


# ── Write / Patch / Search ────────────────────────────────────


@router.post("/file")
async def workspace_write_file(
    body: WriteFileRequest,
    project_id: Optional[str] = Query(None),
    identity: str = Depends(require_auth),
):
    """Write (create or overwrite) a text file in the workspace."""
    base = _resolve_workspace(project_id)
    target = _validate_path(base, body.path)

    if _is_blocked_file(target):
        raise HTTPException(403, "Writing to this file type is blocked for security reasons")
    if _is_write_blocked(target, base):
        raise HTTPException(403, f"Writing inside {target.relative_to(base).parts[0]}/ is blocked")

    content_bytes = body.content.encode("utf-8")
    if len(content_bytes) > _MAX_FILE_SIZE:
        raise HTTPException(413, f"Content too large ({len(content_bytes)} bytes, max {_MAX_FILE_SIZE})")

    # Create parent directories if needed
    target.parent.mkdir(parents=True, exist_ok=True)

    target.write_text(body.content, encoding="utf-8")

    return {
        "success": True,
        "path": str(target.relative_to(base)),
        "size": len(content_bytes),
    }


@router.post("/patch")
async def workspace_patch_file(
    body: PatchFileRequest,
    project_id: Optional[str] = Query(None),
    identity: str = Depends(require_auth),
):
    """Apply a single old_str → new_str replacement in a file. old_str must appear exactly once."""
    base = _resolve_workspace(project_id)
    target = _validate_path(base, body.path)

    if not target.is_file():
        raise HTTPException(404, "File not found")
    if _is_blocked_file(target):
        raise HTTPException(403, "Patching this file type is blocked for security reasons")
    if _is_write_blocked(target, base):
        raise HTTPException(403, f"Writing inside {target.relative_to(base).parts[0]}/ is blocked")

    try:
        content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raise HTTPException(415, "Binary file — cannot patch")

    count = content.count(body.old_str)
    if count == 0:
        raise HTTPException(400, "old_str not found in file")
    if count > 1:
        raise HTTPException(400, f"old_str is ambiguous — found {count} occurrences (must be exactly 1)")

    new_content = content.replace(body.old_str, body.new_str, 1)
    target.write_text(new_content, encoding="utf-8")

    return {
        "success": True,
        "path": str(target.relative_to(base)),
        "applied": True,
    }


@router.post("/search")
async def workspace_search(
    body: SearchRequest,
    project_id: Optional[str] = Query(None),
    identity: str = Depends(require_auth),
):
    """Regex search across workspace files. Returns file:line:content matches."""
    base = _resolve_workspace(project_id)
    target = _validate_path(base, body.path)

    if not target.is_dir():
        raise HTTPException(400, "Search path must be a directory")

    try:
        pattern = re.compile(body.query, re.IGNORECASE)
    except re.error as e:
        raise HTTPException(400, f"Invalid regex: {e}")

    results = []
    for root_dir, dirs, files in os.walk(target):
        # Skip ignored directories
        dirs[:] = [d for d in dirs if d not in _SKIP_DIRS and not d.startswith(".")]

        for fname in files:
            if len(results) >= body.max_results:
                break

            fpath = Path(root_dir) / fname
            if _is_blocked_file(fpath):
                continue
            if fpath.stat().st_size > _MAX_FILE_SIZE:
                continue

            try:
                text = fpath.read_text(encoding="utf-8")
            except (UnicodeDecodeError, PermissionError):
                continue

            for line_no, line in enumerate(text.splitlines(), 1):
                if pattern.search(line):
                    results.append({
                        "file": str(fpath.relative_to(base)),
                        "line": line_no,
                        "content": line.rstrip()[:200],
                    })
                    if len(results) >= body.max_results:
                        break

    return {
        "results": results,
        "total": len(results),
        "truncated": len(results) >= body.max_results,
    }
