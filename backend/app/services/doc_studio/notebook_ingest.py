"""NotebookIngestService — ingest files, URLs, and project folders into a
notebook-scoped Qdrant namespace.

Each chunk is tagged with ``notebook_id`` and ``source_id`` in its Qdrant
payload, so retrieval can be restricted to a single notebook without
polluting the global knowledge base.
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import tempfile
import uuid
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from ..attachments.extractors import extract_text
from ..rag import EmbeddingService, QdrantStore, TextChunker
from ..rag.ingest import IngestService
from qdrant_client import models as qmodels

logger = logging.getLogger(__name__)

_UPLOAD_BASE = "uploads/doc-studio"

# Plain-text MIME types we can ingest directly without a document extractor
_TEXT_MIMES = {
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "text/html",
    "application/json",
    "application/x-yaml",
    "text/yaml",
}


def _mime_from_filename(filename: str) -> str:
    mime, _ = mimetypes.guess_type(filename)
    return mime or "application/octet-stream"


class NotebookIngestService:
    """Ingest content into a notebook-scoped Qdrant namespace."""

    def __init__(
        self,
        store: QdrantStore,
        embeddings: EmbeddingService,
        chunker: TextChunker,
        ingest_service: IngestService,
        workspace_root: str,
    ) -> None:
        self._store = store
        self._embeddings = embeddings
        self._chunker = chunker
        self._ingest_service = ingest_service
        self._workspace_root = Path(workspace_root).resolve()

    # ── Private helpers ───────────────────────────────────────────────────────

    def _nb_filter(self, notebook_id: str) -> qmodels.Filter:
        return qmodels.Filter(
            must=[
                qmodels.FieldCondition(
                    key="notebook_id",
                    match=qmodels.MatchValue(value=notebook_id),
                )
            ]
        )

    def _source_filter(self, source_id: str) -> qmodels.Filter:
        return qmodels.Filter(
            must=[
                qmodels.FieldCondition(
                    key="source_id",
                    match=qmodels.MatchValue(value=source_id),
                )
            ]
        )

    async def _chunk_embed_upsert(
        self,
        text: str,
        source_label: str,
        notebook_id: str,
        source_id: str,
    ) -> int:
        """Chunk, embed, and upsert text into Qdrant. Returns chunk count."""
        chunks = self._chunker.chunk_file(source_label, text)
        if not chunks:
            return 0
        texts = [c.content for c in chunks]
        vectors = await self._embeddings.embed_batch(texts)
        content_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
        payloads: list[dict[str, Any]] = [
            {
                "content": c.content,
                "source_path": source_label,
                "chunk_index": c.chunk_index,
                "heading": c.heading,
                "content_hash": content_hash,
                "notebook_id": notebook_id,
                "source_id": source_id,
            }
            for c in chunks
        ]
        await self._store.ensure_collection()
        return await self._store.upsert_chunks(vectors, payloads)

    # ── Public API ────────────────────────────────────────────────────────────

    async def ingest_file(
        self,
        notebook_id: str,
        source_id: str,
        file_bytes: bytes,
        filename: str,
        mime_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Ingest an uploaded file into the notebook's Qdrant namespace.

        Supports PDF, DOCX, XLSX, PPTX (via extractor) and plain-text variants.
        Returns ``{"chunks": n, "char_count": m, "source_label": ...}``.
        """
        if not mime_type:
            mime_type = _mime_from_filename(filename)

        text: Optional[str] = None

        if mime_type in _TEXT_MIMES or mime_type.startswith("text/"):
            text = file_bytes.decode("utf-8", errors="replace")
        else:
            # Save to a temp file so extractor can open it
            suffix = Path(filename).suffix or ".bin"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(file_bytes)
                tmp_path = Path(tmp.name)
            try:
                text = await extract_text(tmp_path, mime_type)
            finally:
                tmp_path.unlink(missing_ok=True)

        if not text or not text.strip():
            return {"chunks": 0, "char_count": 0, "source_label": filename}

        chunks = await self._chunk_embed_upsert(text, filename, notebook_id, source_id)
        return {
            "chunks": chunks,
            "char_count": len(text),
            "source_label": filename,
        }

    async def ingest_url(
        self,
        notebook_id: str,
        source_id: str,
        url: str,
    ) -> Dict[str, Any]:
        """Fetch a URL and ingest its text content."""
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            resp = await client.get(url, headers={"User-Agent": "AIPiloty-DocStudio/1.0"})
            resp.raise_for_status()
            raw = resp.text

        # Strip HTML tags with a simple regex if content-type is HTML
        content_type = resp.headers.get("content-type", "")
        if "html" in content_type:
            import re
            text = re.sub(r"<[^>]+>", " ", raw)
            text = re.sub(r"\s+", " ", text).strip()
        else:
            text = raw

        if not text.strip():
            return {"chunks": 0, "char_count": 0, "source_label": url}

        chunks = await self._chunk_embed_upsert(text, url, notebook_id, source_id)
        return {
            "chunks": chunks,
            "char_count": len(text),
            "source_label": url,
        }

    async def ingest_project(
        self,
        notebook_id: str,
        source_id: str,
        project_path: str,
    ) -> Dict[str, Any]:
        """Ingest all supported files under a project folder.

        Delegates to the existing IngestService (which handles allowlisted
        paths) but injects the notebook namespace into every chunk payload.
        """
        result = await self._ingest_service.ingest(
            [project_path],
            force=False,
            extra_payload={"notebook_id": notebook_id, "source_id": source_id},
        )
        return result

    async def delete_source(self, source_id: str) -> None:
        """Delete all Qdrant points for a specific source."""
        try:
            await self._store.delete_by_payload_filter(self._source_filter(source_id))
        except Exception as exc:
            logger.warning("Could not delete Qdrant chunks for source %s: %s", source_id, exc)

    async def delete_notebook(self, notebook_id: str) -> None:
        """Delete all Qdrant points belonging to a notebook."""
        try:
            await self._store.delete_by_payload_filter(self._nb_filter(notebook_id))
        except Exception as exc:
            logger.warning("Could not delete Qdrant chunks for notebook %s: %s", notebook_id, exc)
