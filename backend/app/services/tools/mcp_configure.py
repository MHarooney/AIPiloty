"""configure_mcp — Agent tool to set up MCP servers on demand.

When the user says "add the GitHub MCP server" or "configure filesystem MCP",
the agent calls this tool which:
  1. Checks if a matching marketplace template exists
  2. Creates/updates the server config via the MCP API
  3. Auto-probes to verify the server starts
  4. Returns a clear success/failure report

This gives AIPiloty the same "configure tools on demand" capability that
Claude Desktop has when users ask it to set up integrations.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .base import BaseTool, Param, ToolResult
from ...core.config import get_settings

logger = logging.getLogger(__name__)


class ConfigureMCPTool(BaseTool):
    """Set up or update an MCP server so the AI can use its tools.

    Use when the user asks to:
    - 'Add the GitHub MCP server'
    - 'Configure filesystem access'
    - 'Set up database MCP'
    - 'Install the brave-search MCP'

    Returns whether the server was configured and how many tools are available.
    """

    name = "configure_mcp"
    description = (
        "Configure or update an MCP (Model Context Protocol) server so the AI can use its tools. "
        "Use for: 'add GitHub MCP', 'configure filesystem access', 'set up database MCP', "
        "'install brave-search'. "
        "Supports marketplace templates: filesystem, github, postgres, sqlite, brave-search, "
        "puppeteer, slack, memory, sequential-thinking, fetch, redis, docker. "
        "Returns configuration status and available tools count."
    )
    parameters = [
        Param(
            name="server_name",
            type="string",
            description=(
                "Name of the MCP server to configure. Use marketplace names: "
                "filesystem, github, postgres, sqlite, brave-search, puppeteer, "
                "slack, memory, sequential-thinking, fetch, redis, docker. "
                "Or provide a custom name with command/args."
            ),
            required=True,
        ),
        Param(
            name="command",
            type="string",
            description="Executable to run (e.g. 'npx', 'uvx', 'python'). Leave empty to use marketplace default.",
            required=False,
            default="",
        ),
        Param(
            name="args",
            type="string",
            description="JSON array of command arguments (e.g. '[\"-y\", \"@modelcontextprotocol/server-github\"]'). Leave empty to use marketplace default.",
            required=False,
            default="[]",
        ),
        Param(
            name="env_json",
            type="string",
            description="JSON object of environment variables (e.g. '{\"GITHUB_PERSONAL_ACCESS_TOKEN\": \"ghp_...\"}').",
            required=False,
            default="{}",
        ),
        Param(
            name="description",
            type="string",
            description="Optional description for this server.",
            required=False,
            default="",
        ),
    ]
    risk_level = "medium"
    requires_approval = False
    category = "knowledge"

    def __init__(self) -> None:
        settings = get_settings()
        self._base_url = f"http://localhost:{settings.server_port if hasattr(settings, 'server_port') else 8100}"
        self._api_key = settings.api_key

    async def execute(self, **kwargs: Any) -> ToolResult:
        import json

        server_name: str = kwargs.get("server_name", "").strip().lower()
        command: str = kwargs.get("command", "").strip()
        args_raw: str = kwargs.get("args", "[]")
        env_raw: str = kwargs.get("env_json", "{}")
        description: str = kwargs.get("description", "")

        if not server_name:
            return ToolResult(error="server_name is required")

        # Parse args and env
        try:
            args = json.loads(args_raw) if args_raw.strip() not in ("", "[]") else []
        except json.JSONDecodeError:
            args = []

        try:
            env = json.loads(env_raw) if env_raw.strip() not in ("", "{}") else {}
        except json.JSONDecodeError:
            env = {}

        headers = {"X-API-Key": self._api_key, "Content-Type": "application/json"}

        # If no command provided, try to use marketplace template first
        if not command:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    r = await client.get(
                        f"{self._base_url}/api/v1/mcp/marketplace",
                        headers=headers,
                    )
                    if r.status_code == 200:
                        items = r.json().get("items", [])
                        template = next(
                            (t for t in items if t["name"] == server_name or t["id"] == server_name),
                            None,
                        )
                        if template:
                            command = template["command"]
                            if not args:
                                args = template["args"]
                            if not env:
                                env = template.get("env", {})
                            if not description:
                                description = template["description"]
            except Exception as exc:
                logger.debug("Marketplace lookup failed: %s", exc)

        if not command:
            return ToolResult(
                error=(
                    f"No command specified and '{server_name}' not found in marketplace. "
                    "Please provide command and args, or use a known marketplace server name: "
                    "filesystem, github, postgres, brave-search, puppeteer, memory, fetch, docker."
                )
            )

        # Call configure-by-name endpoint
        payload = {
            "name": server_name,
            "command": command,
            "args": args,
            "env": env,
            "description": description,
        }
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                r = await client.post(
                    f"{self._base_url}/api/v1/mcp/configure-by-name",
                    headers=headers,
                    json=payload,
                )
                if r.status_code not in (200, 201):
                    return ToolResult(
                        error=f"MCP configuration failed (HTTP {r.status_code}): {r.text[:300]}"
                    )
                result = r.json()
        except Exception as exc:
            return ToolResult(error=f"MCP API call failed: {exc}")

        action = result.get("action", "configured")
        probe = result.get("probe", {})
        probe_ok = probe.get("ok", False)
        tool_count = probe.get("tool_count", 0)

        if probe_ok:
            tool_names = [t.get("name", "") for t in probe.get("tools", [])][:10]
            tools_preview = ", ".join(tool_names) if tool_names else "none listed"
            output = (
                f"✅ MCP server **{server_name}** {action} successfully.\n\n"
                f"- **Command**: `{command} {' '.join(str(a) for a in args)}`\n"
                f"- **Status**: Connected — {tool_count} tool(s) available\n"
                f"- **Tools**: {tools_preview}\n\n"
                "The agent can now use these tools in subsequent conversations. "
                "To use them, reload the agent session or ask a question that requires this server."
            )
        else:
            error_detail = probe.get("error", "server did not respond")
            output = (
                f"⚠️ MCP server **{server_name}** was {action} but the health probe failed.\n\n"
                f"- **Config saved**: yes\n"
                f"- **Probe error**: {error_detail}\n\n"
                "The server config is saved. To troubleshoot:\n"
                f"1. Run `{command}` manually to check if it's installed\n"
                "2. Verify any required environment variables are set\n"
                "3. Check the MCP Settings panel in the Code Editor for details"
            )

        return ToolResult(
            output=output,
            metadata={
                "server_name": server_name,
                "action": action,
                "probe_ok": probe_ok,
                "tool_count": tool_count,
            },
        )
