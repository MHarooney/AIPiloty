"""Agent tools for reading, writing, and patching workspace files."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from ..base import BaseTool, Param, ToolResult

logger = logging.getLogger(__name__)

# Extensions safe to write (text files only)
_WRITABLE_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".json", ".md", ".txt",
    ".yml", ".yaml", ".toml", ".cfg", ".ini", ".sh", ".bash",
    ".css", ".scss", ".html", ".xml", ".svg", ".sql",
    ".rs", ".go", ".dart", ".java", ".c", ".cpp", ".h", ".hpp",
    ".rb", ".php", ".dockerfile", ".tf", ".hcl", ".csv",
    ".gitignore", ".dockerignore",
}

# Files/dirs blocked from write operations
_BLOCKED_NAMES = {".git", "node_modules", "__pycache__", ".venv", "venv"}
_BLOCKED_PATTERNS = {".env", ".secret", ".pem", ".key", "id_rsa", "id_ed25519"}


def _validate_workspace_path(workspace_root: str, rel_path: str) -> Path:
    """Resolve path within workspace and validate it's safe."""
    base = Path(workspace_root).resolve()
    target = (base / rel_path).resolve()
    if not str(target).startswith(str(base)):
        raise ValueError("Path traversal blocked")
    return target


def _is_write_safe(target: Path, base: Path) -> tuple[bool, str]:
    """Check if a file path is safe for writing."""
    name = target.name
    rel = target.relative_to(base)

    # Check blocked directories
    for part in rel.parts:
        if part in _BLOCKED_NAMES:
            return False, f"Writing inside {part}/ is blocked"

    # Check blocked file patterns
    for pattern in _BLOCKED_PATTERNS:
        if name.startswith(pattern) or name.endswith(pattern):
            return False, f"Writing to {name} is blocked (security-sensitive file)"

    return True, ""


class WriteFileTool(BaseTool):
    """Write or create a text file in the workspace."""

    name = "write_file"
    description = (
        "Create or overwrite a text file in the workspace. Provide the full "
        "file content. Use for creating new files, config files, scripts, etc. "
        "Cannot write to .env, .git/, or node_modules/."
    )
    parameters = [
        Param("path", "string", "Relative file path within workspace (e.g. 'src/main.py')"),
        Param("content", "string", "Full content to write to the file"),
    ]
    risk_level = "medium"
    requires_approval = False
    rate_limit_per_minute = 10
    category = "code"

    def __init__(self, workspace_root: str):
        self._root = workspace_root

    async def execute(self, **kwargs: Any) -> ToolResult:
        rel_path = kwargs.get("path", "").strip()
        content = kwargs.get("content", "")

        if not rel_path:
            return ToolResult(error="No file path provided")

        try:
            base = Path(self._root).resolve()
            target = _validate_workspace_path(self._root, rel_path)
        except ValueError as e:
            return ToolResult(error=str(e))

        safe, reason = _is_write_safe(target, base)
        if not safe:
            return ToolResult(error=reason)

        # Check file size (512KB limit)
        content_bytes = content.encode("utf-8")
        if len(content_bytes) > 512 * 1024:
            return ToolResult(error=f"Content too large ({len(content_bytes)} bytes, max 524288)")

        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content, encoding="utf-8")
            logger.info("write_file: %s (%d bytes)", rel_path, len(content_bytes))
            return ToolResult(
                output=f"File written successfully: {rel_path} ({len(content_bytes)} bytes)",
                metadata={"path": rel_path, "size": len(content_bytes)},
            )
        except Exception as e:
            return ToolResult(error=f"Failed to write file: {e}")


class ApplyPatchTool(BaseTool):
    """Apply an old_str → new_str replacement to a workspace file."""

    name = "apply_patch"
    description = (
        "Apply a targeted edit to an existing file by replacing an exact string. "
        "Provide old_str (the exact text to find, must appear exactly once) and "
        "new_str (the replacement). Use for making precise edits without rewriting "
        "the entire file."
    )
    parameters = [
        Param("path", "string", "Relative file path within workspace"),
        Param("old_str", "string", "Exact text to find in the file (must appear exactly once)"),
        Param("new_str", "string", "Replacement text"),
    ]
    risk_level = "medium"
    requires_approval = False
    rate_limit_per_minute = 10
    category = "code"

    def __init__(self, workspace_root: str):
        self._root = workspace_root

    async def execute(self, **kwargs: Any) -> ToolResult:
        rel_path = kwargs.get("path", "").strip()
        old_str = kwargs.get("old_str", "")
        new_str = kwargs.get("new_str", "")

        if not rel_path:
            return ToolResult(error="No file path provided")
        if not old_str:
            return ToolResult(error="old_str is empty")

        try:
            base = Path(self._root).resolve()
            target = _validate_workspace_path(self._root, rel_path)
        except ValueError as e:
            return ToolResult(error=str(e))

        if not target.is_file():
            return ToolResult(error=f"File not found: {rel_path}")

        safe, reason = _is_write_safe(target, base)
        if not safe:
            return ToolResult(error=reason)

        try:
            content = target.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return ToolResult(error="Binary file — cannot patch")

        count = content.count(old_str)
        if count == 0:
            return ToolResult(error="old_str not found in file")
        if count > 1:
            return ToolResult(error=f"old_str is ambiguous — found {count} occurrences (must be exactly 1)")

        new_content = content.replace(old_str, new_str, 1)
        target.write_text(new_content, encoding="utf-8")

        logger.info("apply_patch: %s (replaced %d chars → %d chars)", rel_path, len(old_str), len(new_str))
        return ToolResult(
            output=f"Patch applied to {rel_path}: replaced {len(old_str)} chars with {len(new_str)} chars",
            metadata={"path": rel_path, "applied": True},
        )
