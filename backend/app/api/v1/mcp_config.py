"""MCP (Model Context Protocol) server configuration and tool probing.

Stores server configs in ~/.aipiloty/mcp_servers.json.
Each server entry: { id, name, command, args, env, description }

The /probe endpoint spawns the server process, sends initialize + tools/list
JSON-RPC messages, and returns the tool list — mirroring how Claude Desktop
discovers MCP tools.
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ...core.auth import require_auth

router = APIRouter(prefix="/mcp", tags=["MCP"])

_STORE = Path.home() / ".aipiloty" / "mcp_servers.json"


def _load() -> list[dict]:
    if not _STORE.exists():
        return []
    try:
        return json.loads(_STORE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _save(servers: list[dict]) -> None:
    _STORE.parent.mkdir(parents=True, exist_ok=True)
    _STORE.write_text(json.dumps(servers, indent=2), encoding="utf-8")


class MCPServerCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    command: str = Field(..., description="Executable, e.g. 'npx' or 'python'")
    args: list[str] = Field(default_factory=list, description="Command arguments")
    env: dict[str, str] = Field(default_factory=dict, description="Extra env vars")
    description: str = Field("", description="Optional description")


@router.get("/servers")
async def list_servers(identity: str = Depends(require_auth)):
    return _load()


@router.post("/servers", status_code=201)
async def add_server(
    body: MCPServerCreate,
    identity: str = Depends(require_auth),
):
    servers = _load()
    server = {"id": str(uuid.uuid4()), **body.model_dump()}
    servers.append(server)
    _save(servers)
    return server


@router.put("/servers/{server_id}")
async def update_server(
    server_id: str,
    body: MCPServerCreate,
    identity: str = Depends(require_auth),
):
    servers = _load()
    idx = next((i for i, s in enumerate(servers) if s["id"] == server_id), None)
    if idx is None:
        raise HTTPException(404, "Server not found")
    servers[idx] = {"id": server_id, **body.model_dump()}
    _save(servers)
    return servers[idx]


@router.delete("/servers/{server_id}", status_code=204)
async def delete_server(
    server_id: str,
    identity: str = Depends(require_auth),
):
    _save([s for s in _load() if s["id"] != server_id])


@router.post("/servers/{server_id}/probe")
async def probe_server(
    server_id: str,
    identity: str = Depends(require_auth),
):
    """Spawn the MCP server, handshake, and return available tools."""
    server = next((s for s in _load() if s["id"] == server_id), None)
    if not server:
        raise HTTPException(404, "Server not found")
    try:
        tools = await _probe_mcp(server)
        return {"ok": True, "tool_count": len(tools), "tools": tools}
    except asyncio.TimeoutError:
        raise HTTPException(504, "MCP server did not respond within 15 s — check the command/args")
    except Exception as exc:
        raise HTTPException(502, f"MCP probe failed: {exc}")


@router.post("/import-claude-config")
async def import_claude_config(
    body: dict,
    identity: str = Depends(require_auth),
):
    """Import servers from a Claude Desktop mcpServers config dict.

    Body: { "mcpServers": { "name": { "command": "...", "args": [...], "env": {...} } } }
    Returns list of created/updated servers.
    """
    mcp_servers = body.get("mcpServers", {})
    if not isinstance(mcp_servers, dict):
        raise HTTPException(400, "Expected { mcpServers: { name: { command, args, env } } }")

    existing = _load()
    created: list[dict] = []
    for name, cfg in mcp_servers.items():
        if not isinstance(cfg, dict) or "command" not in cfg:
            continue
        # Deduplicate by name
        dup = next((s for s in existing if s["name"] == name), None)
        if dup:
            created.append(dup)
            continue
        server = {
            "id": str(uuid.uuid4()),
            "name": name,
            "command": cfg["command"],
            "args": cfg.get("args", []),
            "env": cfg.get("env", {}),
            "description": cfg.get("description", f"Imported from Claude Desktop config"),
        }
        existing.append(server)
        created.append(server)

    _save(existing)
    return {"imported": len(created), "servers": created}


# ── MCP JSON-RPC over stdio ────────────────────────────────────────────────

async def _probe_mcp(server: dict) -> list[dict]:
    env = {**os.environ, **server.get("env", {})}
    cmd = [server["command"], *server.get("args", [])]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )

    # MCP JSON-RPC: initialize then tools/list
    messages = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "clientInfo": {"name": "aipiloty", "version": "1.0"},
            },
        },
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    ]
    payload = "\n".join(json.dumps(m) for m in messages) + "\n"

    try:
        stdout, _ = await asyncio.wait_for(
            proc.communicate(payload.encode()), timeout=15.0
        )
    finally:
        try:
            proc.kill()
        except ProcessLookupError:
            pass

    tools: list[dict] = []
    for line in stdout.decode(errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            if isinstance(msg, dict) and msg.get("id") == 2 and "result" in msg:
                tools = msg["result"].get("tools", [])
        except json.JSONDecodeError:
            continue
    return tools
