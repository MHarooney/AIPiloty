#!/usr/bin/env python3
"""Reproduce web-style vs IDE-style image generation against local backend."""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV = ROOT / ".env"


def load_key() -> str:
    env: dict[str, str] = {}
    if ENV.exists():
        for line in ENV.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return (
        env.get("API_KEY")
        or env.get("AIPILOTY_API_KEY")
        or "aipiloty-dev-key-change-in-production"
    )


def post_sse(payload: dict, key: str) -> list[dict]:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:8100/api/v1/chat/stream",
        data=body,
        headers={
            "X-API-Key": key,
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    events: list[dict] = []
    with urllib.request.urlopen(req, timeout=180) as resp:
        for raw in resp:
            line = raw.decode("utf-8", errors="replace").rstrip("\n")
            if not line.startswith("data: "):
                continue
            data = line[6:].strip()
            if data == "[DONE]":
                break
            try:
                events.append(json.loads(data))
            except json.JSONDecodeError:
                continue
    return events


def summarize(events: list[dict]) -> None:
    session = None
    tools = []
    errors = []
    tokens = []
    for e in events:
        t = e.get("type")
        d = e.get("data") or {}
        if t == "session":
            session = d.get("session_key")
        elif t == "tool_start":
            tools.append({"start": d.get("tool"), "args": d.get("arguments")})
        elif t == "tool_output":
            out = str(d.get("output", ""))[:300]
            tools.append({"output": d.get("tool"), "snippet": out})
        elif t == "tool_error":
            errors.append(d)
        elif t == "error":
            errors.append(d)
        elif t == "token":
            tok = d.get("token") or d.get("content") or ""
            if tok:
                tokens.append(str(tok))
        elif t == "approval_required":
            tools.append({"approval": d.get("tool"), "risk": d.get("risk_level")})
    print("session:", session)
    print("tools:", json.dumps(tools, indent=2)[:2000])
    print("errors:", errors)
    print("reply:", "".join(tokens)[-500:])


def main() -> int:
    key = load_key()
    print("key_suffix:", key[-12:])

    tools_py = ROOT / "app/services/tools/documents/tools.py"
    text = tools_py.read_text()
    print("has_int_arg:", "_int_arg" in text)
    print("has_null_guard:", "Never pass null" in text)

    # 1) Web-style: first message alone
    print("\n=== WEB STEP1: generate image (no model) ===")
    ev1 = post_sse(
        {
            "messages": [
                {"role": "user", "content": "Generate course cover image for HTML"}
            ],
            "session_key": None,
            "mode": "agent",
            "auto_approve": True,
        },
        key,
    )
    summarize(ev1)
    session = None
    for e in ev1:
        if e.get("type") == "session":
            session = (e.get("data") or {}).get("session_key")

    if not session:
        print("NO SESSION — abort")
        return 1

    # 2) Web-style follow-up with model (same session, single message)
    print("\n=== WEB STEP2: pick gpt-image-1 (same session) ===")
    follow = (
        'Generate the image now using model "gpt-image-1" (do not ask again). '
        "Prompt: Course cover image for HTML — modern, clean, educational"
    )
    ev2 = post_sse(
        {
            "messages": [{"role": "user", "content": follow}],
            "session_key": session,
            "mode": "agent",
            "auto_approve": True,
        },
        key,
    )
    summarize(ev2)

    # 3) IDE-style broken: full confusing history, NO session_key
    print("\n=== IDE BROKEN STYLE: full history, no session_key ===")
    messy = [
        {"role": "user", "content": "Generate course cover image for HTML"},
        {
            "role": "assistant",
            "content": (
                "Mode: Agent\n\nPlan\n1. Analyze request\n"
                'generate_image finished.\n{"success": true, "output": '
                '{"status": "needs_model_choice"}}\n'
                "Choose an image model below to continue."
            ),
        },
        {
            "role": "user",
            "content": follow,
        },
        {
            "role": "assistant",
            "content": (
                "Unfortunately, the tool returned an error message indicating that "
                "the width and height parameters were not provided as required."
            ),
        },
        {
            "role": "user",
            "content": follow,
        },
    ]
    ev3 = post_sse(
        {
            "messages": messy,
            "session_key": None,
            "mode": "agent",
            "auto_approve": True,
        },
        key,
    )
    summarize(ev3)

    # 4) IDE fixed style: only latest user msg + session from step1-like new session
    print("\n=== IDE FIXED STYLE: latest msg + session_key ===")
    # new short session then follow-up
    ev4a = post_sse(
        {
            "messages": [
                {"role": "user", "content": "Generate course cover image for HTML"}
            ],
            "mode": "agent",
            "auto_approve": True,
        },
        key,
    )
    s2 = None
    for e in ev4a:
        if e.get("type") == "session":
            s2 = (e.get("data") or {}).get("session_key")
    print("session2:", s2)
    ev4b = post_sse(
        {
            "messages": [{"role": "user", "content": follow}],
            "session_key": s2,
            "mode": "agent",
            "auto_approve": True,
        },
        key,
    )
    summarize(ev4b)
    return 0


if __name__ == "__main__":
    sys.exit(main())
