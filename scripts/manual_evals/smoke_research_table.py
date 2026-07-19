#!/usr/bin/env python3
"""Smoke: compare prompt uses research_table fast path and returns a GFM table."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = os.environ.get("AIPILOTY_API_BASE", "http://127.0.0.1:8100/api/v1")
MSG = os.environ.get(
    "SMOKE_MSG",
    "Create a comparison table of Docker vs Podman vs containerd.",
)


def api_key() -> str:
    key = os.environ.get("AIPILOTY_API_KEY", "").strip()
    if key:
        return key
    env_local = ROOT / "frontend" / ".env.local"
    for line in env_local.read_text().splitlines():
        if line.startswith("NEXT_PUBLIC_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("Missing API key")


def main() -> int:
    url = f"{BASE}/chat/stream"
    body = json.dumps(
        {
            "messages": [{"role": "user", "content": MSG}],
            "stream": True,
            "mode": "auto",
        }
    ).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key(),
        },
        method="POST",
    )
    t0 = time.monotonic()
    tokens: list[str] = []
    logs: list[str] = []
    tools = 0
    mode = ""
    with urllib.request.urlopen(req, timeout=180) as resp:
        for raw in resp:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line.startswith("data:"):
                continue
            payload = json.loads(line[5:].strip())
            typ = payload.get("type")
            data = payload.get("data") or {}
            if typ == "token":
                tokens.append(data.get("token") or "")
            elif typ == "log":
                logs.append(str(data.get("message") or ""))
            elif typ == "tool_start":
                tools += 1
            elif typ == "final_report":
                mode = str(data.get("mode") or "")
            elif typ == "done":
                break
            elif typ == "error":
                print("ERROR:", data)
                return 1
    elapsed = time.monotonic() - t0
    text = "".join(tokens)
    print(f"elapsed_s={elapsed:.1f} tools={tools} mode={mode}")
    print("logs:")
    for m in logs[:12]:
        print(" ", m)
    print("--- reply lines (first 6) ---")
    for i, ln in enumerate(text.splitlines()[:6]):
        print(f"{i}: {ln!r}")
    print("--- reply (first 1200 chars) ---")
    print(text[:1200])
    ok = True
    if "RESEARCH_TABLE fast path" not in "\n".join(logs):
        print("FAIL: expected fast-path log")
        ok = False
    compact = "".join(text.split())
    if "|---" not in compact and "|---|---|" not in compact:
        print("FAIL: no GFM table separator")
        ok = False
    if "```mermaid" in text.lower():
        print("FAIL: mermaid fence in table answer")
        ok = False
    # Quality bar: real GFM table + no scaffolding in search queries
    if text.count("|") < 8:
        print("FAIL: expected a filled Markdown table")
        ok = False
    if any("a comparison table of" in m.lower() for m in logs):
        print("FAIL: scaffolding leaked into web_search query")
        ok = False
    if elapsed > 150:
        print("WARN: slow (>150s)")
    print("PASS" if ok else "FAIL")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
