#!/usr/bin/env python3
"""
Standalone deep eval for AIPiloty chat routing (does NOT modify app code).

Runs as an end-user against the live API:
  - greetings → expect static/fast reply (no long tool loop)
  - identity / questions → expect LLM-like answer (NOT canned "Got it!")
  - mid-conversation yes/no → document risk of static short-circuit
  - tool-ish prompts → expect agent/thinking path

Usage:
  export AIPILOTY_API_KEY=...   # or read from frontend/.env.local
  python3 scripts/manual_evals/chat_routing_deep_eval.py
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BASE = os.environ.get("AIPILOTY_API_BASE", "http://127.0.0.1:8100/api/v1")
OUT = ROOT / "docs" / "audits" / "chat_routing_deep_eval_results.json"

CANNED_PATTERNS = [
    r"^Got it! Let me know what you'd like to do\.?$",
    r"^Hello! How can I help you today\?$",
    r"^Hi there! What can I do for you\?$",
    r"^Okay! What would you like to do next\?$",
    r"^Okay! What can I help with\?$",
    r"^No problem\. What else can I help with\?$",
]


def load_api_key() -> str:
    key = os.environ.get("AIPILOTY_API_KEY", "").strip()
    if key:
        return key
    env_local = ROOT / "frontend" / ".env.local"
    if env_local.exists():
        for line in env_local.read_text().splitlines():
            if line.startswith("NEXT_PUBLIC_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("Missing AIPILOTY_API_KEY / frontend/.env.local")


@dataclass
class CaseResult:
    id: str
    category: str
    message: str
    expect: str
    ok: bool
    latency_ms: float
    reply: str
    notes: str
    saw_thinking: bool
    tool_events: int


def stream_chat(api_key: str, message: str, timeout_s: float = 180.0) -> tuple[str, bool, int, float]:
    """POST /chat/stream and collect token text + thinking/tool signals."""
    url = f"{BASE}/chat/stream"
    body = json.dumps(
        {
            "messages": [{"role": "user", "content": message}],
            "stream": True,
        }
    ).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
            "Accept": "text/event-stream",
        },
        method="POST",
    )
    tokens: list[str] = []
    saw_thinking = False
    tool_events = 0
    t0 = time.monotonic()
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        buf = ""
        while True:
            chunk = resp.read(256)
            if not chunk:
                break
            buf += chunk.decode("utf-8", errors="replace")
            while "\n" in buf:
                line, buf = buf.split("\n", 1)
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw or raw == "[DONE]":
                    continue
                try:
                    evt = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                et = evt.get("type") or evt.get("event") or ""
                data = evt.get("data") if isinstance(evt.get("data"), dict) else evt
                if et == "thinking":
                    saw_thinking = True
                if "tool" in str(et).lower() or data.get("tool") or data.get("tool_name"):
                    tool_events += 1
                if et in ("token", "message", "content"):
                    tok = data.get("token") or data.get("content") or data.get("text") or ""
                    if tok:
                        tokens.append(str(tok))
    latency_ms = (time.monotonic() - t0) * 1000
    reply = "".join(tokens).strip()
    # Fallback: join any content fields if empty
    return reply, saw_thinking, tool_events, latency_ms


def is_canned(reply: str) -> bool:
    r = reply.strip()
    return any(re.match(p, r) for p in CANNED_PATTERNS)


def evaluate(case: dict, reply: str, saw_thinking: bool, tool_events: int, latency_ms: float) -> CaseResult:
    expect = case["expect"]
    notes = []
    ok = True
    canned = is_canned(reply)

    if not reply:
        ok = False
        notes.append("empty reply")

    if expect == "static_greeting":
        if not canned and latency_ms > 3000:
            # Static path should be instant; allow non-exact template if very fast
            notes.append("expected fast static; reply not matching known templates")
        if latency_ms > 5000:
            ok = False
            notes.append(f"too slow for greeting short-circuit ({latency_ms:.0f}ms)")
        if saw_thinking and latency_ms > 2000:
            notes.append("unexpected thinking on greeting")
    elif expect == "llm_answer":
        if canned:
            ok = False
            notes.append("got canned short-circuit instead of LLM answer")
        # Identity answers should mention AI / assistant / AIPiloty-ish concepts sometimes
        if case.get("must_not_be_canned") and canned:
            ok = False
        if len(reply) < 8:
            ok = False
            notes.append("reply too short for LLM path")
    elif expect == "agent_or_llm":
        if canned:
            ok = False
            notes.append("canned reply on task prompt")
        if not reply:
            ok = False
    elif expect == "document_risk":
        # Don't fail build — document whether yes/no was short-circuited
        notes.append("STATIC_SHORTCUT" if canned else "WENT_TO_LLM")
        ok = True

    return CaseResult(
        id=case["id"],
        category=case["category"],
        message=case["message"],
        expect=expect,
        ok=ok,
        latency_ms=round(latency_ms, 1),
        reply=reply[:500],
        notes="; ".join(notes) or "pass",
        saw_thinking=saw_thinking,
        tool_events=tool_events,
    )


CASES = [
    # Greetings — static OK
    {"id": "g1", "category": "greeting", "message": "hello", "expect": "static_greeting"},
    {"id": "g2", "category": "greeting", "message": "hi", "expect": "static_greeting"},
    {"id": "g3", "category": "greeting", "message": "thanks", "expect": "static_greeting"},
    {"id": "g4", "category": "greeting", "message": "bye", "expect": "static_greeting"},
    # Identity / questions — must reach LLM
    {"id": "q1", "category": "identity", "message": "who are you?", "expect": "llm_answer", "must_not_be_canned": True},
    {"id": "q2", "category": "identity", "message": "are you a robot", "expect": "llm_answer", "must_not_be_canned": True},
    {"id": "q3", "category": "identity", "message": "what is AIPiloty", "expect": "llm_answer", "must_not_be_canned": True},
    {"id": "q4", "category": "knowledge", "message": "what is docker?", "expect": "llm_answer", "must_not_be_canned": True},
    # Variants / robustness
    {"id": "v1", "category": "variant", "message": "Hello!!!", "expect": "static_greeting"},  # rstrip ! → hello
    {"id": "v2", "category": "variant", "message": "  Hi  ", "expect": "static_greeting"},
    {"id": "v3", "category": "variant", "message": "Who are YOU???", "expect": "llm_answer", "must_not_be_canned": True},
    # Dangerous static keys mid-conversation (single-turn probe)
    {"id": "r1", "category": "ack", "message": "yes", "expect": "llm_answer", "must_not_be_canned": True},
    {"id": "r2", "category": "ack", "message": "no", "expect": "llm_answer", "must_not_be_canned": True},
    {"id": "r3", "category": "ack", "message": "ok", "expect": "llm_answer", "must_not_be_canned": True},
    # Task-ish
    {"id": "t1", "category": "task", "message": "list my ollama models", "expect": "agent_or_llm"},
]


def main() -> int:
    api_key = load_api_key()
    results: list[CaseResult] = []
    print(f"API base: {BASE}")
    print(f"Cases: {len(CASES)}\n")

    for case in CASES:
        print(f"→ [{case['id']}] {case['message']!r} ...", flush=True)
        try:
            reply, thinking, tools, ms = stream_chat(api_key, case["message"])
        except Exception as e:
            results.append(
                CaseResult(
                    id=case["id"],
                    category=case["category"],
                    message=case["message"],
                    expect=case["expect"],
                    ok=False,
                    latency_ms=0,
                    reply="",
                    notes=f"ERROR: {e}",
                    saw_thinking=False,
                    tool_events=0,
                )
            )
            print(f"  FAIL ERROR {e}")
            continue
        cr = evaluate(case, reply, thinking, tools, ms)
        results.append(cr)
        status = "PASS" if cr.ok else "FAIL"
        print(f"  {status} {cr.latency_ms:.0f}ms thinking={cr.saw_thinking} | {cr.reply[:120]!r}")
        print(f"  notes: {cr.notes}")

    passed = sum(1 for r in results if r.ok)
    failed = sum(1 for r in results if not r.ok)
    summary = {
        "passed": passed,
        "failed": failed,
        "total": len(results),
        "results": [asdict(r) for r in results],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(summary, indent=2))
    print(f"\n=== SUMMARY {passed}/{len(results)} passed, {failed} failed ===")
    print(f"Wrote {OUT}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
