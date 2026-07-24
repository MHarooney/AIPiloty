"""Chat API routes — streaming SSE + session CRUD."""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Any, Optional
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...core.metrics import metrics
from ...models.chat import ChatMessage, ChatSession
from ...schemas.api import ChatMessageOut, ChatRequest, ChatSessionOut
from ...services.agent.orchestrator import AgentOrchestrator

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/chat", tags=["Chat"])

# session_key → asyncio.Event; set to signal the active stream to stop.
_cancel_events: dict[str, asyncio.Event] = {}


def _safe_json_dict(raw: str | None) -> Optional[dict[str, Any]]:
    if not raw:
        return None
    try:
        out = json.loads(raw)
        return out if isinstance(out, dict) else None
    except json.JSONDecodeError:
        return None


def _safe_json_list(raw: str | None) -> Any:
    if not raw:
        return []
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Invalid JSON in chat message tool field; using empty list")
        return []


def _normalize_tool_calls_for_api(stored: Any) -> list[dict]:
    """SSE stores tool_start as {tool, arguments}; API schema expects {name, arguments}."""
    if not isinstance(stored, list):
        return []
    out: list[dict] = []
    for item in stored:
        if not isinstance(item, dict):
            continue
        name = item.get("name") or item.get("tool")
        if not name:
            continue
        args = item.get("arguments")
        if not isinstance(args, dict):
            args = {}
        out.append({"name": str(name), "arguments": args})
    return out


def _normalize_tool_results_for_api(stored: Any) -> list[dict[str, Any]]:
    if not isinstance(stored, list):
        return []
    out: list[dict[str, Any]] = []
    for item in stored:
        if isinstance(item, dict):
            out.append(item)
    return out


def _get_orchestrator():
    """Get the orchestrator from app state. Returns None if disabled."""
    from ...main import app_state
    return app_state.get("orchestrator")


@router.post("/stream")
async def chat_stream(
    req: ChatRequest,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """SSE streaming chat with agent tool calling."""
    orchestrator = _get_orchestrator()

    if orchestrator is None:
        _msg = json.dumps({"type": "error", "data": {"message": "LLM service is disabled. Enable Ollama in Settings \u2192 Services."}})
        async def _disabled():
            yield f"data: {_msg}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(
            _disabled(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # Get or create session
    session_key = req.session_key or uuid.uuid4().hex
    result = await db.execute(select(ChatSession).where(ChatSession.session_key == session_key))
    session = result.scalar_one_or_none()
    if not session:
        session = ChatSession(session_key=session_key, title=req.messages[0].content[:50] if req.messages else "New Chat")
        db.add(session)
        await db.flush()

    # Resolve attachments (if any)
    attachment_metas = []
    from ...main import app_state as _app_state
    storage = _app_state.get("attachment_storage")
    for msg in req.messages:
        if msg.attachment_ids and storage:
            attachment_metas.extend(storage.resolve_many(msg.attachment_ids))

    # Save user messages
    for msg in req.messages:
        att_json = None
        if msg.attachment_ids:
            att_json = json.dumps([{"id": a.id, "filename": a.filename, "mime_type": a.mime_type, "category": a.category} for a in attachment_metas if a.id in msg.attachment_ids])
        db.add(ChatMessage(session_id=session.id, role=msg.role, content=msg.content, attachments_json=att_json))
    await db.flush()

    # Build message history
    messages = [{"role": m.role, "content": m.content, "attachment_ids": m.attachment_ids} for m in req.messages]

    async def event_generator():
        # Send session key first
        yield f"data: {json.dumps({'type': 'session', 'data': {'session_key': session_key}})}\n\n"

        full_response = ""
        tool_calls_data = []
        tool_results_data = []
        final_report_data: Optional[dict[str, Any]] = None
        t0 = time.monotonic()
        errored = False

        # Register cancellation handle
        cancel_event = asyncio.Event()
        _cancel_events[session_key] = cancel_event

        try:
            # Model selection from desktop picker:
            # - auto / empty → ProviderRouter failover (do NOT force Ollama ModelRouter
            #   when a cloud provider is configured — that would send ollama ids to OR)
            # - provider:model → pinned provider + model hint
            model_override = req.model
            if model_override is not None and str(model_override).strip().lower() in (
                "",
                "auto",
            ):
                model_override = None

            if not model_override:
                try:
                    from ...main import app_state as _app_state

                    _router = _app_state.get("provider_router")
                    _has_cloud = bool(
                        _router
                        and any(a.name != "ollama" for a in getattr(_router, "chain", []))
                    )
                    if not _has_cloud:
                        _model_router = _app_state.get("model_router")
                        if _model_router is not None:
                            _last_msg = next(
                                (
                                    m.get("content", "")
                                    for m in reversed(messages)
                                    if m.get("role") == "user"
                                ),
                                "",
                            )
                            _decision = _model_router.route(str(_last_msg))
                            model_override = _decision.model
                            logger.debug(
                                "ModelRouter: %s → %s",
                                _decision.complexity,
                                _decision.model,
                            )
                except Exception:
                    pass  # graceful: fall back to no model override

            # Resolve active Mission (Flight Deck scope) — dynamic from DB
            mission_context = None
            if req.mission_id:
                try:
                    from ...models.deployment import Deployment
                    from ...services.mission.context import (
                        build_mission_prompt_block,
                        mission_to_flight_deck,
                    )
                    from sqlalchemy.orm import selectinload

                    mres = await db.execute(
                        select(Deployment)
                        .options(selectinload(Deployment.vm_credential))
                        .where(Deployment.id == int(req.mission_id))
                    )
                    mdep = mres.scalar_one_or_none()
                    if mdep:
                        mission_dto = mission_to_flight_deck(mdep, mdep.vm_credential)
                        mission_context = build_mission_prompt_block(mission_dto)
                        yield f"data: {json.dumps({'type': 'mission_context', 'data': mission_dto})}\n\n"
                except Exception as mexc:
                    logger.warning("Mission context load failed: %s", mexc)

            async for event in orchestrator.run(
                messages,
                auto_approve=req.auto_approve,
                model=model_override,
                session_key=session_key,
                mode=(req.mode or "auto"),
                mission_context=mission_context,
            ):
                # Check for client-requested cancellation before yielding each event
                if cancel_event.is_set():
                    yield f"data: {json.dumps({'type': 'cancelled', 'data': {'session_key': session_key}})}\n\n"
                    break

                yield event.to_sse()

                if event.event == "token" and isinstance(event.data, dict):
                    full_response += event.data.get("token", "")
                elif event.event in ("provider_switched", "provider_health"):
                    # ProviderRouter meta-events — pass through to renderer, don't persist
                    pass
                elif event.event == "tool_start":
                    tool_calls_data.append(event.data)
                    await metrics.increment("tool_calls")
                elif event.event == "tool_output":
                    tool_results_data.append(event.data)
                elif event.event == "final_report" and isinstance(event.data, dict):
                    final_report_data = event.data
        except Exception as exc:
            logger.error("Orchestrator stream error: %s", exc, exc_info=True)
            errored = True
            await metrics.increment("errors")
            yield f"data: {json.dumps({'type': 'error', 'data': {'message': 'An internal error occurred. Please try again.'}})}\n\n"
        finally:
            _cancel_events.pop(session_key, None)
            elapsed_ms = (time.monotonic() - t0) * 1000
            await metrics.record_timing("chat_response", elapsed_ms)
            await metrics.increment("chat_requests")

            # Always persist whatever we collected, even on partial failure
            if full_response or tool_calls_data:
                db.add(ChatMessage(
                    session_id=session.id,
                    role="assistant",
                    content=full_response or ("[error] Stream interrupted" if errored else ""),
                    tool_calls_json=json.dumps(tool_calls_data) if tool_calls_data else None,
                    tool_results_json=json.dumps(tool_results_data) if tool_results_data else None,
                    final_report_json=json.dumps(final_report_data) if final_report_data else None,
                ))
            try:
                await db.commit()
            except Exception as db_err:
                logger.error("DB commit failed after chat stream: %s", db_err)
                await db.rollback()

        yield f"data: {json.dumps({'type': 'done', 'data': {'session_key': session_key}})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/sessions", response_model=list[ChatSessionOut])
async def list_sessions(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ChatSession).order_by(ChatSession.updated_at.desc()))
    sessions = result.scalars().all()
    return [
        ChatSessionOut(
            session_key=s.session_key,
            title=s.title,
            created_at=s.created_at,
            updated_at=s.updated_at,
        )
        for s in sessions
    ]


@router.get("/sessions/{session_key}", response_model=ChatSessionOut)
async def get_session(
    session_key: str,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ChatSession).where(ChatSession.session_key == session_key))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")

    msg_result = await db.execute(
        select(ChatMessage).where(ChatMessage.session_id == session.id).order_by(ChatMessage.created_at)
    )
    msgs = msg_result.scalars().all()

    return ChatSessionOut(
        session_key=session.session_key,
        title=session.title,
        messages=[
            ChatMessageOut(
                role=m.role,
                content=m.content or "",
                tool_calls=_normalize_tool_calls_for_api(_safe_json_list(m.tool_calls_json)),
                tool_results=_normalize_tool_results_for_api(_safe_json_list(m.tool_results_json)),
                attachments=_safe_json_list(getattr(m, "attachments_json", None)),
                created_at=m.created_at,
                final_report=_safe_json_dict(getattr(m, "final_report_json", None)),
            )
            for m in msgs
        ],
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.post("/sessions/{session_key}/cancel", status_code=200)
async def cancel_session_stream(
    session_key: str,
    identity: str = Depends(require_auth),
):
    """Signal an active SSE stream for ``session_key`` to stop gracefully.

    The streaming event loop checks this flag between tool iterations and
    emits a ``cancelled`` SSE event before closing the connection. Returns
    404 if no active stream exists for the session.
    """
    event = _cancel_events.get(session_key)
    if event is None:
        raise HTTPException(404, "No active stream for this session")
    event.set()
    return {"status": "cancellation requested", "session_key": session_key}


@router.delete("/sessions/{session_key}")
async def delete_session(
    session_key: str,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(ChatSession).where(ChatSession.session_key == session_key))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(404, "Session not found")
    await db.delete(session)
    await db.commit()
    return {"status": "deleted"}
