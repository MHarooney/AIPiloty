"""RAG API routes — ingest, search, stats, health."""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...core.auth import require_auth
from ...main import app_state

router = APIRouter(prefix="/rag", tags=["RAG"])


# ── Request / Response schemas ───────────────────────────────────


class IngestRequest(BaseModel):
    paths: List[str]
    force: bool = False


class IngestResponse(BaseModel):
    files_processed: int
    chunks_created: int
    skipped_unchanged: int = 0
    errors: List[str]


class DeleteSourceRequest(BaseModel):
    source_path: str


# ── Helpers ───────────────────────────────────────────────────────


def _get_ingest():
    svc = app_state.get("ingest_service")
    if svc is None:
        raise HTTPException(503, "RAG ingest service not initialised (Qdrant may be unavailable)")
    return svc


def _get_store():
    store = app_state.get("qdrant_store")
    if store is None:
        raise HTTPException(503, "Qdrant store not initialised")
    return store


def _get_retriever():
    ret = app_state.get("retriever")
    if ret is None:
        raise HTTPException(503, "Retriever not initialised")
    return ret


# ── Endpoints ─────────────────────────────────────────────────────


@router.post("/ingest", response_model=IngestResponse)
async def ingest_documents(
    body: IngestRequest,
    identity: str = Depends(require_auth),
):
    """Ingest files from allowlisted paths into the knowledge base."""
    svc = _get_ingest()
    try:
        result = await svc.ingest(body.paths, force=body.force)
    except PermissionError as e:
        raise HTTPException(403, str(e))
    return IngestResponse(**result)


@router.get("/stats")
async def rag_stats(identity: str = Depends(require_auth)):
    """Return Qdrant collection statistics."""
    store = _get_store()
    return await store.get_stats()


@router.get("/health")
async def rag_health(identity: str = Depends(require_auth)):
    """Health check for Qdrant + embedding model."""
    from ...services.rag.embeddings import EmbeddingService

    store = _get_store()
    embeddings: Optional[EmbeddingService] = app_state.get("embedding_service")

    qdrant_ok = await store.is_available()
    embed_ok = await embeddings.is_available() if embeddings else False

    stats = await store.get_stats() if qdrant_ok else {}

    return {
        "qdrant": "ok" if qdrant_ok else "unavailable",
        "embedding_model": "ok" if embed_ok else "unavailable",
        "doc_count": stats.get("points_count", 0) if qdrant_ok else 0,
        "collection": stats.get("collection", ""),
    }


@router.get("/search")
async def rag_search(
    q: str = Query(..., min_length=1, description="Search query"),
    mode: str = Query("hybrid", description="Search mode: hybrid, semantic, keyword"),
    top_k: int = Query(5, ge=1, le=50),
    identity: str = Depends(require_auth),
):
    """Search the local RAG knowledge base."""
    retriever = _get_retriever()
    if mode not in ("hybrid", "semantic", "keyword"):
        mode = "hybrid"
    results = await retriever.search(query=q, top_k=top_k, mode=mode)
    return {
        "mode": mode,
        "count": len(results),
        "results": [
            {
                "content": r.content,
                "source_path": r.source_path,
                "heading": r.heading,
                "score": r.score,
            }
            for r in results
        ],
    }


@router.delete("/source")
async def delete_source(
    body: DeleteSourceRequest,
    identity: str = Depends(require_auth),
):
    """Delete all indexed chunks for a given source path."""
    store = _get_store()
    await store.delete_by_source(body.source_path)
    return {"deleted": True, "source_path": body.source_path}


# ── Phase 4: Graph RAG endpoints ─────────────────────────────────────────

def _get_graph_store():
    gs = app_state.get("graph_store")
    if gs is None:
        raise HTTPException(503, "Graph store not initialised (Phase 4 disabled?)")
    return gs


@router.get("/graph/stats")
async def graph_stats(identity: str = Depends(require_auth)):
    """Return knowledge graph statistics."""
    gs = _get_graph_store()
    return await gs.get_stats()


@router.get("/graph/entities")
async def graph_entities(
    limit: int = Query(50, ge=1, le=200),
    entity_type: Optional[str] = Query(None),
    identity: str = Depends(require_auth),
):
    """Return top entities from the knowledge graph (for KG explorer UI)."""
    gs = _get_graph_store()
    return {"entities": await gs.get_top_entities(limit=limit, entity_type=entity_type)}


@router.get("/graph/entities/{node_id}/neighbors")
async def graph_neighbors(
    node_id: str,
    limit: int = Query(20, ge=1, le=50),
    identity: str = Depends(require_auth),
):
    """Return neighbours of a specific entity node."""
    gs = _get_graph_store()
    return {"neighbors": await gs.get_entity_neighbors(node_id, limit=limit)}

