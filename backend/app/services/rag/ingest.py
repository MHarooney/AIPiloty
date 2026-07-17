"""Ingest files from allowlisted paths into Qdrant via Ollama embeddings.

Phase 4 (2026-07-17): Added entity extraction after chunking.
Each chunk's named entities are extracted and stored in the KG (GraphStore)
for graph-aware retrieval (LazyGraphRAG pattern).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from ...core.config import get_settings
from .chunker import TextChunker
from .embeddings import EmbeddingService
from .vector_store import QdrantStore

logger = logging.getLogger(__name__)

_SUPPORTED_EXTENSIONS = {
    ".md", ".markdown", ".txt", ".py", ".ts", ".tsx",
    ".js", ".jsx", ".json", ".yaml", ".yml", ".toml",
    ".cfg", ".ini", ".sh", ".bash", ".css", ".html",
    ".rs", ".go", ".dart", ".env.example", ".sql",
    ".dockerfile", ".tf", ".hcl", ".xml", ".csv",
}

# Persistent cache of file_path -> content_hash for incremental ingest.
# Loaded from disk at first use and flushed after each successful ingest.
_CACHE_FILE = Path("data/rag_hash_cache.json")
_file_hash_cache: Dict[str, str] = {}
_cache_lock: asyncio.Lock | None = None


def _get_cache_lock() -> asyncio.Lock:
    global _cache_lock
    if _cache_lock is None:
        _cache_lock = asyncio.Lock()
    return _cache_lock


def _load_cache_from_disk() -> Dict[str, str]:
    """Read the persisted hash cache; return empty dict on any error."""
    try:
        if _CACHE_FILE.exists():
            data = json.loads(_CACHE_FILE.read_text("utf-8"))
            if isinstance(data, dict):
                return {str(k): str(v) for k, v in data.items()}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not load RAG hash cache from disk: %s", exc)
    return {}


async def _save_cache_to_disk(cache: Dict[str, str]) -> None:
    """Persist the hash cache asynchronously without blocking the event loop."""
    async with _get_cache_lock():
        try:
            _CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            payload = json.dumps(cache, indent=2)
            await asyncio.to_thread(_CACHE_FILE.write_text, payload, "utf-8")
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not save RAG hash cache to disk: %s", exc)


def _ensure_cache_loaded() -> None:
    """Populate the in-memory cache from disk if it has not been loaded yet."""
    global _file_hash_cache
    if not _file_hash_cache:
        _file_hash_cache = _load_cache_from_disk()


def _hash_content(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()[:16]


class IngestService:
    """Walk allowlisted paths, chunk, embed, and upsert into Qdrant.

    Phase 4: optionally extract entities and store in GraphStore.
    Phase 5: AST code chunking for .py/.js/.ts, optional RAPTOR summaries.

    Args:
        store:            QdrantStore instance.
        embeddings:       EmbeddingService instance.
        chunker:          TextChunker instance (Markdown + sliding window).
        graph_store:      Optional GraphStore for entity extraction (Phase 4).
        entity_extractor: Optional EntityExtractor for NER (Phase 4).
        ast_chunker:      Optional ASTChunker for code files (Phase 5).
        raptor_builder:   Optional RaptorBuilder for summary tree (Phase 5).
    """

    def __init__(
        self,
        store: QdrantStore,
        embeddings: EmbeddingService,
        chunker: TextChunker,
        graph_store: Optional[Any] = None,
        entity_extractor: Optional[Any] = None,
        ast_chunker: Optional[Any] = None,      # Phase 5
        raptor_builder: Optional[Any] = None,   # Phase 5
    ) -> None:
        self._store = store
        self._embeddings = embeddings
        self._chunker = chunker
        self._graph = graph_store
        self._extractor = entity_extractor
        self._ast_chunker = ast_chunker
        self._raptor = raptor_builder

    def _validate_path(self, path: str) -> Path:
        """Ensure *path* is under one of the configured allowlisted roots."""
        settings = get_settings()
        raw_roots = settings.kb_allowed_roots
        if not raw_roots:
            raise PermissionError(
                "No KB_ALLOWED_ROOTS configured. "
                "Set KB_ALLOWED_ROOTS in .env (comma-separated absolute paths)."
            )
        resolved = Path(path).resolve()
        allowed = [Path(r.strip()).resolve() for r in raw_roots.split(",") if r.strip()]
        for root in allowed:
            try:
                resolved.relative_to(root)
                return resolved
            except ValueError:
                continue
        raise PermissionError(
            f"Path '{path}' is not under any allowed root. "
            f"Allowed: {[str(r) for r in allowed]}"
        )

    def _collect_files(self, root: Path) -> List[Path]:
        """Recursively collect supported files under *root*."""
        if root.is_file():
            if root.suffix.lower() in _SUPPORTED_EXTENSIONS:
                return [root]
            return []
        files: List[Path] = []
        for item in sorted(root.rglob("*")):
            if item.is_file() and item.suffix.lower() in _SUPPORTED_EXTENSIONS:
                # Skip hidden dirs and common noise
                parts = item.relative_to(root).parts
                if any(p.startswith(".") or p in ("node_modules", "__pycache__", ".next", "dist", "build") for p in parts):
                    continue
                files.append(item)
        return files

    async def ingest(
        self,
        paths: List[str],
        *,
        force: bool = False,
        extra_payload: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """Ingest one or more paths. Skips unchanged files unless *force*.

        Args:
            extra_payload: Optional dict merged into every chunk's payload at
                upsert time.  Used by Doc Studio to tag chunks with
                ``notebook_id`` and ``source_id`` for namespace isolation.
        """
        _ensure_cache_loaded()
        await self._store.ensure_collection()

        total_files = 0
        total_chunks = 0
        skipped_files = 0
        errors: List[str] = []
        cache_updated = False

        for raw_path in paths:
            try:
                validated = self._validate_path(raw_path)
            except PermissionError as e:
                errors.append(str(e))
                continue

            files = self._collect_files(validated)

            # --- incremental: batch-fetch stored hashes ---
            stored_hashes: Dict[str, str] = {}
            if not force:
                file_strs = [str(f) for f in files]
                stored_hashes = await self._store.get_content_hashes(file_strs)

            for filepath in files:
                try:
                    content = filepath.read_text(encoding="utf-8", errors="replace")
                    if not content.strip():
                        continue

                    new_hash = _hash_content(content)
                    fp_str = str(filepath)

                    # Skip unchanged files
                    if not force:
                        cached = _file_hash_cache.get(fp_str)
                        stored = stored_hashes.get(fp_str)
                        if new_hash == cached or new_hash == stored:
                            skipped_files += 1
                            logger.debug("Skipped (unchanged) %s", filepath)
                            continue

                    chunks = self._chunker.chunk_file(fp_str, content)

                    # ── Phase 5: AST code chunking ────────────────────────
                    settings = get_settings()
                    ext = filepath.suffix.lower()
                    if (
                        settings.kb_ast_chunk_enabled
                        and self._ast_chunker is not None
                        and ext in (".py", ".js", ".jsx", ".ts", ".tsx", ".mjs")
                    ):
                        ast_chunks = self._ast_chunker.chunk_file(fp_str, content)
                        if len(ast_chunks) >= 2:
                            # Convert ASTChunks to TextChunker-compatible format
                            from .chunker import Chunk
                            chunks = [
                                Chunk(
                                    content=ac.content,
                                    source_path=ac.source_path,
                                    chunk_index=ac.chunk_index,
                                    heading=ac.heading,
                                    content_hash=ac.content_hash,
                                )
                                for ac in ast_chunks
                            ]
                            logger.info("AST chunker: %s → %d AST chunks", filepath, len(chunks))
                    # ── End Phase 5 AST ───────────────────────────────────

                    if not chunks:
                        continue

                    # Delete old chunks for this source before re-indexing
                    await self._store.delete_by_source(fp_str)

                    texts = [c.content for c in chunks]
                    vectors = await self._embeddings.embed_batch(texts)

                    payloads = [
                        {
                            "content": c.content,
                            "source_path": c.source_path,
                            "chunk_index": c.chunk_index,
                            "heading": c.heading,
                            "content_hash": new_hash,
                            **(extra_payload or {}),
                        }
                        for c in chunks
                    ]

                    count = await self._store.upsert_chunks(vectors, payloads)
                    _file_hash_cache[fp_str] = new_hash
                    cache_updated = True
                    total_files += 1
                    total_chunks += count
                    logger.info("Ingested %s → %d chunks", filepath, count)

                    # ── Phase 4: Entity extraction for KG ────────────────
                    settings = get_settings()
                    if (
                        settings.rag_graph_enabled
                        and self._graph is not None
                        and self._extractor is not None
                    ):
                        # Use "source_path::chunk_index" as stable KG chunk identifier.
                        # This avoids needing the Qdrant internal UUID.
                        for chunk in chunks:
                            stable_id = f"{fp_str}::{chunk.chunk_index}"
                            try:
                                result = await self._extractor.extract(
                                    chunk.content, source_path=fp_str
                                )
                                if result.entities:
                                    await self._graph.add_entities_from_chunk(
                                        chunk_id=stable_id,
                                        source_path=fp_str,
                                        entities=result.entities,
                                        relations=result.relations,
                                    )
                            except Exception as _kg_err:
                                logger.debug(
                                    "Entity extraction skipped for chunk %s: %s",
                                    stable_id, _kg_err,
                                )
                    # ── End Phase 4 ───────────────────────────────────────

                    # ── Phase 5: RAPTOR summary tree ──────────────────────
                    if (
                        settings.rag_raptor_enabled
                        and self._raptor is not None
                        and len(chunks) >= 2
                    ):
                        try:
                            chunk_texts = [c.content for c in chunks]
                            await self._raptor.build_for_source(
                                source_path=fp_str,
                                chunks=chunk_texts,
                                extra_payload=extra_payload or {},
                            )
                        except Exception as _rap_err:
                            logger.debug("RAPTOR skipped for %s: %s", fp_str, _rap_err)
                    # ── End Phase 5 RAPTOR ────────────────────────────────

                except Exception as e:
                    msg = f"Failed to ingest {filepath}: {e}"
                    logger.error(msg)
                    errors.append(msg)

        # Persist the updated cache so the next restart skips unchanged files
        if cache_updated:
            await _save_cache_to_disk(_file_hash_cache)

        return {
            "files_processed": total_files,
            "chunks_created": total_chunks,
            "skipped_unchanged": skipped_files,
            "errors": errors,
        }
