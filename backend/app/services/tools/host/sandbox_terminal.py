"""Run commands inside a disposable Docker container (sandbox mode)."""

from __future__ import annotations

import asyncio
import json
import shlex
import time
from typing import Any

from ..base import BaseTool, Param, ToolResult
from ...agent.guardrails import GuardrailService
from ....core.config import get_settings

_MAX_OUTPUT_BYTES = 65_536  # 64 KB cap


class SandboxedTerminalTool(BaseTool):
    """Execute a shell command inside a disposable Docker container.

    The container is created per-invocation with memory/CPU limits,
    no network by default, and auto-removed after execution.
    Falls back to host terminal if Docker is unavailable and
    sandbox_enabled is False.
    """

    name = "run_terminal_command"
    description = (
        "Run a shell command in a sandboxed Docker container and return stdout/stderr. "
        "The container is disposable and resource-limited for safety. "
        "Output is capped at 64 KB."
    )
    parameters = [
        Param("command", "string", "The shell command to execute", required=True),
        Param("cwd", "string", "Working directory inside the container", required=False, default="/workspace"),
        Param("timeout_sec", "integer", "Timeout in seconds (default 30, max 120)", required=False, default=30),
    ]
    risk_level = "low"
    requires_approval = False
    category = "terminal"

    def __init__(self, guardrails: GuardrailService):
        self._guardrails = guardrails

    async def execute(self, **kwargs: Any) -> ToolResult:
        command: str = kwargs.get("command", "").strip()
        cwd: str = kwargs.get("cwd") or "/workspace"
        timeout_sec: int = min(int(kwargs.get("timeout_sec", 30)), 120)

        if not command:
            return ToolResult(error="No command provided")

        # Sanitize & safety check still apply
        command = self._guardrails.sanitize_command(command)
        safety = self._guardrails.check_command_safety(command)
        if not safety["safe"]:
            return ToolResult(
                error=f"Command blocked: {safety['reason']}",
                metadata={"blocked": True, "risk_level": safety["risk_level"]},
            )

        settings = get_settings()
        workspace = str(settings.resolved_workspace)

        # Build docker run command
        docker_args = [
            "docker", "run",
            "--rm",                                        # auto-remove
            "--memory", settings.sandbox_memory_limit,     # e.g. "512m"
            "--cpus", str(settings.sandbox_cpu_limit),     # e.g. 1.0
            "--pids-limit", "64",                          # limit process count
            "--read-only",                                 # read-only root FS
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",   # writable /tmp
            "-v", f"{workspace}:/workspace:ro",            # mount workspace read-only
            "-w", cwd,
        ]

        if settings.sandbox_network_disabled:
            docker_args.append("--network=none")

        docker_args.extend([
            settings.sandbox_image,
            "sh", "-c", command,
        ])

        start = time.monotonic()

        try:
            proc = await asyncio.create_subprocess_exec(
                *docker_args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_sec
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()  # type: ignore[union-attr]
            except ProcessLookupError:
                pass
            return ToolResult(
                error=f"Container timed out after {timeout_sec}s",
                metadata={"timed_out": True, "sandboxed": True},
            )
        except FileNotFoundError:
            return ToolResult(error="Docker not found. Sandbox mode requires Docker.")
        except Exception as e:
            return ToolResult(error=f"Sandbox execution failed: {e}")

        duration_ms = int((time.monotonic() - start) * 1000)

        stdout = stdout_bytes.decode("utf-8", errors="replace")
        stderr = stderr_bytes.decode("utf-8", errors="replace")

        # Redact PII
        stdout = self._guardrails.redact_pii(stdout)
        stderr = self._guardrails.redact_pii(stderr)

        # Truncate
        truncated = False
        if len(stdout) > _MAX_OUTPUT_BYTES:
            stdout = stdout[:_MAX_OUTPUT_BYTES]
            truncated = True
        if len(stderr) > _MAX_OUTPUT_BYTES:
            stderr = stderr[:_MAX_OUTPUT_BYTES]
            truncated = True

        exit_code = proc.returncode or 0

        result_data = {
            "exit_code": exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "truncated": truncated,
            "hostname": "sandbox-container",
            "duration_ms": duration_ms,
            "command": command,
            "sandboxed": True,
            "image": settings.sandbox_image,
        }

        if exit_code != 0:
            return ToolResult(
                output=json.dumps(result_data, indent=2),
                error=f"Command exited with code {exit_code}",
                metadata=result_data,
            )

        return ToolResult(
            output=json.dumps(result_data, indent=2),
            metadata=result_data,
        )
