"""Workspace file browser API — directory & file access with read/write.

Phase IDE: Added create/rename/delete/mkdir + terminal execution endpoint.
"""

from __future__ import annotations

import asyncio
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


# ── IDE file-management endpoints (create / rename / delete / mkdir) ──────────


class CreateFileRequest(BaseModel):
    path: str = Field(..., description="Relative path for the new file")
    content: str = Field("", description="Initial file content (empty by default)")
    project_id: Optional[str] = None


class CreateDirRequest(BaseModel):
    path: str = Field(..., description="Relative path for the new directory")
    project_id: Optional[str] = None


class RenameRequest(BaseModel):
    old_path: str = Field(..., description="Current relative path")
    new_path: str = Field(..., description="New relative path")
    project_id: Optional[str] = None


class DeleteRequest(BaseModel):
    path: str = Field(..., description="Relative path to delete (file or directory)")
    project_id: Optional[str] = None


@router.post("/create-file", status_code=201)
async def create_file(
    body: CreateFileRequest,
    identity: str = Depends(require_auth),
):
    """Create a new file in the workspace (fails if it already exists)."""
    base = _resolve_workspace(body.project_id)
    target = _validate_path(base, body.path)

    if target.exists():
        raise HTTPException(409, f"Path already exists: {body.path}")
    if _is_blocked_file(target):
        raise HTTPException(403, "Creating this file type is blocked for security reasons")
    if _is_write_blocked(target, base):
        raise HTTPException(403, f"Writing inside {target.relative_to(base).parts[0]}/ is blocked")

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(body.content, encoding="utf-8")

    ext = target.suffix.lower()
    return {
        "created": True,
        "path": str(target.relative_to(base)),
        "language": _LANG_MAP.get(ext, "plaintext"),
    }


@router.post("/create-dir", status_code=201)
async def create_directory(
    body: CreateDirRequest,
    identity: str = Depends(require_auth),
):
    """Create a new directory (and all parent directories) in the workspace."""
    base = _resolve_workspace(body.project_id)
    target = _validate_path(base, body.path)

    if target.exists():
        raise HTTPException(409, f"Directory already exists: {body.path}")
    if _is_write_blocked(target, base):
        raise HTTPException(403, f"Writing inside {target.relative_to(base).parts[0]}/ is blocked")

    target.mkdir(parents=True, exist_ok=True)
    return {"created": True, "path": str(target.relative_to(base))}


@router.post("/rename")
async def rename_path(
    body: RenameRequest,
    identity: str = Depends(require_auth),
):
    """Rename or move a file or directory within the workspace."""
    base = _resolve_workspace(body.project_id)
    src = _validate_path(base, body.old_path)
    dst = _validate_path(base, body.new_path)

    if not src.exists():
        raise HTTPException(404, f"Source not found: {body.old_path}")
    if dst.exists():
        raise HTTPException(409, f"Destination already exists: {body.new_path}")
    if _is_blocked_file(dst):
        raise HTTPException(403, "Renaming to this file type is blocked")
    if _is_write_blocked(src, base) or _is_write_blocked(dst, base):
        raise HTTPException(403, "Rename not allowed inside write-blocked directories")

    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)
    return {
        "renamed": True,
        "old_path": str(src.relative_to(base)),
        "new_path": str(dst.relative_to(base)),
    }


@router.delete("/delete")
async def delete_path(
    body: DeleteRequest,
    identity: str = Depends(require_auth),
):
    """Delete a file or directory from the workspace.

    Directories are deleted recursively.  Use with caution.
    """
    base = _resolve_workspace(body.project_id)
    target = _validate_path(base, body.path)

    if not target.exists():
        raise HTTPException(404, f"Path not found: {body.path}")
    if _is_write_blocked(target, base):
        raise HTTPException(403, f"Deleting inside {target.relative_to(base).parts[0]}/ is blocked")
    # Safety: never delete the workspace root itself
    if target.resolve() == base.resolve():
        raise HTTPException(403, "Cannot delete the workspace root")

    was_dir = target.is_dir()
    if was_dir:
        shutil.rmtree(target)
    else:
        target.unlink()

    return {
        "deleted": True,
        "path": str(target.relative_to(base)),
        "was_directory": was_dir,
    }


# ── Integrated terminal execution ─────────────────────────────────────────────


class TerminalRequest(BaseModel):
    command: str = Field(..., min_length=1, max_length=500)
    working_dir: str = Field(".", description="Working directory (relative to workspace)")
    timeout: int = Field(30, ge=1, le=120, description="Max seconds to wait for command")


# Blocklist of dangerous commands — same as guardrails
_BLOCKED_CMDS = frozenset({
    "rm -rf /", "rm -rf /*", "mkfs", ":(){:|:&};:", "dd if=/dev/zero",
    "chmod -R 777 /", "chown -R", "shutdown", "reboot", "halt", "poweroff",
    "sudo su", "sudo -s",
})


@router.post("/terminal")
async def run_terminal(
    body: TerminalRequest,
    identity: str = Depends(require_auth),
):
    """Execute a shell command in the workspace directory.

    Safety: blocks a hardcoded list of destructive commands.
    Output is capped at 50 KB to prevent memory exhaustion.
    """
    cmd = body.command.strip()
    if any(blocked in cmd for blocked in _BLOCKED_CMDS):
        raise HTTPException(403, f"Command blocked for safety: {cmd}")

    base = get_settings().resolved_workspace
    work_dir = _validate_path(base, body.working_dir) if body.working_dir != "." else base
    if not work_dir.is_dir():
        work_dir = base

    try:
        proc = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=str(work_dir),
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=body.timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return {
                "exit_code": -1,
                "stdout": "",
                "stderr": f"Command timed out after {body.timeout}s",
                "command": cmd,
                "truncated": False,
            }

        _MAX_OUT = 50 * 1024  # 50 KB
        stdout = stdout_b.decode("utf-8", errors="replace")[:_MAX_OUT]
        stderr = stderr_b.decode("utf-8", errors="replace")[:_MAX_OUT]

        return {
            "exit_code": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "command": cmd,
            "truncated": len(stdout_b) > _MAX_OUT or len(stderr_b) > _MAX_OUT,
            "working_dir": str(work_dir.relative_to(base)),
        }
    except Exception as exc:
        raise HTTPException(500, f"Command execution failed: {exc}")


# ── Desktop workspace root override (Electron Desktop only) ──────────────────

class WorkspaceRootRequest(BaseModel):
    path: str = Field(..., min_length=1, description="Absolute path to the workspace folder")


@router.patch("/root")
async def set_workspace_root(
    body: WorkspaceRootRequest,
    identity: str = Depends(require_auth),
):
    """Update the active workspace root (used by AIPiloty Desktop when the user opens a folder).

    Updates the in-process settings so all subsequent workspace operations resolve
    relative to the new path.  Changes are NOT persisted to .env — restart resets
    to the original WORKSPACE_ROOT config value.

    Security: rejects paths that try to escape to /etc, /sys, /proc, etc.
    """
    from pathlib import Path as _Path

    candidate = _Path(body.path).resolve()

    # Reject obviously dangerous system paths
    _BLOCKED_ROOTS = {
        _Path("/"),
        _Path("/etc"),
        _Path("/sys"),
        _Path("/proc"),
        _Path("/dev"),
        _Path("/bin"),
        _Path("/sbin"),
        _Path("/usr"),
        _Path("/var/log"),
    }
    if candidate in _BLOCKED_ROOTS or any(
        str(candidate).startswith(str(br) + "/") for br in {_Path("/etc"), _Path("/sys"), _Path("/proc")}
    ):
        raise HTTPException(400, f"Refused: path '{candidate}' is a protected system directory")

    if not candidate.is_dir():
        raise HTTPException(400, f"Path does not exist or is not a directory: {candidate}")

    # Hot-patch the settings object so all subsequent calls pick up the new root
    settings = get_settings()
    settings.workspace_root = str(candidate)

    return {"path": str(candidate), "status": "ok"}

