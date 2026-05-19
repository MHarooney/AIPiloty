"""Read-only host diagnostics — disk, OS. Runs on the backend process host (not the user's browser)."""

from __future__ import annotations

import asyncio
import json
import os
import platform
import sys
from typing import Any, List, Tuple

from ..base import BaseTool, Param, ToolResult


async def _run_cmd(args: List[str], timeout: float = 15.0) -> Tuple[int, str, str]:
    """Run subprocess without shell; return (code, stdout, stderr)."""

    def _sync() -> Tuple[int, str, str]:
        import subprocess

        p = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return p.returncode, p.stdout or "", p.stderr or ""

    return await asyncio.to_thread(_sync)


class HostEnvironmentTool(BaseTool):
    """
    Exposes disk and OS facts from the **server** running AIPiloty (the FastAPI host).
    If you run the backend on your laptop, this reflects *that* machine — not a remote VM.
    """

    name = "get_host_environment"
    description = (
        "Read-only snapshot of the machine hosting the AIPiloty backend: OS, Python version, "
        "and disk free space (df -h). Does **not** include live RAM usage, CPU load, or fan/thermal data. "
        "Use for disk/OS/Python — not when they ask which **LLM/chat model** AIPiloty uses "
        "(that is in the system prompt's THIS DEPLOYMENT block). Does NOT run in the user's browser."
    )
    parameters = [
        Param(
            "include",
            "string",
            "Comma-separated: disk, os, python (default: all three)",
            required=False,
            default="disk,os,python",
        ),
    ]
    risk_level = "low"
    category = "diagnostics"
    rate_limit_per_minute = 30

    async def execute(self, **kw: Any) -> ToolResult:
        include_raw = (kw.get("include") or "disk,os,python").lower()
        parts = {p.strip() for p in include_raw.split(",") if p.strip()}
        if not parts:
            parts = {"disk", "os", "python"}

        out: dict[str, Any] = {}

        try:
            out["where_this_runs"] = (
                "Data below is from the machine running the FastAPI/Ollama backend process. "
                "When the backend runs natively on macOS, this IS the user's Mac — "
                "do NOT call it a 'remote server'. "
                "In Docker on Linux, you will see Linux info instead."
            )
            if "os" in parts:
                out["os"] = platform.platform()
                out["machine"] = platform.machine()
                out["python_runtime_os"] = os.name
                if sys.platform == "darwin":
                    code, sv, _ = await _run_cmd(["sw_vers", "-productVersion"])
                    if code == 0 and sv.strip():
                        out["macos_product_version"] = sv.strip()
                    code2, bn, _ = await _run_cmd(["sw_vers", "-buildVersion"])
                    if code2 == 0 and bn.strip():
                        out["macos_build"] = bn.strip()
            if "python" in parts:
                out["python"] = sys.version.split()[0]
                out["python_full"] = sys.version.replace("\n", " ")
            if "disk" in parts:
                code, stdout, stderr = await _run_cmd(["df", "-h"])
                out["disk_df_h"] = stdout.strip() or stderr
                out["disk_exit_code"] = code
        except Exception as e:
            return ToolResult(error=f"Host diagnostics failed: {e}")

        return ToolResult(output=json.dumps(out, indent=2))
