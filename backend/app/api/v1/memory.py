"""Memory API — agent memory entries + episodic memory browser."""

from __future__ import annotations

from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...core.auth import require_auth
from ...main import app_state

router = APIRouter(prefix="/memory", tags=["Memory"])


# ── Helpers ───────────────────────────────────────────────────────────────

def _get_agent_memory():
    mem = app_state.get("agent_memory")
    if mem is None:
        raise HTTPException(503, "Agent memory not initialised")
    return mem


def _get_episodic():
    store = app_state.get("episodic_store")
    if store is None:
        raise HTTPException(503, "Episodic store not initialised")
    return store


# ── Schemas ───────────────────────────────────────────────────────────────

class MemoryEntryOut(BaseModel):
    key: str
    value: Any
    category: str
    importance: float
    created_at: str
    access_count: int
    last_accessed: Optional[str]


class MemoryEntryCreate(BaseModel):
    key: str
    value: str
    category: str = "general"
    importance: float = 0.5


class EpisodeOut(BaseModel):
    id: str
    summary: str
    category: str
    session_id: str
    importance: float
    created_at: str
    score: float = 0.0


# ── Agent Memory Endpoints ────────────────────────────────────────────────

@router.get("/entries", response_model=List[MemoryEntryOut])
async def list_memory_entries(
    category: Optional[str] = Query(None, description="Filter by category"),
    limit: int = Query(100, ge=1, le=500),
    identity: str = Depends(require_auth),
):
    """List all agent memory entries (flat JSON store)."""
    mem = _get_agent_memory()
    entries = list(mem._entries.values())
    if category:
        entries = [e for e in entries if e.category == category]
    entries.sort(key=lambda e: e.importance, reverse=True)
    entries = entries[:limit]
    return [MemoryEntryOut(**e.to_dict()) for e in entries]


@router.post("/entries", response_model=MemoryEntryOut, status_code=201)
async def create_memory_entry(
    body: MemoryEntryCreate,
    identity: str = Depends(require_auth),
):
    """Manually add a memory entry."""
    mem = _get_agent_memory()
    entry = await mem.remember(
        body.key, body.value, category=body.category, importance=body.importance
    )
    return MemoryEntryOut(**entry.to_dict())


@router.delete("/entries/{key}", status_code=204)
async def delete_memory_entry(
    key: str,
    identity: str = Depends(require_auth),
):
    """Delete a specific memory entry by key."""
    mem = _get_agent_memory()
    deleted = await mem.forget(key)
    if not deleted:
        raise HTTPException(404, f"Memory key '{key}' not found")


@router.delete("/entries", status_code=204)
async def clear_memory_entries(
    category: Optional[str] = Query(None),
    identity: str = Depends(require_auth),
):
    """Clear all memory entries, or only those in a specific category."""
    mem = _get_agent_memory()
    await mem.clear(category=category)


@router.get("/stats")
async def memory_stats(identity: str = Depends(require_auth)):
    """Return memory statistics."""
    mem = _get_agent_memory()
    episodic = _get_episodic()
    ep_count = await episodic.count()
    return {
        "agent_memory": {
            "total_entries": mem.size,
            "categories": mem.list_categories(),
        },
        "episodic_memory": {
            "total_episodes": ep_count,
            "available": episodic.is_available,
            "collection": episodic._collection,
        },
    }


# ── Episodic Memory Endpoints ─────────────────────────────────────────────

@router.get("/episodic", response_model=List[EpisodeOut])
async def list_episodes(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    category: Optional[str] = Query(None),
    identity: str = Depends(require_auth),
):
    """List recent episodic memories (newest first)."""
    episodic = _get_episodic()
    episodes = await episodic.list_episodes(limit=limit, offset=offset, category=category)
    return [EpisodeOut(**e.__dict__) for e in episodes]


@router.get("/episodic/search", response_model=List[EpisodeOut])
async def search_episodes(
    q: str = Query(..., min_length=2, description="Semantic search query"),
    top_k: int = Query(5, ge=1, le=20),
    category: Optional[str] = Query(None),
    identity: str = Depends(require_auth),
):
    """Semantic search over episodic memories."""
    episodic = _get_episodic()
    episodes = await episodic.recall(query=q, top_k=top_k, category=category)
    return [EpisodeOut(**e.__dict__) for e in episodes]


@router.delete("/episodic/{episode_id}", status_code=204)
async def delete_episode(
    episode_id: str,
    identity: str = Depends(require_auth),
):
    """Forget (delete) a specific episode."""
    episodic = _get_episodic()
    deleted = await episodic.forget(episode_id)
    if not deleted:
        raise HTTPException(404, f"Episode '{episode_id}' not found or could not be deleted")
