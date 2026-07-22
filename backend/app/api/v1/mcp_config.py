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
from typing import Optional

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
    enabled: bool = Field(True, description="When false, Agent skips this MCP server")


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


# ── MCP Marketplace — curated catalogue ─────────────────────────────────────

_MARKETPLACE: list[dict] = [
    {
        "id": "filesystem",
        "name": "filesystem",
        "category": "Files",
        "description": "Read, write, list, search local files. Essential for code-aware AI.",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "{WORKSPACE_PATH}"],
        "env": {},
        "requires_env": [],
        "popular": True,
        "official": True,
    },
    {
        "id": "github",
        "name": "github",
        "category": "Development",
        "description": "Read repos, create issues and PRs, manage code reviews on GitHub.",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": ""},
        "requires_env": ["GITHUB_PERSONAL_ACCESS_TOKEN"],
        "popular": True,
        "official": True,
    },
    {
        "id": "postgres",
        "name": "postgres",
        "category": "Databases",
        "description": "Query PostgreSQL — the AI can run SELECT, INSERT, UPDATE via natural language.",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-postgres", "{DATABASE_URL}"],
        "env": {},
        "requires_env": ["DATABASE_URL"],
        "popular": True,
        "official": True,
    },
    {
        "id": "sqlite",
        "name": "sqlite",
        "category": "Databases",
        "description": "Query local SQLite databases — great for prototypes and local dev.",
        "command": "uvx",
        "args": ["mcp-server-sqlite", "--db-path", "{DB_PATH}"],
        "env": {},
        "requires_env": ["DB_PATH"],
        "popular": False,
        "official": True,
    },
    {
        "id": "brave-search",
        "name": "brave-search",
        "category": "Search",
        "description": "Real-time web search via Brave. Lets the AI fetch live information.",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-brave-search"],
        "env": {"BRAVE_API_KEY": ""},
        "requires_env": ["BRAVE_API_KEY"],
        "popular": True,
        "official": True,
    },
    {
        "id": "puppeteer",
        "name": "puppeteer",
        "category": "Browser",
        "description": "Control a headless Chrome browser — scrape, automate UI, take screenshots.",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-puppeteer"],
        "env": {},
        "requires_env": [],
        "popular": True,
        "official": True,
    },
    {
        "id": "slack",
        "name": "slack",
        "category": "Communication",
        "description": "Read/send Slack messages, list channels, manage notifications.",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-slack"],
        "env": {"SLACK_BOT_TOKEN": "", "SLACK_TEAM_ID": ""},
        "requires_env": ["SLACK_BOT_TOKEN", "SLACK_TEAM_ID"],
        "popular": False,
        "official": True,
    },
    {
        "id": "memory",
        "name": "memory",
        "category": "AI",
        "description": "Persistent memory for the AI — store facts across conversations.",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-memory"],
        "env": {},
        "requires_env": [],
        "popular": True,
        "official": True,
    },
    {
        "id": "sequential-thinking",
        "name": "sequential-thinking",
        "category": "AI",
        "description": "Adds structured step-by-step reasoning to complex problem solving.",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"],
        "env": {},
        "requires_env": [],
        "popular": True,
        "official": True,
    },
    {
        "id": "fetch",
        "name": "fetch",
        "category": "Network",
        "description": "Fetch any URL and convert to markdown for the AI to read.",
        "command": "uvx",
        "args": ["mcp-server-fetch"],
        "env": {},
        "requires_env": [],
        "popular": True,
        "official": True,
    },
    {
        "id": "redis",
        "name": "redis",
        "category": "Databases",
        "description": "Read/write Redis keys and run commands against a local Redis instance.",
        "command": "uvx",
        "args": ["mcp-server-redis", "{REDIS_URL}"],
        "env": {},
        "requires_env": ["REDIS_URL"],
        "popular": False,
        "official": False,
    },
    {
        "id": "docker",
        "name": "docker",
        "category": "DevOps",
        "description": "Manage Docker containers, images, volumes and networks from AI.",
        "command": "uvx",
        "args": ["mcp-server-docker"],
        "env": {},
        "requires_env": [],
        "popular": True,
        "official": False,
    },
]


@router.get("/marketplace")
async def marketplace(
    category: Optional[str] = None,
    identity: str = Depends(require_auth),
):
    """Return the curated MCP marketplace catalogue."""
    installed_names = {s["name"] for s in _load()}
    items = [
        {**item, "installed": item["name"] in installed_names}
        for item in _MARKETPLACE
        if not category or item["category"] == category
    ]
    return {
        "items": items,
        "categories": sorted(set(i["category"] for i in _MARKETPLACE)),
        "total": len(items),
    }


class InstallFromMarketplaceRequest(BaseModel):
    marketplace_id: str = Field(..., description="ID from the marketplace catalogue")
    env_values: dict[str, str] = Field(default_factory=dict, description="Values for required env vars")
    workspace_path: str = Field("", description="Override WORKSPACE_PATH placeholder")


@router.post("/marketplace/install", status_code=201)
async def install_from_marketplace(
    body: InstallFromMarketplaceRequest,
    identity: str = Depends(require_auth),
):
    """One-click install an MCP server from the marketplace catalogue.

    Resolves argument/env placeholders and saves to ~/.aipiloty/mcp_servers.json.
    """
    template = next((t for t in _MARKETPLACE if t["id"] == body.marketplace_id), None)
    if not template:
        raise HTTPException(404, f"Marketplace item '{body.marketplace_id}' not found")

    existing = _load()
    if any(s["name"] == template["name"] for s in existing):
        raise HTTPException(409, f"Server '{template['name']}' is already installed")

    # Resolve placeholders in args
    workspace = body.workspace_path or str(Path.home())
    def resolve(s: str) -> str:
        s = s.replace("{WORKSPACE_PATH}", workspace)
        for k, v in body.env_values.items():
            s = s.replace(f"{{{k}}}", v)
        return s

    resolved_args = [resolve(a) for a in template["args"]]
    resolved_env = {k: body.env_values.get(k, v) for k, v in template["env"].items()}

    server = {
        "id": str(uuid.uuid4()),
        "name": template["name"],
        "command": template["command"],
        "args": resolved_args,
        "env": resolved_env,
        "description": template["description"],
    }
    existing.append(server)
    _save(existing)
    return {"installed": True, "server": server}


class ConfigureByNameRequest(BaseModel):
    """Used by the AI agent tool to configure an MCP server by name."""
    name: str = Field(..., description="Server name (e.g. 'filesystem', 'github')")
    command: str = Field(..., description="Executable command")
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
    description: str = Field("", description="Short description")


@router.post("/configure-by-name", status_code=201)
async def configure_by_name(
    body: ConfigureByNameRequest,
    identity: str = Depends(require_auth),
):
    """AI agent endpoint: add or update an MCP server by name (upsert semantics)."""
    servers = _load()
    existing_idx = next((i for i, s in enumerate(servers) if s["name"] == body.name), None)

    server = {
        "id": servers[existing_idx]["id"] if existing_idx is not None else str(uuid.uuid4()),
        "name": body.name,
        "command": body.command,
        "args": body.args,
        "env": body.env,
        "description": body.description or f"Configured by AI agent",
    }

    if existing_idx is not None:
        servers[existing_idx] = server
        action = "updated"
    else:
        servers.append(server)
        action = "created"

    _save(servers)

    # Auto-probe to verify it works
    probe_result = {"ok": False, "tools": [], "error": ""}
    try:
        tools = await asyncio.wait_for(_probe_mcp(server), timeout=10.0)
        probe_result = {"ok": True, "tools": tools, "tool_count": len(tools)}
    except Exception as exc:
        probe_result = {"ok": False, "tool_count": 0, "error": str(exc)}

    return {"action": action, "server": server, "probe": probe_result}


@router.get("/servers/{server_id}/status")
async def server_status(
    server_id: str,
    identity: str = Depends(require_auth),
):
    """Quick health check for a single MCP server (lightweight probe)."""
    server = next((s for s in _load() if s["id"] == server_id), None)
    if not server:
        raise HTTPException(404, "Server not found")
    try:
        tools = await asyncio.wait_for(_probe_mcp(server), timeout=8.0)
        return {"ok": True, "tool_count": len(tools), "tools": [t.get("name") for t in tools]}
    except Exception as exc:
        return {"ok": False, "tool_count": 0, "error": str(exc)}
