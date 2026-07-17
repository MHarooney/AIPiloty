"""Retriever — query the Qdrant vector store via Ollama embeddings.

Phase 1 enhancements (2026-07-17):
  - Cross-encoder reranking (BGE-reranker via sentence-transformers)
  - Conversation-aware query rewriting (multi-turn context resolution)
  - Multi-query expansion (parallel retrieval over 3+ phrasings, fused via RRF)
  - HyDE (Hypothetical Document Embeddings for richer query vectors)

All enhancements are feature-flagged via Settings and degrade gracefully.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Any, List, Optional

from qdrant_client import models as qmodels

from ...core.config import get_settings
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
    """Embed a query and search Qdrant for relevant chunks.

    Args:
        store:          Qdrant vector store wrapper.
        embeddings:     Ollama embedding service.
        llm:            Optional OllamaService used by query rewriter / expander / HyDE.
                        When None, all LLM-based enhancements are skipped.
        graph_retriever: Optional GraphRetriever for Phase 4 graph lane.
    """

    def __init__(
        self,
        store: QdrantStore,
        embeddings: EmbeddingService,
        llm: Any = None,
        graph_retriever: Any = None,  # Phase 4: GraphRetriever | None
    ) -> None:
        self._store = store
        self._embeddings = embeddings
        self._llm = llm
        self._graph_retriever = graph_retriever  # Phase 4

        # Lazy-init Phase 1 components (avoid import cost at startup)
        self._reranker: Optional[Any] = None
        self._reranker_initialised = False

    # ── Internal helpers ──────────────────────────────────────────────────

    def _get_reranker(self) -> Optional[Any]:
        """Return the Reranker singleton, initialising on first call."""
        if not self._reranker_initialised:
            self._reranker_initialised = True
            settings = get_settings()
            if settings.rag_rerank_enabled:
                try:
                    from .reranker import Reranker
                    self._reranker = Reranker(model_name=settings.rag_rerank_model)
                except Exception as exc:
                    logger.warning("Could not initialise Reranker: %s", exc)
        return self._reranker

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

    # ── Public API ────────────────────────────────────────────────────────

    async def search(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.3,
        mode: str = "hybrid",
        notebook_id: str | None = None,
        conversation_history: List[dict] | None = None,
    ) -> List[RetrievalResult]:
        """Search using vector, keyword, or hybrid (RRF fusion) mode.

        Phase 1 pipeline:
          1. Query rewriting   — resolve conversational coreferences
          2. HyDE expansion    — generate hypothetical answer for richer embedding
          3. Multi-query       — retrieve for N phrasings in parallel
          4. RRF fusion        — merge all result lists
          5. Cross-encoder     — rerank top-K candidates for true relevance

        Args:
            query:                Latest user query.
            top_k:                Final number of results to return.
            min_score:            Minimum cosine score threshold for vector search.
            mode:                 "hybrid" (default), "semantic", or "keyword".
            notebook_id:          Restrict to a specific notebook namespace.
            conversation_history: Recent chat messages for query rewriting.
        """
        settings = get_settings()
        history = conversation_history or []

        # ── Step 1: Query rewriting ───────────────────────────────────────
        if self._llm and settings.rag_query_rewrite_enabled and history:
            try:
                from .query_rewriter import QueryRewriter
                query = await QueryRewriter(self._llm).rewrite(query, history)
            except Exception as exc:
                logger.warning("Query rewriting skipped: %s", exc)

        # ── Step 2 & 3: HyDE + multi-query expansion ─────────────────────
        hyde_query = query          # query used for vector embedding
        all_queries = [query]       # all phrasings to retrieve for

        if self._llm and (settings.rag_hyde_enabled or settings.rag_multi_query_enabled):
            try:
                from .query_expander import expand_with_hyde_and_multi_query
                hyde_query, all_queries = await expand_with_hyde_and_multi_query(
                    query,
                    self._llm,
                    use_hyde=settings.rag_hyde_enabled,
                    use_multi_query=settings.rag_multi_query_enabled,
                    n_variants=settings.rag_multi_query_variants,
                )
            except Exception as exc:
                logger.warning("Query expansion skipped: %s", exc)

        # ── Step 4: Retrieve across all query phrasings ───────────────────
        pf = self._notebook_filter(notebook_id)

        # Fetch more candidates when reranking is enabled (top_k * fetch_mult)
        fetch_k = top_k * settings.rag_rerank_fetch_multiplier if settings.rag_rerank_enabled else top_k

        if mode == "keyword":
            # Keyword search doesn't benefit from HyDE/multi-query embedding
            raw_results = await self._keyword_search(query, fetch_k, pf)
        elif mode == "semantic":
            raw_results = await self._multi_query_vector_search(
                hyde_query, all_queries, fetch_k, min_score, pf
            )
        else:  # hybrid — default
            raw_results = await self._multi_query_hybrid_search(
                hyde_query, all_queries, query, fetch_k, min_score, pf
            )

        # ── Step 5: Cross-encoder reranking ───────────────────────────────
        reranker = self._get_reranker()
        if reranker is not None and len(raw_results) > top_k:
            results = reranker.rerank(query, raw_results, top_k=top_k)
        else:
            results = raw_results[:top_k]

        return results

    # ── Low-level single-query search ─────────────────────────────────────

    async def _vector_search(
        self,
        query: str,
        top_k: int,
        min_score: float,
        payload_filter: "qmodels.Filter | None" = None,
    ) -> List[RetrievalResult]:
        """Pure vector (semantic) search for a single query string."""
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
            RetrievalResult(
                content=h.content,
                source_path=h.source_path,
                heading=h.heading,
                score=h.score,
            )
            for h in hits
        ]

    async def _keyword_search(
        self,
        query: str,
        top_k: int,
        payload_filter: "qmodels.Filter | None" = None,
    ) -> List[RetrievalResult]:
        """Pure BM25-style keyword search for a single query string."""
        keywords = [w for w in query.split() if len(w) > 2]
        if not keywords:
            keywords = query.split()
        hits = await self._store.keyword_search(
            keywords=keywords, top_k=top_k, payload_filter=payload_filter
        )
        return [
            RetrievalResult(
                content=h.content,
                source_path=h.source_path,
                heading=h.heading,
                score=h.score,
            )
            for h in hits
        ]

    # ── Multi-query search (Phase 1) ───────────────────────────────────────

    async def _multi_query_vector_search(
        self,
        hyde_query: str,
        all_queries: List[str],
        top_k: int,
        min_score: float,
        payload_filter: "qmodels.Filter | None" = None,
    ) -> List[RetrievalResult]:
        """Run parallel vector searches for HyDE query + all phrasings, fuse via RRF."""
        tasks = [
            asyncio.create_task(
                self._vector_search(q, top_k, min_score, payload_filter)
            )
            for q in set([hyde_query] + all_queries)  # deduplicate
        ]
        all_results = await asyncio.gather(*tasks, return_exceptions=True)
        lists: List[List[RetrievalResult]] = [
            r for r in all_results if not isinstance(r, BaseException)
        ]
        return self._rrf_fuse_many(lists, top_k)

    async def _multi_query_hybrid_search(
        self,
        hyde_query: str,
        all_queries: List[str],
        original_query: str,
        top_k: int,
        min_score: float,
        payload_filter: "qmodels.Filter | None" = None,
    ) -> List[RetrievalResult]:
        """Triple RRF: vector (all phrasings) + keyword + graph lanes in parallel."""
        unique_queries = list(dict.fromkeys([hyde_query] + all_queries))

        # Lane 1: vector searches for all phrasings (including HyDE)
        vector_tasks = [
            asyncio.create_task(
                self._vector_search(q, top_k * 2, min_score, payload_filter)
            )
            for q in unique_queries
        ]
        # Lane 2: keyword search on original query
        keyword_task = asyncio.create_task(
            self._keyword_search(original_query, top_k * 2, payload_filter)
        )
        # Lane 3: graph search (Phase 4 — LazyGraphRAG)
        notebook_id = None  # extracted from filter if needed
        graph_task = None
        if self._graph_retriever is not None:
            graph_task = asyncio.create_task(
                self._graph_retriever.search(original_query, top_k=top_k * 2)
            )

        gather_tasks = [*vector_tasks, keyword_task]
        if graph_task:
            gather_tasks.append(graph_task)

        all_raw = await asyncio.gather(*gather_tasks, return_exceptions=True)

        lists: List[List[RetrievalResult]] = [
            r for r in all_raw if not isinstance(r, BaseException)
        ]
        if not lists:
            return []

        return self._rrf_fuse_many(lists, top_k)

    # ── RRF fusion helpers ─────────────────────────────────────────────────

    @staticmethod
    def _rrf_fuse_many(
        result_lists: List[List[RetrievalResult]],
        top_k: int,
        k: int = 60,
    ) -> List[RetrievalResult]:
        """Reciprocal Rank Fusion across an arbitrary number of ranked lists."""
        if not result_lists:
            return []
        if len(result_lists) == 1:
            return result_lists[0][:top_k]

        scores: dict[str, float] = {}
        items: dict[str, RetrievalResult] = {}

        for result_list in result_lists:
            for rank, item in enumerate(result_list):
                key = f"{item.source_path}:{item.content[:80]}"
                scores[key] = scores.get(key, 0.0) + 1.0 / (k + rank + 1)
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

    # Keep the two-list helper for backwards compatibility (used in tests)
    @staticmethod
    def _rrf_fuse(
        list_a: List[RetrievalResult],
        list_b: List[RetrievalResult],
        top_k: int,
        k: int = 60,
    ) -> List[RetrievalResult]:
        """Reciprocal Rank Fusion: combine two ranked lists (legacy helper)."""
        return RetrieverService._rrf_fuse_many([list_a, list_b], top_k, k)

    # ── Health check ───────────────────────────────────────────────────────

    async def is_available(self) -> bool:
        """Check that both Qdrant and the embedding model are reachable."""
        qdrant_ok = await self._store.is_available()
        embed_ok = await self._embeddings.is_available()
        return qdrant_ok and embed_ok

    @property
    def reranker_available(self) -> bool:
        """True if the cross-encoder reranker is loaded and ready."""
        r = self._get_reranker()
        return r is not None and getattr(r, "is_available", False)
