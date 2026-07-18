#!/usr/bin/env python3
"""Browser-parity Phase B E2E: hit /chat/stream like the frontend and assert routes."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

API = "http://localhost:8100/api/v1"
API_KEY = "aipiloty-dev-key"


def login() -> str:
    req = urllib.request.Request(
        f"{API}/auth/login",
        data=json.dumps({"username": "admin", "password": "admin"}).encode(),
        headers={"Content-Type": "application/json", "X-API-Key": API_KEY},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode())["access_token"]


def stream_until_route(
    token: str,
    message: str,
    mode: str = "auto",
    session_key: str | None = None,
    auto_approve: bool = False,
    max_seconds: float = 25.0,
    continue_after_route: bool = False,
) -> dict:
    body = {
        "messages": [{"role": "user", "content": message}],
        "session_key": session_key,
        "auto_approve": auto_approve,
        "mode": mode,
    }
    req = urllib.request.Request(
        f"{API}/chat/stream",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "X-API-Key": API_KEY,
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    out: dict = {
        "message": message,
        "mode": mode,
        "route": None,
        "reply": "",
        "session": session_key,
        "events": [],
        "approval": None,
        "logs": [],
        "error": None,
    }
    t0 = time.time()
    for attempt in range(4):
      try:
        with urllib.request.urlopen(req, timeout=max_seconds + 5) as res:
            buf = ""
            while True:
                if time.time() - t0 > max_seconds:
                    break
                chunk = res.read(256)
                if not chunk:
                    break
                buf += chunk.decode("utf-8", errors="replace")
                while "\n\n" in buf:
                    part, buf = buf.split("\n\n", 1)
                    line = next((l for l in part.split("\n") if l.startswith("data: ")), None)
                    if not line:
                        continue
                    try:
                        ev = json.loads(line[6:])
                    except json.JSONDecodeError:
                        continue
                    et = ev.get("type")
                    data = ev.get("data") or {}
                    out["events"].append(et)
                    if et == "session":
                        out["session"] = data.get("session_key")
                    elif et == "route":
                        out["route"] = data
                        if not continue_after_route and data.get("route") == "agent_task":
                            return out
                    elif et == "token":
                        out["reply"] += data.get("token") or ""
                        if data.get("done") and out["route"] and out["route"].get("route") != "agent_task":
                            return out
                        if (
                            out["route"]
                            and out["route"].get("route") == "general_qa"
                            and len(out["reply"]) > 50
                        ):
                            return out
                    elif et == "approval_required":
                        out["approval"] = data
                        return out
                    elif et == "log":
                        msg = str(data.get("message") or "")
                        out["logs"].append(msg[:160])
                        if "progressive tools" in msg.lower() and out["route"]:
                            if not continue_after_route:
                                return out
                    elif et == "error":
                        out["error"] = data.get("message")
                        return out
            return out
      except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        if e.code == 429 and attempt < 3:
            time.sleep(20)
            t0 = time.time()
            continue
        out["error"] = f"HTTP Error {e.code}: {body[:120]}"
        return out
      except Exception as e:  # noqa: BLE001
        out["error"] = str(e)
        return out
    return out


def main() -> int:
    token = login()
    cases = [
        ("S1", "hello", "auto", "smalltalk"),
        ("S2", "Hi!!!", "auto", "smalltalk"),
        ("S3", "thanks", "ask", "smalltalk"),
        ("Q1", "who are you?", "auto", "general_qa"),
        ("Q2", "yes", "auto", "general_qa"),
        ("Q3", "no", "auto", "general_qa"),
        ("Q4", "ok", "auto", "general_qa"),
        ("Q5", "who are you?", "agent", "general_qa"),
        ("C1", "help", "auto", "clarify"),
        ("C2", "fix", "auto", "clarify"),
        ("C3", "stuff", "agent", "clarify"),
        ("A1", "deploy the frontend", "ask", "general_qa"),
        ("A2", "ssh into the server and check disk", "ask", "general_qa"),
        ("T1", "list my ollama models", "auto", "agent_task"),
        ("T2", "generate a pdf about taxes", "auto", "agent_task"),
        ("T3", "deploy the frontend", "agent", "agent_task"),
        ("T4", "ssh into the server and check disk", "auto", "agent_task"),
        ("T5", "check disk on the server", "agent", "agent_task"),
    ]

    rows = []
    for cid, msg, mode, expect in cases:
        r = stream_until_route(token, msg, mode=mode, max_seconds=20)
        got = (r.get("route") or {}).get("route")
        canned = bool(
            r.get("reply")
            and ("got it" in r["reply"].lower() or "let me know what you'd like" in r["reply"].lower())
        )
        ok = got == expect and not (canned and expect == "general_qa")
        rows.append(
            {
                "id": cid,
                "msg": msg,
                "mode": mode,
                "expect": expect,
                "got": got,
                "reason": (r.get("route") or {}).get("reason"),
                "pass": ok,
                "canned": canned,
                "reply": (r.get("reply") or "")[:120],
                "error": r.get("error"),
                "prog": next((l for l in r.get("logs") or [] if "progressive" in l.lower()), None),
            }
        )
        time.sleep(3.2)  # stay under expensive limit (20/min)

    # Progressive tools presence on agent path
    prog = stream_until_route(
        token, "generate a pdf about onboarding", mode="auto", max_seconds=15, continue_after_route=True
    )
    prog_log = next((l for l in prog.get("logs") or [] if "progressive" in l.lower()), None)

    # High-risk approval → CONFIRMATION yes/no
    risk = stream_until_route(
        token,
        "deploy the frontend to production now using the deploy tool",
        mode="agent",
        max_seconds=90,
        continue_after_route=True,
    )
    conf_yes = conf_no = None
    if risk.get("session"):
        # If approval fired, pending is set; if not, yes should be general_qa
        conf_yes = stream_until_route(token, "yes", mode="auto", session_key=risk["session"], max_seconds=20)
        risk2 = stream_until_route(
            token,
            "deploy the backend service with the deploy tool",
            mode="agent",
            max_seconds=90,
            continue_after_route=True,
        )
        if risk2.get("session"):
            conf_no = stream_until_route(
                token, "no", mode="auto", session_key=risk2["session"], max_seconds=20
            )

    passed = sum(1 for r in rows if r["pass"])
    report = {
        "summary": {"total": len(rows), "passed": passed, "failed": len(rows) - passed},
        "failed": [r for r in rows if not r["pass"]],
        "rows": rows,
        "progressive": {
            "route": (prog.get("route") or {}).get("route"),
            "log": prog_log,
            "logs": prog.get("logs"),
        },
        "risk": {
            "route": (risk.get("route") or {}).get("route"),
            "has_approval": bool(risk.get("approval")),
            "approval_tool": (risk.get("approval") or {}).get("tool"),
            "session": risk.get("session"),
            "error": risk.get("error"),
            "logs": (risk.get("logs") or [])[:5],
        },
        "confirm_yes": None
        if not conf_yes
        else {
            "route": (conf_yes.get("route") or {}).get("route"),
            "confirmation": (conf_yes.get("route") or {}).get("confirmation"),
            "reply": (conf_yes.get("reply") or "")[:160],
            "reason": (conf_yes.get("route") or {}).get("reason"),
        },
        "confirm_no": None
        if not conf_no
        else {
            "route": (conf_no.get("route") or {}).get("route"),
            "confirmation": (conf_no.get("route") or {}).get("confirmation"),
            "reply": (conf_no.get("reply") or "")[:160],
            "reason": (conf_no.get("route") or {}).get("reason"),
        },
    }
    print(json.dumps(report, indent=2))
    return 0 if passed == len(rows) else 1


if __name__ == "__main__":
    sys.exit(main())
