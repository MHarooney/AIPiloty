#!/usr/bin/env python3
"""Short web-style image follow-up smoke test (2 turns, auto_approve)."""
from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_key() -> str:
    env: dict[str, str] = {}
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env.get("API_KEY") or env.get("AIPILOTY_API_KEY") or "aipiloty-dev-key-change-in-production"


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
    with urllib.request.urlopen(req, timeout=120) as resp:
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


def main() -> int:
    key = load_key()
    follow = (
        'Generate the image now using model "gpt-image-1" (do not ask again). '
        "Prompt: Simple HTML course cover, modern flat design, blue accents"
    )

    # Simulate IDE-fixed path: one message + session, then follow-up only
    print("STEP1…")
    ev1 = post_sse(
        {
            "messages": [{"role": "user", "content": "Generate a course cover image for HTML"}],
            "mode": "agent",
            "auto_approve": True,
        },
        key,
    )
    session = next(
        ((e.get("data") or {}).get("session_key") for e in ev1 if e.get("type") == "session"),
        None,
    )
    outs1 = [e for e in ev1 if e.get("type") in ("tool_start", "tool_output", "tool_error", "error")]
    print("session", session)
    print("step1_events", json.dumps(outs1, indent=2)[:1200])

    if not session:
        return 1

    print("STEP2…")
    ev2 = post_sse(
        {
            "messages": [{"role": "user", "content": follow}],
            "session_key": session,
            "mode": "agent",
            "auto_approve": True,
        },
        key,
    )
    outs2 = [e for e in ev2 if e.get("type") in ("tool_start", "tool_output", "tool_error", "error", "token")]
    # compact
    compact = []
    token_buf = []
    for e in outs2:
        if e.get("type") == "token":
            token_buf.append(str((e.get("data") or {}).get("token") or ""))
        else:
            compact.append(e)
    print("step2_tools", json.dumps(compact, indent=2)[:2000])
    print("step2_reply_tail", "".join(token_buf)[-400:])

    # success if any tool_output mentions relative_path / success true for generate_image
    blob = json.dumps(compact)
    ok = "relative_path" in blob or '"success": true' in blob or "download_url" in blob
    print("SUCCESS" if ok else "NO_IMAGE_YET")
    return 0 if ok else 2


if __name__ == "__main__":
    sys.exit(main())
