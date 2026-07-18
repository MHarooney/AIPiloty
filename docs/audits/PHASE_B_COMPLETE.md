# Phase B Complete — Professional Routing

**Date:** 2026-07-18  
**Scope:** AIPiloty chat routing (Ask / Agent / Auto + progressive tools)

## What shipped

| Item | Status |
|------|--------|
| Routes: `CONFIRMATION` + `CLARIFY` | Done |
| Session pending-action registry | Done (`pending_actions.py`) |
| UI Ask / Agent / Auto → backend `mode` | Done |
| Progressive tools (≤12 per domain) | Done (`tool_selector.py`) |
| Route / mode metrics counters | Done (`route_*`, `chat_mode_*`) |
| Unit tests | 33+ passing |

## Behavior

```
Ask   → GENERAL_QA (LLM, no tools) except greetings
Agent → prefer AGENT_TASK; questions still GENERAL_QA; vague → CLARIFY
Auto  → IntentClassifier (Phase A) + CONFIRMATION/CLARIFY

yes/no with pending approval → CONFIRMATION (never canned)
```

## Key files

- `backend/app/services/agent/message_router.py`
- `backend/app/services/agent/pending_actions.py`
- `backend/app/services/agent/tool_selector.py`
- `backend/app/services/agent/orchestrator.py`
- `backend/app/schemas/api.py` (`mode` on `ChatRequest`)
- `frontend/src/lib/api.ts` + chat input / store

## Verify

```bash
cd aipiloty/backend && .venv/bin/pytest tests/test_message_router.py -q
```

Toggle Ask / Agent / Auto in the UI and watch SSE `route` events.

## Next (paused)

Image generation / DALL·E wiring — return after this phase.
