"""Retriever — query the Qdrant vector store via Ollama embeddings."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import List

from qdrant_client import models as qmodels

from .embeddings import EmbeddingService
from .vector_store import QdrantStore, SearchResult

logger = logging.getLogger(__name__)


@dataclass
class RetrievalResult:
    """A retrieval hit with formatted citation info."""

    content: str
    source_path: str
    heading: str
    score: float

    def format_citation(self, index: int) -> str:
        heading_part = f" > {self.heading}" if self.heading else ""
        return (
            f"[{index}] [Source: {self.source_path}{heading_part}] "
            f"(score: {self.score:.2f})\n{self.content}"
        )


class RetrieverService:
    """Embed a query and search Qdrant for relevant chunks."""

    def __init__(self, store: QdrantStore, embeddings: EmbeddingService) -> None:
        self._store = store
        self._embeddings = embeddings

    @staticmethod
    def _notebook_filter(notebook_id: str | None) -> "qmodels.Filter | None":
        """Build a Qdrant payload filter scoped to one notebook, or None."""
        if not notebook_id:
            return None
        return qmodels.Filter(
            must=[
                qmodels.FieldCondition(
                    key="notebook_id",
                    match=qmodels.MatchValue(value=notebook_id),
                )
            ]
        )

    async def search(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.3,
        mode: str = "hybrid",
        notebook_id: str | None = None,
    ) -> List[RetrievalResult]:
        """Search using vector, keyword, or hybrid (RRF fusion) mode.

        Args:
            notebook_id: When provided, restricts results to chunks that were
                ingested under this notebook's namespace.
        """
        pf = self._notebook_filter(notebook_id)
        if mode == "keyword":
            return await self._keyword_search(query, top_k, pf)
        elif mode == "semantic":
            return await self._vector_search(query, top_k, min_score, pf)
        else:  # hybrid — default
            return await self._hybrid_search(query, top_k, min_score, pf)

    async def _vector_search(
        self, query: str, top_k: int, min_score: float,
        payload_filter: "qmodels.Filter | None" = None,
    ) -> List[RetrievalResult]:
        """Pure vector (semantic) search."""
        try:
            vector = await self._embeddings.embed_one(query)
        except Exception as e:
            logger.error("Embedding query failed: %s", e)
            raise RuntimeError(f"Failed to embed query: {e}") from e

        hits: List[SearchResult] = await self._store.search(
            query_vector=vector, top_k=top_k, min_score=min_score,
            payload_filter=payload_filter,
        )
        return [
            RetrievalResult(content=h.content, source_path=h.source_path, heading=h.heading, score=h.score)
            for h in hits
        ]

    async def _keyword_search(
        self, query: str, top_k: int,
        payload_filter: "qmodels.Filter | None" = None,
    ) -> List[RetrievalResult]:
        """Pure keyword search."""
        keywords = [w for w in query.split() if len(w) > 2]
        if not keywords:
            keywords = query.split()
        hits = await self._store.keyword_search(
            keywords=keywords, top_k=top_k, payload_filter=payload_filter
        )
        return [
            RetrievalResult(content=h.content, source_path=h.source_path, heading=h.heading, score=h.score)
            for h in hits
        ]

    async def _hybrid_search(
        self, query: str, top_k: int, min_score: float,
        payload_filter: "qmodels.Filter | None" = None,
    ) -> List[RetrievalResult]:
        """Hybrid search — fuse vector + keyword results via Reciprocal Rank Fusion."""
        import asyncio
        vector_task = asyncio.create_task(self._vector_search(query, top_k * 2, min_score, payload_filter))
        keyword_task = asyncio.create_task(self._keyword_search(query, top_k * 2, payload_filter))

        vector_results, keyword_results = await asyncio.gather(
            vector_task, keyword_task, return_exceptions=True
        )

        # Graceful fallback if one method fails
        if isinstance(vector_results, BaseException):
            logger.warning("Vector search failed in hybrid: %s", vector_results)
            vector_results = []
        if isinstance(keyword_results, BaseException):
            logger.warning("Keyword search failed in hybrid: %s", keyword_results)
            keyword_results = []

        return self._rrf_fuse(vector_results, keyword_results, top_k)

    @staticmethod
    def _rrf_fuse(
        list_a: List[RetrievalResult],
        list_b: List[RetrievalResult],
        top_k: int,
        k: int = 60,
    ) -> List[RetrievalResult]:
        """Reciprocal Rank Fusion: combine two ranked lists."""
        scores: dict[str, float] = {}
        items: dict[str, RetrievalResult] = {}

        for rank, item in enumerate(list_a):
            key = f"{item.source_path}:{item.content[:80]}"
            scores[key] = scores.get(key, 0) + 1.0 / (k + rank + 1)
            items[key] = item

        for rank, item in enumerate(list_b):
            key = f"{item.source_path}:{item.content[:80]}"
            scores[key] = scores.get(key, 0) + 1.0 / (k + rank + 1)
            if key not in items:
                items[key] = item

        sorted_keys = sorted(scores, key=lambda x: scores[x], reverse=True)[:top_k]
        return [
            RetrievalResult(
                content=items[k_].content,
                source_path=items[k_].source_path,
                heading=items[k_].heading,
                score=round(scores[k_], 4),
            )
            for k_ in sorted_keys
        ]

    async def is_available(self) -> bool:
        """Check that both Qdrant and the embedding model are reachable."""
        qdrant_ok = await self._store.is_available()
        embed_ok = await self._embeddings.is_available()
        return qdrant_ok and embed_ok
