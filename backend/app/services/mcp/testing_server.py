"""AIPiloty MCP Testing Server — JSON-RPC 2.0 over stdio.

Implements the Model Context Protocol (MCP) server interface, making the five
testing tools available to any MCP client (Claude Desktop, VS Code Agent, etc.).

Run standalone:
    python -m app.services.mcp.testing_server

Or register in Claude Desktop's config:
    {
      "mcpServers": {
        "aipiloty-testing": {
          "command": "python",
          "args": ["-m", "app.services.mcp.testing_server"],
          "cwd": "/path/to/aipiloty/backend"
        }
      }
    }
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

# ── Tool instances (lazy import so the server can be imported without the full app) ──

def _get_tools() -> dict:
    from app.services.tools.testing.api_tools import (
        ProbeApiTargetTool,
        RunApiTestsTool,
        AnalyzeTestFailuresTool,
    )
    from app.services.tools.testing.local_tools import (
        RunLocalPytestTool,
        GenerateTestCodeTool,
    )
    tools = [
        ProbeApiTargetTool(),
        RunApiTestsTool(),
        AnalyzeTestFailuresTool(),
        RunLocalPytestTool(),
        GenerateTestCodeTool(),
    ]
    return {t.name: t for t in tools}


# ── JSON-RPC helpers ─────────────────────────────────────────────────────────

def _ok(request_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error(request_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _write(obj: dict) -> None:
    """Write a single JSON-RPC message to stdout followed by newline."""
    line = json.dumps(obj, ensure_ascii=False)
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


# ── Request handlers ─────────────────────────────────────────────────────────

_PROTOCOL_VERSION = "2024-11-05"
_SERVER_INFO = {"name": "aipiloty-testing", "version": "1.0.0"}

_TOOLS_CACHE: dict | None = None


def _tools() -> dict:
    global _TOOLS_CACHE
    if _TOOLS_CACHE is None:
        _TOOLS_CACHE = _get_tools()
    return _TOOLS_CACHE


def _handle_initialize(req: dict) -> dict:
    return _ok(
        req.get("id"),
        {
            "protocolVersion": _PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": _SERVER_INFO,
        },
    )


def _handle_tools_list(req: dict) -> dict:
    tool_list = []
    for tool in _tools().values():
        schema = tool.to_ollama_schema()
        tool_list.append(
            {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": schema.get("function", {}).get("parameters", {}),
            }
        )
    return _ok(req.get("id"), {"tools": tool_list})


async def _handle_tools_call(req: dict) -> dict:
    params = req.get("params") or {}
    tool_name = params.get("name")
    arguments = params.get("arguments") or {}

    if not tool_name:
        return _error(req.get("id"), -32602, "Missing 'name' in params")

    tool = _tools().get(tool_name)
    if tool is None:
        return _error(req.get("id"), -32601, f"Tool '{tool_name}' not found")

    try:
        result = await tool.execute(**arguments)
    except Exception as exc:
        return _error(req.get("id"), -32000, f"Tool execution error: {exc}")

    content: list[dict]
    if result.error:
        content = [{"type": "text", "text": f"Error: {result.error}"}]
    else:
        output = result.output
        if isinstance(output, (dict, list)):
            text = json.dumps(output, ensure_ascii=False, indent=2)
        else:
            text = str(output)
        content = [{"type": "text", "text": text}]

    return _ok(req.get("id"), {"content": content, "isError": not result.success})


def _handle_notifications_initialized(req: dict) -> None:
    """Fire-and-forget — no response needed for notifications."""
    return None


# ── Main event loop ──────────────────────────────────────────────────────────

async def _run() -> None:
    loop = asyncio.get_event_loop()
    reader = asyncio.StreamReader()
    protocol = asyncio.StreamReaderProtocol(reader)
    await loop.connect_read_pipe(lambda: protocol, sys.stdin)

    while True:
        try:
            line = await reader.readline()
        except Exception:
            break
        if not line:
            break

        line = line.decode("utf-8", errors="replace").strip()
        if not line:
            continue

        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            _write(_error(None, -32700, f"Parse error: {exc}"))
            continue

        method: str = req.get("method", "")
        req_id = req.get("id")  # None means notification

        if method == "initialize":
            _write(_handle_initialize(req))
        elif method == "notifications/initialized":
            # Notification — no response
            pass
        elif method == "tools/list":
            _write(_handle_tools_list(req))
        elif method == "tools/call":
            response = await _handle_tools_call(req)
            _write(response)
        elif method == "ping":
            _write(_ok(req_id, {}))
        elif req_id is not None:
            # Unknown method with an ID — return method-not-found
            _write(_error(req_id, -32601, f"Method not found: {method}"))
        # else: unknown notification, silently ignore


def main() -> None:
    asyncio.run(_run())


if __name__ == "__main__":
    main()
