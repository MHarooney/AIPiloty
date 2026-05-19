"""Knowledge base API routes — proxied to DeployPilot KB service."""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File

from ...core.auth import require_auth
from ...services.knowledge.kb_bridge import KBBridgeService

router = APIRouter(prefix="/knowledge", tags=["Knowledge"])

_bridge = KBBridgeService()


def _check_available(result: dict) -> dict:
    """Raise 503 if KB bridge returned an error."""
    if "error" in result:
        raise HTTPException(503, f"Knowledge base unavailable: {result['error']}")
    return result


@router.get("/health")
async def kb_health(identity: str = Depends(require_auth)):
    return await _bridge.health_check()


@router.get("/stats")
async def kb_stats(identity: str = Depends(require_auth)):
    result = await _bridge.get_stats()
    return _check_available(result)


@router.get("/search")
async def kb_search(
    query: str = Query(..., min_length=1),
    mode: str = Query("hybrid"),
    limit: int = Query(10, ge=1, le=100),
    identity: str = Depends(require_auth),
):
    result = await _bridge.search(query, mode, limit)
    return _check_available(result)


@router.get("/")
async def list_documents(
    source_type: Optional[str] = None,
    tags: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    identity: str = Depends(require_auth),
):
    result = await _bridge.list_documents(source_type, tags, limit, offset)
    return _check_available(result)


@router.get("/{doc_id}")
async def get_document(
    doc_id: int,
    identity: str = Depends(require_auth),
):
    result = await _bridge.get_document(doc_id)
    return _check_available(result)


@router.post("/")
async def ingest_document(
    data: dict,
    identity: str = Depends(require_auth),
):
    title = data.get("title", "")
    content = data.get("content", "")
    source_type = data.get("source_type", "manual")
    tags = data.get("tags")
    if not title or not content:
        raise HTTPException(400, "title and content are required")
    result = await _bridge.ingest(title, content, source_type, tags)
    return _check_available(result)


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    identity: str = Depends(require_auth),
):
    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(413, "File too large (max 10MB)")
    result = await _bridge.ingest_file(contents, file.filename or "upload")
    return _check_available(result)


@router.delete("/{doc_id}")
async def delete_document(
    doc_id: int,
    identity: str = Depends(require_auth),
):
    result = await _bridge.delete_document(doc_id)
    return _check_available(result)
