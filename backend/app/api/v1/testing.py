"""Testing API routes — chat stream + run CRUD.

Prefix: /api/v1/testing
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.testing import TestingTarget, TestResult, TestRun
from ...models.chat import ChatSession, ChatMessage

logger = logging.getLogger(__name__)

# ── Test report builder helpers ───────────────────────────────────────────────

_TOOL_CAPTION_MAP: dict[str, str] = {
    "browser_navigate":     "Navigate to page",
    "browser_screenshot":   "Capture screenshot",
    "browser_fill_form":    "Fill form field",
    "browser_click":        "Click element",
    "browser_evaluate":     "Execute JavaScript",
    "discover_platform":    "Discover platform",
    "probe_target":         "Probe target URL",
    "run_api_tests":        "Run API test suite",
    "analyze_test_results": "Analyse test results",
    "local_pytest":         "Run local test suite",
    "generate_test_code":   "Generate test code",
}


def _step_caption(tool_name: str, args: dict[str, Any]) -> str:
    base = _TOOL_CAPTION_MAP.get(tool_name, tool_name.replace("_", " ").title())
    url = args.get("url", "")
    sel = args.get("selector", "")
    if tool_name == "browser_navigate" and url:
        return f"Navigate → {url}"
    if tool_name == "browser_click" and sel:
        return f"Click '{sel}'"
    if tool_name == "browser_fill_form" and sel:
        return f"Fill '{sel}'"
    if tool_name in ("discover_platform", "probe_target") and url:
        return f"{base} — {url}"
    return base


def _step_note(tool_name: str, result_data: Any) -> str:
    if not isinstance(result_data, dict):
        return ""
    if tool_name == "discover_platform":
        endpoints = result_data.get("api_endpoints_detected", [])
        logged_in = result_data.get("logged_in", False)
        nav_count = len(result_data.get("nav_links", []))
        parts: list[str] = []
        parts.append("Login verified" if logged_in else "Login check inconclusive (may be SPA)")
        if endpoints:
            parts.append(f"{len(endpoints)} API endpoints detected")
        if nav_count:
            parts.append(f"{nav_count} nav links found")
        return " · ".join(parts)
    if tool_name == "browser_click":
        new_url = result_data.get("new_url", "")
        success = result_data.get("success", result_data.get("clicked", False))
        parts = ["Clicked" if success else "Click failed"]
        if new_url:
            parts.append(f"→ {new_url}")
        return " ".join(parts)
    if tool_name == "browser_navigate":
        title = result_data.get("title", "")
        return title if title else result_data.get("url", "")
    if tool_name == "browser_fill_form":
        return result_data.get("message", "") or "Form field filled"
    if tool_name == "probe_target":
        reachable = result_data.get("reachable", False)
        note = result_data.get("note", "")
        label = "Reachable" if reachable else "Unreachable"
        return f"{label} — {note}" if note else label
    if tool_name == "run_api_tests":
        passed = result_data.get("passed", 0)
        failed = result_data.get("failed", 0)
        return f"{passed} passed, {failed} failed"
    return ""


def _generate_suggestions(
    steps: list[dict[str, Any]],
    discovered_endpoints: list[str],
    _full_response: str,
) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []

    failed_steps = [s for s in steps if not s.get("success")]
    if failed_steps:
        for fs in failed_steps[:3]:
            suggestions.append({
                "severity": "error",
                "title": f"Failed: {fs['caption']}",
                "detail": fs.get("note", "This step did not complete successfully."),
                "action": "Review the selector or URL. Use the browser inspector to verify element availability.",
            })

    login_steps = [s for s in steps if s.get("tool") == "discover_platform"]
    for ls in login_steps:
        if "inconclusive" in ls.get("note", "").lower():
            suggestions.append({
                "severity": "warning",
                "title": "SPA Login Detection",
                "detail": (
                    "Login success was inconclusive. SPAs often don't change the URL after login, "
                    "causing false negatives. Check if subsequent API requests were authenticated."
                ),
                "action": "Navigate directly to a protected route (e.g. /dashboard) to confirm login state.",
            })

    ep_count = len(discovered_endpoints)
    if ep_count >= 10:
        suggestions.append({
            "severity": "success",
            "title": f"Strong Coverage — {ep_count} Endpoints Detected",
            "detail": "The platform discovery captured significant API traffic. You have a solid baseline.",
            "action": "Run authorisation tests: verify each endpoint rejects unauthenticated requests.",
        })
    elif 0 < ep_count < 10:
        suggestions.append({
            "severity": "info",
            "title": f"Limited Coverage — {ep_count} Endpoints",
            "detail": "More user flows need to be exercised to discover additional endpoints.",
            "action": "Try: 'run a deep smoke test covering the full course enrollment flow'.",
        })

    if len(steps) < 3:
        suggestions.append({
            "severity": "info",
            "title": "Increase Test Depth",
            "detail": "Only a few test steps ran. Shallow tests miss edge cases and permission boundaries.",
            "action": "Ask: 'run a comprehensive smoke test covering login, browse, enroll, and logout'.",
        })

    if discovered_endpoints:
        suggestions.append({
            "severity": "info",
            "title": "Security Checks Recommended",
            "detail": "API endpoints were found. Verify CORS policy, rate limits, and auth enforcement.",
            "action": "Ask: 'test unauthenticated access on all discovered API endpoints'.",
        })

    return suggestions


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/testing", tags=["Testing"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class TestingContext(BaseModel):
    url: str = Field(default="", description="Base URL of the API under test (optional — agent can extract from chat).")
    auth_header: Optional[str] = Field(None, description="Authorization header value — never stored.")
    env_label: str = Field("", description="Human label for the environment (staging, prod, etc.).")
    username: Optional[str] = Field(None, description="Login username for browser tools — never stored.")
    password: Optional[str] = Field(None, description="Login password for browser tools — never stored.")


class TestingChatRequest(BaseModel):
    messages: list[dict[str, Any]]
    testing_context: TestingContext = Field(default_factory=TestingContext)
    session_key: Optional[str] = None
    auto_approve: bool = False
    model: Optional[str] = None


class TestingTargetCreate(BaseModel):
    name: str
    url: str
    env_label: str = ""


class TestingTargetOut(BaseModel):
    id: int
    name: str
    url: str
    env_label: str
    created_at: datetime


class TestRunOut(BaseModel):
    id: int
    target_id: Optional[int]
    status: str
    pass_count: int
    fail_count: int
    skip_count: int
    output_json: Optional[str]
    started_at: Optional[datetime]
    finished_at: Optional[datetime]
    created_at: datetime


# ── Helper ────────────────────────────────────────────────────────────────────

def _get_testing_orchestrator():
    from ...main import app_state
    orch = app_state.get("testing_orchestrator")
    if orch is None:
        raise HTTPException(status_code=503, detail="Testing orchestrator not initialised.")
    return orch


# ── Chat stream endpoint ──────────────────────────────────────────────────────

@router.post("/chat/stream")
async def testing_chat_stream(
    req: TestingChatRequest,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """SSE streaming chat for the testing agent.

    The testing_context.auth_header is injected ephemerally into the agent's
    system prompt and is NEVER written to the database.
    """
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages must not be empty.")

    orchestrator = _get_testing_orchestrator()

    session_key = req.session_key or uuid.uuid4().hex
    result = await db.execute(select(ChatSession).where(ChatSession.session_key == session_key))
    session = result.scalar_one_or_none()
    if not session:
        first_content = req.messages[0].get("content", "Testing session") if req.messages else "Testing session"
        session = ChatSession(session_key=session_key, title=first_content[:50])
        db.add(session)
        await db.flush()

    # Save user messages — context stripped of auth before persisting
    for msg in req.messages:
        db.add(
            ChatMessage(
                session_id=session.id,
                role=msg.get("role", "user"),
                content=msg.get("content", ""),
            )
        )
    await db.commit()

    messages = [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in req.messages]

    async def event_generator():
        yield f"data: {json.dumps({'type': 'session', 'data': {'session_key': session_key}})}\n\n"

        full_response = ""
        tool_calls_data: list[dict] = []
        tool_results_data: list[dict] = []
        screenshot_captions: list[dict] = []   # {caption, url, step}
        emitted_done = False
        started_at = datetime.now(timezone.utc)

        try:
            async for event in orchestrator.run_testing(
                messages,
                testing_context=req.testing_context.model_dump(),
                auto_approve=req.auto_approve,
                model=req.model,
            ):
                sse_line = event.to_sse()
                yield sse_line

                if event.event == "token" and isinstance(event.data, dict):
                    full_response += event.data.get("token", "")
                elif event.event == "tool_start":
                    tool_calls_data.append(event.data)
                elif event.event == "tool_end":
                    tool_results_data.append(event.data)
                elif event.event == "screenshot" and isinstance(event.data, dict):
                    screenshot_captions.append({
                        "caption": event.data.get("caption", ""),
                        "url": event.data.get("url", ""),
                        "step": event.data.get("step", len(screenshot_captions) + 1),
                    })
                elif event.event in ("done", "error"):
                    emitted_done = True

        except Exception as exc:
            logger.exception("Testing stream error: %s", exc)
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': str(exc)}})}\n\n"
            emitted_done = True
        finally:
            # Guarantee a done event so the frontend always exits streaming state
            if not emitted_done:
                yield f"data: {json.dumps({'type': 'done', 'data': {}})}\n\n"

            finished_at = datetime.now(timezone.utc)

            # Persist assistant response (no auth_header)
            if full_response.strip():
                try:
                    db.add(
                        ChatMessage(
                            session_id=session.id,
                            role="assistant",
                            content=full_response,
                            tool_calls_json=json.dumps(tool_calls_data) if tool_calls_data else None,
                            tool_results_json=json.dumps(tool_results_data) if tool_results_data else None,
                        )
                    )
                    await db.commit()
                except Exception:
                    logger.exception("Failed to persist assistant message")

            # Auto-create TestRun record from session data
            try:
                # Build structured steps by zipping tool calls with their results
                steps: list[dict[str, Any]] = []
                pass_count = 0
                fail_count = 0
                discovered_endpoints: list[str] = []
                discovered_pages: list[str] = []

                for tc in tool_calls_data:
                    tool_name = tc.get("tool", "unknown")
                    args = tc.get("arguments", {})
                    # Find matching result by tool name (best-effort)
                    tr = next(
                        (r for r in tool_results_data if r.get("tool") == tool_name and r not in [s.get("_tr") for s in steps]),
                        None,
                    )
                    success = bool(tr.get("success", True)) if tr else True
                    result_str = tr.get("result", "") if tr else ""
                    result_data: Any = {}
                    try:
                        result_data = json.loads(result_str) if isinstance(result_str, str) else result_str
                    except Exception:
                        result_data = {}

                    if success:
                        pass_count += 1
                    else:
                        fail_count += 1

                    # Extract discovered assets
                    if tool_name == "discover_platform" and isinstance(result_data, dict):
                        discovered_endpoints.extend(result_data.get("api_endpoints_detected", []))
                        nav_links = result_data.get("nav_links", [])
                        discovered_pages.extend(nav_links[:10])
                    if tool_name in ("browser_navigate", "browser_click") and isinstance(result_data, dict):
                        new_url = result_data.get("new_url") or result_data.get("url", "")
                        if new_url:
                            discovered_pages.append(new_url)

                    steps.append({
                        "step": len(steps) + 1,
                        "tool": tool_name,
                        "success": success,
                        "caption": _step_caption(tool_name, args),
                        "note": _step_note(tool_name, result_data),
                    })

                # Deduplicate
                discovered_endpoints = list(dict.fromkeys(discovered_endpoints))[:25]
                discovered_pages = list(dict.fromkeys(discovered_pages))[:15]

                suggestions = _generate_suggestions(steps, discovered_endpoints, full_response)

                report = {
                    "url": req.testing_context.url or "",
                    "env_label": req.testing_context.env_label or "",
                    "session_key": session_key,
                    "steps": steps,
                    "discovered_endpoints": discovered_endpoints,
                    "discovered_pages": discovered_pages,
                    "screenshots_taken": len(screenshot_captions),
                    "screenshot_captions": screenshot_captions,
                    "final_summary": full_response[-1200:].strip() if full_response else "",
                    "suggestions": suggestions,
                    "generated_at": finished_at.isoformat(),
                }

                # Get or create a testing target for this URL
                target_url = req.testing_context.url or "unknown"
                existing = await db.execute(
                    select(TestingTarget).where(TestingTarget.url == target_url).limit(1)
                )
                target = existing.scalar_one_or_none()
                if not target:
                    target = TestingTarget(
                        name=target_url[:128],
                        url=target_url,
                        env_label=req.testing_context.env_label or "",
                    )
                    db.add(target)
                    await db.flush()

                run_status = (
                    "passed" if fail_count == 0 and pass_count > 0
                    else "failed" if fail_count > 0
                    else "pending"
                )
                test_run = TestRun(
                    target_id=target.id,
                    status=run_status,
                    pass_count=pass_count,
                    fail_count=fail_count,
                    skip_count=0,
                    output_json=json.dumps(report),
                    started_at=started_at,
                    finished_at=finished_at,
                )
                db.add(test_run)
                await db.commit()
                logger.info("TestRun #%s created: %s pass, %s fail", test_run.id, pass_count, fail_count)

            except Exception:
                logger.exception("Failed to persist TestRun")

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Testing targets ───────────────────────────────────────────────────────────

@router.get("/targets", response_model=list[TestingTargetOut])
async def list_targets(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TestingTarget).order_by(TestingTarget.created_at.desc()))
    return [
        TestingTargetOut(
            id=t.id,
            name=t.name,
            url=t.url,
            env_label=t.env_label,
            created_at=t.created_at,
        )
        for t in result.scalars().all()
    ]


@router.post("/targets", response_model=TestingTargetOut, status_code=201)
async def create_target(
    payload: TestingTargetCreate,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    target = TestingTarget(name=payload.name, url=payload.url, env_label=payload.env_label)
    db.add(target)
    await db.commit()
    await db.refresh(target)
    return TestingTargetOut(
        id=target.id,
        name=target.name,
        url=target.url,
        env_label=target.env_label,
        created_at=target.created_at,
    )


@router.delete("/targets/{target_id}", status_code=204)
async def delete_target(
    target_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TestingTarget).where(TestingTarget.id == target_id))
    target = result.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found.")
    await db.delete(target)
    await db.commit()


# ── Test runs ────────────────────────────────────────────────────────────────

@router.get("/runs", response_model=list[TestRunOut])
async def list_runs(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TestRun).order_by(TestRun.created_at.desc()))
    runs = result.scalars().all()
    return [
        TestRunOut(
            id=r.id,
            target_id=r.target_id,
            status=r.status,
            pass_count=r.pass_count,
            fail_count=r.fail_count,
            skip_count=r.skip_count,
            output_json=r.output_json,
            started_at=r.started_at,
            finished_at=r.finished_at,
            created_at=r.created_at,
        )
        for r in runs
    ]


@router.get("/runs/{run_id}", response_model=TestRunOut)
async def get_run(
    run_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TestRun).where(TestRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Test run not found.")
    return TestRunOut(
        id=run.id,
        target_id=run.target_id,
        status=run.status,
        pass_count=run.pass_count,
        fail_count=run.fail_count,
        skip_count=run.skip_count,
        output_json=run.output_json,
        started_at=run.started_at,
        finished_at=run.finished_at,
        created_at=run.created_at,
    )
