"""List directory contents on the API host, restricted to paths under the user's home directory."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, List

from ..base import BaseTool, Param, ToolResult


class ListHostPathTool(BaseTool):
    """
    Lists files/folders on the machine running the FastAPI process.
    Only paths under the **resolved home directory** are allowed (e.g. Desktop, Documents).
    """

    name = "list_host_path"
    description = (
        "List files and folders in a directory on the API server host. "
        "Use for 'show my Desktop', 'list Downloads', etc. "
        "Path must be absolute or start with ~ and stay under the user's home directory. "
        "Does not use SSH/VM — this is local to the backend process (Docker/Linux vs native Mac applies)."
    )
    parameters = [
        Param("path", "string", "Directory path, e.g. ~/Desktop or /Users/you/Desktop", required=True),
    ]
    risk_level = "low"
    category = "diagnostics"
    rate_limit_per_minute = 30

    async def execute(self, **kw: Any) -> ToolResult:
        raw = (kw.get("path") or "").strip()
        if not raw:
            return ToolResult(error="path is required")

        try:
            home = Path.home().resolve()
            expanded = Path(os.path.expanduser(raw)).resolve()
        except (OSError, RuntimeError) as e:
            return ToolResult(error=f"Invalid path: {e}")

        # If the path is relative (e.g. "backend", "src") and doesn't exist as-is,
        # search common locations: Desktop projects, home subfolders, etc.
        if not expanded.exists() and not raw.startswith(("/", "~")):
            candidates = [
                home / "Desktop" / raw,
                home / raw,
                home / "Documents" / raw,
                home / "Projects" / raw,
            ]
            # Also try each Desktop subfolder that contains this name
            desktop = home / "Desktop"
            if desktop.is_dir():
                for project_dir in desktop.iterdir():
                    if project_dir.is_dir():
                        candidate = project_dir / raw
                        candidates.append(candidate)
            for c in candidates:
                try:
                    c_resolved = c.resolve()
                    if c_resolved.exists() and c_resolved.is_dir():
                        try:
                            c_resolved.relative_to(home)
                            expanded = c_resolved
                            break
                        except ValueError:
                            pass
                except OSError:
                    pass

        try:
            expanded.relative_to(home)
        except ValueError:
            return ToolResult(
                error="For security, path must be inside your home directory. "
                f"Home is {home}",
            )

        if not expanded.exists():
            return ToolResult(error=f"Path does not exist: {expanded}. Tip: use an absolute path like ~/Desktop/myproject or /Users/you/Desktop/myproject")
        if not expanded.is_dir():
            return ToolResult(error=f"Not a directory: {expanded}")

        entries: List[dict[str, Any]] = []
        try:
            names = sorted(os.listdir(expanded))
        except OSError as e:
            return ToolResult(error=f"Cannot list directory: {e}")

        for name in names[:800]:
            p = expanded / name
            try:
                st = p.stat()
                entries.append(
                    {
                        "name": name,
                        "is_dir": p.is_dir(),
                        "size": st.st_size if p.is_file() else None,
                    }
                )
            except OSError:
                entries.append({"name": name, "is_dir": False, "size": None})

        payload = {
            "path": str(expanded),
            "entry_count": len(entries),
            "entries": entries,
        }
        return ToolResult(output=json.dumps(payload, indent=2))
