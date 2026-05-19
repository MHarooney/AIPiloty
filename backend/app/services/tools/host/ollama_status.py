"""Live Ollama status — API + optional CLI — for answering \"what LLM\" with verification."""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from typing import Any, List, Tuple

import httpx

from ....core.config import get_settings
from ..base import BaseTool, Param, ToolResult


def _run_cli(args: List[str], timeout: float = 12.0) -> Tuple[int, str, str]:
    try:
        p = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        return p.returncode, (p.stdout or "").strip(), (p.stderr or "").strip()
    except FileNotFoundError:
        return 127, "", "executable not found"
    except subprocess.TimeoutExpired:
        return 124, "", "timeout"


class OllamaModelStatusTool(BaseTool):
    """
    Cross-checks configured AIPiloty chat/embedding models against the live Ollama daemon.
    Uses HTTP first; optionally runs `ollama list` and `ollama ps` on the backend host if `ollama` is on PATH.
    """

    name = "verify_ollama_models"
    description = (
        "Verify which Ollama models AIPiloty is configured to use vs what Ollama actually reports. "
        "Call when the user asks what **LLM/chat model** is used, wants to **double-check**, "
        "**confirm** the model name, or what is **installed/running** in Ollama. "
        "Do **not** use this for \"what OS\" or \"Python version\" — use get_host_environment instead."
    )
    parameters = [
        Param(
            "include_cli",
            "boolean",
            "If true (default), also run `ollama list` and `ollama ps` when the CLI exists on the API host.",
            required=False,
            default=True,
        ),
    ]
    risk_level = "low"
    category = "diagnostics"
    rate_limit_per_minute = 20

    async def execute(self, **kw: Any) -> ToolResult:
        settings = get_settings()
        include_cli = kw.get("include_cli", True)
        if isinstance(include_cli, str):
            include_cli = include_cli.lower() in ("1", "true", "yes")

        base = settings.ollama_base_url.rstrip("/")
        configured_chat = settings.ollama_model
        embedding = settings.embedding_model

        out: dict[str, Any] = {
            "ollama_base_url": base,
            "configured_chat_model": configured_chat,
            "configured_embedding_model": embedding,
            "api_tags_reachable": False,
            "models_from_api": [],
            "configured_chat_in_api_list": False,
            "configured_embedding_in_api_list": False,
            "api_ps": None,
            "cli": None,
        }

        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                r = await client.get(f"{base}/api/tags")
                if r.status_code == 200:
                    out["api_tags_reachable"] = True
                    data = r.json()
                    names = [m.get("name", "") for m in data.get("models", []) if m.get("name")]
                    out["models_from_api"] = names
                    out["configured_chat_in_api_list"] = configured_chat in names
                    out["configured_embedding_in_api_list"] = embedding in names

                try:
                    rps = await client.get(f"{base}/api/ps")
                    if rps.status_code == 200:
                        out["api_ps"] = rps.json()
                except Exception:
                    pass
        except Exception as e:
            out["api_error"] = str(e)

        if include_cli and shutil.which("ollama"):
            def _cli() -> dict[str, Any]:
                c: dict[str, Any] = {}
                code, so, se = _run_cli(["ollama", "list"])
                c["ollama_list_exit"] = code
                c["ollama_list_stdout"] = so[:8000] if so else ""
                if se:
                    c["ollama_list_stderr"] = se[:2000]
                code2, so2, se2 = _run_cli(["ollama", "ps"])
                c["ollama_ps_exit"] = code2
                c["ollama_ps_stdout"] = so2[:8000] if so2 else ""
                if se2:
                    c["ollama_ps_stderr"] = se2[:2000]
                return c

            out["cli"] = await asyncio.to_thread(_cli)
        elif include_cli:
            out["cli"] = {"note": "`ollama` CLI not found on PATH for this API process — only HTTP results above."}

        return ToolResult(output=json.dumps(out, indent=2))
