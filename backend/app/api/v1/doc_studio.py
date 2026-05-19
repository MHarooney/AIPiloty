"""Doc Studio API routes.

Prefix: /api/v1/doc-studio
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.doc_studio import Notebook, NotebookArtifact, NotebookSource
from ...services.doc_studio.templates import DOC_TEMPLATES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/doc-studio", tags=["Doc Studio"])


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class NotebookCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)
    project_id: Optional[str] = None


class NotebookRename(BaseModel):
    name: str = Field(..., min_length=1, max_length=256)


class SourceToggle(BaseModel):
    is_enabled: bool


class AddUrlSourceBody(BaseModel):
    url: str = Field(..., min_length=8)
    title: Optional[str] = None


class AddProjectSourceBody(BaseModel):
    project_path: str
    title: Optional[str] = None


class StudioRunBody(BaseModel):
    template_id: str
    extra_context: str = ""
    model_override: Optional[str] = None


class ChatBody(BaseModel):
    message: str = Field(..., min_length=1)
    model_override: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _notebook_not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Notebook not found")


def _source_not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Source not found")


def _artifact_not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Artifact not found")


async def _get_notebook(notebook_id: str, db: AsyncSession) -> Notebook:
    result = await db.execute(select(Notebook).where(Notebook.id == notebook_id))
    nb = result.scalar_one_or_none()
    if not nb:
        raise _notebook_not_found()
    return nb


# ── Template catalogue ────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(_: str = Depends(require_auth)) -> dict[str, Any]:
    """Return all available Doc Studio document templates."""
    return {
        "templates": [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "icon": t.icon,
                "gradient": t.gradient,
                "sections": t.sections,
            }
            for t in DOC_TEMPLATES.values()
        ]
    }


# ── Notebook CRUD ─────────────────────────────────────────────────────────────

@router.get("/notebooks")
async def list_notebooks(
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await db.execute(select(Notebook).order_by(Notebook.created_at.desc()))
    notebooks = result.scalars().all()
    return {
        "notebooks": [
            {
                "id": nb.id,
                "name": nb.name,
                "project_id": nb.project_id,
                "created_at": nb.created_at.isoformat() if nb.created_at else None,
                "updated_at": nb.updated_at.isoformat() if nb.updated_at else None,
            }
            for nb in notebooks
        ]
    }


@router.post("/notebooks", status_code=201)
async def create_notebook(
    body: NotebookCreate,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    nb = Notebook(
        id=str(uuid.uuid4()),
        name=body.name,
        project_id=body.project_id,
    )
    db.add(nb)
    await db.commit()
    await db.refresh(nb)
    return {"id": nb.id, "name": nb.name, "project_id": nb.project_id}


@router.patch("/notebooks/{notebook_id}")
async def rename_notebook(
    notebook_id: str,
    body: NotebookRename,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    nb = await _get_notebook(notebook_id, db)
    nb.name = body.name
    await db.commit()
    return {"id": nb.id, "name": nb.name}


@router.delete("/notebooks/{notebook_id}", status_code=204, response_class=Response)
async def delete_notebook(
    notebook_id: str,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    nb = await _get_notebook(notebook_id, db)
    # Delete Qdrant chunks for this notebook
    from ...main import app_state
    ni = app_state.get("notebook_ingest")
    if ni:
        await ni.delete_notebook(notebook_id)
    await db.delete(nb)
    await db.commit()


# ── Sources CRUD ──────────────────────────────────────────────────────────────

@router.get("/notebooks/{notebook_id}/sources")
async def list_sources(
    notebook_id: str,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _get_notebook(notebook_id, db)
    result = await db.execute(
        select(NotebookSource)
        .where(NotebookSource.notebook_id == notebook_id)
        .order_by(NotebookSource.created_at.asc())
    )
    sources = result.scalars().all()
    return {
        "sources": [
            {
                "id": s.id,
                "kind": s.kind,
                "title": s.title,
                "is_enabled": s.is_enabled,
                "status": s.status,
                "meta": json.loads(s.meta_json) if s.meta_json else {},
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in sources
        ]
    }


@router.post("/notebooks/{notebook_id}/sources/upload", status_code=201)
async def upload_source(
    notebook_id: str,
    file: UploadFile = File(...),
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Upload a file (PDF, DOCX, TXT …) as a notebook source."""
    await _get_notebook(notebook_id, db)
    source_id = str(uuid.uuid4())
    source = NotebookSource(
        id=source_id,
        notebook_id=notebook_id,
        kind="upload",
        title=file.filename or source_id,
        status="indexing",
        meta_json=json.dumps({"filename": file.filename, "content_type": file.content_type}),
    )
    db.add(source)
    await db.commit()

    # Background ingest
    file_bytes = await file.read()
    from ...main import app_state
    ni = app_state.get("notebook_ingest")
    if ni:
        try:
            stats = await ni.ingest_file(
                notebook_id=notebook_id,
                source_id=source_id,
                file_bytes=file_bytes,
                filename=file.filename or source_id,
                mime_type=file.content_type,
            )
            source.status = "ready"
            meta = json.loads(source.meta_json) if source.meta_json else {}
            meta.update(stats)
            source.meta_json = json.dumps(meta)
        except Exception as exc:
            logger.error("Failed to ingest upload source %s: %s", source_id, exc)
            source.status = "error"
    else:
        source.status = "ready"  # no vector store configured — treat as ready

    await db.commit()
    await db.refresh(source)
    return {
        "id": source.id,
        "kind": source.kind,
        "title": source.title,
        "status": source.status,
    }


@router.post("/notebooks/{notebook_id}/sources/url", status_code=201)
async def add_url_source(
    notebook_id: str,
    body: AddUrlSourceBody,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Add a URL as a notebook source (fetched and indexed immediately)."""
    await _get_notebook(notebook_id, db)
    source_id = str(uuid.uuid4())
    source = NotebookSource(
        id=source_id,
        notebook_id=notebook_id,
        kind="url",
        title=body.title or body.url,
        status="indexing",
        meta_json=json.dumps({"url": body.url}),
    )
    db.add(source)
    await db.commit()

    from ...main import app_state
    ni = app_state.get("notebook_ingest")
    if ni:
        try:
            stats = await ni.ingest_url(
                notebook_id=notebook_id,
                source_id=source_id,
                url=body.url,
            )
            source.status = "ready"
            meta = json.loads(source.meta_json) if source.meta_json else {}
            meta.update(stats)
            source.meta_json = json.dumps(meta)
        except Exception as exc:
            logger.error("Failed to ingest URL source %s: %s", source_id, exc)
            source.status = "error"
    else:
        source.status = "ready"

    await db.commit()
    await db.refresh(source)
    return {
        "id": source.id,
        "kind": source.kind,
        "title": source.title,
        "status": source.status,
    }


@router.post("/notebooks/{notebook_id}/sources/project", status_code=201)
async def add_project_source(
    notebook_id: str,
    body: AddProjectSourceBody,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Ingest a project folder that is already on the server."""
    await _get_notebook(notebook_id, db)
    source_id = str(uuid.uuid4())
    source = NotebookSource(
        id=source_id,
        notebook_id=notebook_id,
        kind="project_ingest",
        title=body.title or body.project_path,
        status="indexing",
        meta_json=json.dumps({"project_path": body.project_path}),
    )
    db.add(source)
    await db.commit()

    from ...main import app_state
    ni = app_state.get("notebook_ingest")
    if ni:
        try:
            stats = await ni.ingest_project(
                notebook_id=notebook_id,
                source_id=source_id,
                project_path=body.project_path,
            )
            source.status = "ready"
            meta = json.loads(source.meta_json) if source.meta_json else {}
            meta.update(stats)
            source.meta_json = json.dumps(meta)
        except Exception as exc:
            logger.error("Failed to ingest project source %s: %s", source_id, exc)
            source.status = "error"
    else:
        source.status = "ready"

    await db.commit()
    await db.refresh(source)
    return {
        "id": source.id,
        "kind": source.kind,
        "title": source.title,
        "status": source.status,
    }


@router.patch("/notebooks/{notebook_id}/sources/{source_id}/toggle")
async def toggle_source(
    notebook_id: str,
    source_id: str,
    body: SourceToggle,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await db.execute(
        select(NotebookSource).where(
            NotebookSource.notebook_id == notebook_id,
            NotebookSource.id == source_id,
        )
    )
    source = result.scalar_one_or_none()
    if not source:
        raise _source_not_found()
    source.is_enabled = body.is_enabled
    await db.commit()
    return {"id": source.id, "is_enabled": source.is_enabled}


@router.delete("/notebooks/{notebook_id}/sources/{source_id}", status_code=204, response_class=Response)
async def delete_source(
    notebook_id: str,
    source_id: str,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NotebookSource).where(
            NotebookSource.notebook_id == notebook_id,
            NotebookSource.id == source_id,
        )
    )
    source = result.scalar_one_or_none()
    if not source:
        raise _source_not_found()

    from ...main import app_state
    ni = app_state.get("notebook_ingest")
    if ni:
        await ni.delete_source(source_id)

    await db.delete(source)
    await db.commit()


# ── Grounded Chat ─────────────────────────────────────────────────────────────

@router.post("/notebooks/{notebook_id}/chat")
async def notebook_chat_stream(
    notebook_id: str,
    body: ChatBody,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream a grounded Q&A response for this notebook."""
    await _get_notebook(notebook_id, db)

    async def _gen() -> Any:
        import json as _json
        from ...main import app_state

        retriever = app_state.get("retriever")
        llm = app_state.get("llm")

        if not retriever or not llm:
            yield f"data: {_json.dumps({'type': 'error', 'data': {'message': 'RAG services unavailable'}})}\n\n"
            return

        yield f"data: {_json.dumps({'type': 'status', 'data': {'phase': 'retrieving', 'message': 'Searching sources…'}})}\n\n"

        try:
            chunks = await retriever.search(
                query=body.message,
                top_k=8,
                min_score=0.15,
                mode="hybrid",
                notebook_id=notebook_id,
            )
        except Exception as exc:
            yield f"data: {_json.dumps({'type': 'error', 'data': {'message': str(exc)}})}\n\n"
            return

        context = "\n\n---\n\n".join(c.content for c in chunks[:8]) if chunks else ""
        source_refs = [c.source_path for c in chunks[:5] if c.source_path]

        system_prompt = (
            "You are a helpful assistant answering questions about a project. "
            "Answer using ONLY the context below.  If the answer is not in the context, say so.\n\n"
            f"Context:\n{context}"
        )
        messages: list[dict] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": body.message},
        ]

        if source_refs:
            yield f"data: {_json.dumps({'type': 'citations', 'data': {'sources': source_refs}})}\n\n"

        try:
            async for chunk_data in llm.chat_stream(messages, tools=None, model_override=body.model_override):
                token = chunk_data.get("message", {}).get("content", "")
                if token:
                    yield f"data: {_json.dumps({'type': 'token', 'data': {'content': token}})}\n\n"
                if chunk_data.get("done"):
                    break
        except Exception as exc:
            yield f"data: {_json.dumps({'type': 'error', 'data': {'message': str(exc)}})}\n\n"
            return

        yield f"data: {_json.dumps({'type': 'done', 'data': {}})}\n\n"

    return StreamingResponse(_gen(), media_type="text/event-stream")


# ── Studio Run ────────────────────────────────────────────────────────────────

@router.post("/notebooks/{notebook_id}/studio/run")
async def studio_run_stream(
    notebook_id: str,
    body: StudioRunBody,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    """Stream document generation for the given notebook and template."""
    await _get_notebook(notebook_id, db)

    if body.template_id not in DOC_TEMPLATES:
        raise HTTPException(status_code=422, detail=f"Unknown template '{body.template_id}'")

    # Validate enabled sources exist
    stmt = select(NotebookSource).where(
        NotebookSource.notebook_id == notebook_id,
        NotebookSource.is_enabled.is_(True),
        NotebookSource.status == "ready",
    )
    res = await db.execute(stmt)
    if not res.scalars().first():
        raise HTTPException(
            status_code=422,
            detail="No enabled, ready sources in this notebook. Add and index at least one source first.",
        )

    async def _gen() -> Any:
        from ...main import app_state
        studio: Any = app_state.get("studio_service")
        if not studio:
            import json as _j
            yield f"data: {_j.dumps({'type': 'error', 'data': {'message': 'Studio service unavailable'}})}\n\n"
            return

        # We need a fresh DB session inside the generator
        from ...core.database import async_session_factory
        async with async_session_factory() as gen_db:
            async for event in studio.run_studio_stream(
                notebook_id=notebook_id,
                template_id=body.template_id,
                extra_context=body.extra_context,
                db=gen_db,
                model_override=body.model_override,
            ):
                yield event

    return StreamingResponse(_gen(), media_type="text/event-stream")


# ── Artifact CRUD ─────────────────────────────────────────────────────────────

@router.get("/notebooks/{notebook_id}/artifacts")
async def list_artifacts(
    notebook_id: str,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    await _get_notebook(notebook_id, db)
    result = await db.execute(
        select(NotebookArtifact)
        .where(NotebookArtifact.notebook_id == notebook_id)
        .order_by(NotebookArtifact.created_at.desc())
    )
    artifacts = result.scalars().all()
    return {
        "artifacts": [
            {
                "id": a.id,
                "template": a.template,
                "title": a.title,
                "has_md": bool(a.content_md),
                "has_docx": bool(a.docx_path),
                "has_pdf": bool(a.pdf_path),
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "updated_at": a.updated_at.isoformat() if a.updated_at else None,
            }
            for a in artifacts
        ]
    }


@router.get("/notebooks/{notebook_id}/artifacts/{artifact_id}")
async def get_artifact(
    notebook_id: str,
    artifact_id: str,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    result = await db.execute(
        select(NotebookArtifact).where(
            NotebookArtifact.notebook_id == notebook_id,
            NotebookArtifact.id == artifact_id,
        )
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise _artifact_not_found()
    return {
        "id": artifact.id,
        "template": artifact.template,
        "title": artifact.title,
        "content_md": artifact.content_md,
        "has_docx": bool(artifact.docx_path),
        "has_pdf": bool(artifact.pdf_path),
        "created_at": artifact.created_at.isoformat() if artifact.created_at else None,
        "updated_at": artifact.updated_at.isoformat() if artifact.updated_at else None,
    }


@router.delete("/notebooks/{notebook_id}/artifacts/{artifact_id}", status_code=204, response_class=Response)
async def delete_artifact(
    notebook_id: str,
    artifact_id: str,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(NotebookArtifact).where(
            NotebookArtifact.notebook_id == notebook_id,
            NotebookArtifact.id == artifact_id,
        )
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise _artifact_not_found()
    await db.delete(artifact)
    await db.commit()


@router.get("/notebooks/{notebook_id}/artifacts/{artifact_id}/download/{format_}")
async def download_artifact(
    notebook_id: str,
    artifact_id: str,
    format_: str,
    _: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Download artifact as md, docx, or pdf.

    ``format_`` must be one of ``md``, ``docx``, ``pdf``.
    """
    if format_ not in {"md", "docx", "pdf"}:
        raise HTTPException(status_code=400, detail="format must be md, docx, or pdf")

    result = await db.execute(
        select(NotebookArtifact).where(
            NotebookArtifact.notebook_id == notebook_id,
            NotebookArtifact.id == artifact_id,
        )
    )
    artifact = result.scalar_one_or_none()
    if not artifact:
        raise _artifact_not_found()

    if format_ == "md":
        import tempfile, os
        tmp = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        )
        tmp.write(artifact.content_md or "")
        tmp.close()
        safe_title = artifact.title.replace(" ", "_")[:60]
        return FileResponse(
            path=tmp.name,
            media_type="text/markdown",
            filename=f"{safe_title}.md",
            background=None,
        )

    if format_ == "docx":
        if not artifact.docx_path or not Path(artifact.docx_path).exists():
            # Generate on-demand
            from ...main import app_state
            studio = app_state.get("studio_service")
            if not studio:
                raise HTTPException(status_code=503, detail="Document generator unavailable")
            try:
                import json as _j
                from ...services.doc_studio.studio_service import _markdown_to_sections
                sections_payload = _j.dumps(_markdown_to_sections(artifact.content_md or ""))
                docx_result = await studio._doc_generator.generate_docx(
                    title=artifact.title,
                    sections=sections_payload,
                    filename=f"ds_{artifact.id[:8]}_{artifact.template}.docx",
                )
                artifact.docx_path = docx_result.get("path", "")
                await db.commit()
            except Exception as exc:
                raise HTTPException(status_code=500, detail=f"DOCX generation failed: {exc}") from exc

        return FileResponse(
            path=artifact.docx_path,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            filename=Path(artifact.docx_path).name,
        )

    # format_ == "pdf"
    if not artifact.pdf_path or not Path(artifact.pdf_path).exists():
        from ...main import app_state
        studio = app_state.get("studio_service")
        if not studio:
            raise HTTPException(status_code=503, detail="Document generator unavailable")
        try:
            import json as _j
            from ...services.doc_studio.studio_service import _markdown_to_sections
            sections_payload = _j.dumps(_markdown_to_sections(artifact.content_md or ""))
            pdf_result = await studio._doc_generator.generate_pdf(
                title=artifact.title,
                sections=sections_payload,
                filename=f"ds_{artifact.id[:8]}_{artifact.template}.pdf",
            )
            artifact.pdf_path = pdf_result.get("path", "")
            await db.commit()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}") from exc

    return FileResponse(
        path=artifact.pdf_path,
        media_type="application/pdf",
        filename=Path(artifact.pdf_path).name,
    )
