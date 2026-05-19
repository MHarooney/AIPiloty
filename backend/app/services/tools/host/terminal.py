"""Run bounded shell commands on the backend host with streaming support."""

from __future__ import annotations

import asyncio
import json
import platform
import shlex
import time
from typing import Any

from ..base import BaseTool, Param, ToolResult
from ...agent.guardrails import GuardrailService

_MAX_OUTPUT_BYTES = 65_536  # 64 KB cap
_DEFAULT_TIMEOUT = 30
_MAX_TIMEOUT = 120


class TerminalCommandTool(BaseTool):
    """Execute a shell command on the AIPiloty backend host and return its output.

    All commands pass through GuardrailService.check_command_safety() before
    execution.  Dangerous patterns are blocked; high-risk commands require
    user approval (handled by the orchestrator's approval flow).
    """

    name = "run_terminal_command"
    description = (
        "Run a shell command on the server hosting AIPiloty and return stdout/stderr. "
        "Use for inspecting logs, checking service status, listing files, running "
        "build commands, etc. Commands are safety-checked; destructive patterns are "
        "blocked. Output is capped at 64 KB."
    )
    parameters = [
        Param("command", "string", "The shell command to execute", required=True),
        Param("cwd", "string", "Working directory (absolute path, optional)", required=False, default=None),
        Param("timeout_sec", "integer", "Timeout in seconds (default 30, max 120)", required=False, default=30),
    ]
    risk_level = "medium"
    requires_approval = False  # Guardrails decides per-command
    category = "terminal"

    def __init__(self, guardrails: GuardrailService):
        self._guardrails = guardrails

    async def execute(self, **kwargs: Any) -> ToolResult:
        command: str = kwargs.get("command", "").strip()
        cwd: str | None = kwargs.get("cwd") or None
        timeout_sec: int = min(int(kwargs.get("timeout_sec", _DEFAULT_TIMEOUT)), _MAX_TIMEOUT)

        if not command:
            return ToolResult(error="No command provided")

        # Sanitize
        command = self._guardrails.sanitize_command(command)

        # Safety check
        safety = self._guardrails.check_command_safety(command)
        if not safety["safe"]:
            return ToolResult(
                error=f"Command blocked: {safety['reason']}",
                metadata={"blocked": True, "risk_level": safety["risk_level"]},
            )

        # Parse into argv to avoid shell=True
        try:
            argv = shlex.split(command)
        except ValueError as e:
            return ToolResult(error=f"Invalid command syntax: {e}")

        if not argv:
            return ToolResult(error="Empty command after parsing")

        hostname = platform.node() or "localhost"
        start = time.monotonic()

        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=cwd,
            )
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=timeout_sec
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()  # type: ignore[union-attr]
            except ProcessLookupError:
                pass
            duration_ms = int((time.monotonic() - start) * 1000)
            return ToolResult(
                error=f"Command timed out after {timeout_sec}s",
                metadata={
                    "hostname": hostname,
                    "duration_ms": duration_ms,
                    "timed_out": True,
                },
            )
        except FileNotFoundError:
            return ToolResult(error=f"Command not found: {argv[0]}")
        except PermissionError:
            return ToolResult(error=f"Permission denied: {argv[0]}")

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
            "hostname": hostname,
            "duration_ms": duration_ms,
            "command": command,
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
