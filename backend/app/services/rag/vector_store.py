"""Qdrant vector store wrapper for RAG."""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from qdrant_client import AsyncQdrantClient, models

from ...core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class SearchResult:
    """A single vector search result."""

    content: str
    source_path: str
    heading: str
    score: float
    chunk_index: int


class QdrantStore:
    """Async Qdrant client wrapper for AIPiloty RAG."""

    def __init__(
        self,
        url: str | None = None,
        api_key: str | None = None,
        collection: str | None = None,
    ) -> None:
        settings = get_settings()
        self._url = url or settings.qdrant_url
        self._api_key = api_key or settings.qdrant_api_key
        self._collection = collection or settings.qdrant_collection
        self._client: Optional[AsyncQdrantClient] = None
        # Serialize concurrent init calls so only one AsyncQdrantClient is created.
        self._init_lock: asyncio.Lock | None = None

    def _get_init_lock(self) -> asyncio.Lock:
        if self._init_lock is None:
            self._init_lock = asyncio.Lock()
        return self._init_lock

    async def _get_client(self) -> AsyncQdrantClient:
        if self._client is not None:
            return self._client
        async with self._get_init_lock():
            # Double-checked locking: another coroutine may have initialised
            # the client while we were waiting for the lock.
            if self._client is None:
                kwargs: Dict[str, Any] = {"url": self._url, "timeout": 30}
                if self._api_key:
                    kwargs["api_key"] = self._api_key
                self._client = AsyncQdrantClient(**kwargs)
        return self._client

    async def ensure_collection(self, vector_size: int = 768) -> None:
        """Create the collection if it doesn't already exist."""
        client = await self._get_client()
        collections = await client.get_collections()
        names = [c.name for c in collections.collections]
        if self._collection not in names:
            await client.create_collection(
                collection_name=self._collection,
                vectors_config=models.VectorParams(
                    size=vector_size,
                    distance=models.Distance.COSINE,
                ),
            )
            logger.info("Created Qdrant collection '%s' (dim=%d)", self._collection, vector_size)
        else:
            logger.info("Qdrant collection '%s' already exists", self._collection)

    async def upsert_chunks(
        self,
        vectors: List[List[float]],
        payloads: List[Dict[str, Any]],
    ) -> int:
        """Upsert vectors with payloads. Returns number of points upserted."""
        client = await self._get_client()
        points = [
            models.PointStruct(
                id=str(uuid.uuid4()),
                vector=vec,
                payload=payload,
            )
            for vec, payload in zip(vectors, payloads)
        ]
        # Qdrant python client handles batching internally
        await client.upsert(collection_name=self._collection, points=points)
        return len(points)

    async def search(
        self,
        query_vector: List[float],
        top_k: int = 5,
        min_score: float = 0.3,
        payload_filter: Optional[Any] = None,
    ) -> List[SearchResult]:
        """Search for similar vectors. Returns results above min_score.

        Args:
            payload_filter: Optional ``qdrant_client.models.Filter`` to restrict
                results to a specific notebook or source namespace.
        """
        client = await self._get_client()
        kwargs: Dict[str, Any] = {
            "collection_name": self._collection,
            "query": query_vector,
            "limit": top_k,
        }
        if payload_filter is not None:
            kwargs["query_filter"] = payload_filter
        hits = await client.query_points(**kwargs)
        results: List[SearchResult] = []
        for hit in hits.points:
            if hit.score is not None and hit.score < min_score:
                continue
            payload = hit.payload or {}
            results.append(
                SearchResult(
                    content=payload.get("content", ""),
                    source_path=payload.get("source_path", ""),
                    heading=payload.get("heading", ""),
                    score=hit.score if hit.score is not None else 0.0,
                    chunk_index=payload.get("chunk_index", 0),
                )
            )
        return results

    async def keyword_search(
        self,
        keywords: List[str],
        top_k: int = 10,
        payload_filter: Optional[Any] = None,
    ) -> List[SearchResult]:
        """Simple keyword search using Qdrant scroll + content matching.

        Args:
            payload_filter: Optional ``qdrant_client.models.Filter`` to restrict
                results to a specific notebook or source namespace.
        """
        client = await self._get_client()
        # Use scroll with payload filter for keyword matching
        conditions = [
            models.FieldCondition(
                key="content",
                match=models.MatchText(text=kw),
            )
            for kw in keywords
            if kw.strip()
        ]
        if not conditions:
            return []
        # Match any keyword (should match)
        keyword_filter = models.Filter(should=conditions)
        if payload_filter is not None:
            # Combine: results must match the payload_filter AND at least one keyword
            filt = models.Filter(
                must=list(payload_filter.must or []),
                should=conditions,
            )
        else:
            filt = keyword_filter
        records, _ = await client.scroll(
            collection_name=self._collection,
            scroll_filter=filt,
            limit=top_k,
            with_payload=True,
        )
        results: List[SearchResult] = []
        for rec in records:
            payload = rec.payload or {}
            content = payload.get("content", "")
            # Simple keyword relevance score: count of keywords found
            matches = sum(1 for kw in keywords if kw.lower() in content.lower())
            score = matches / max(len(keywords), 1)
            results.append(SearchResult(
                content=content,
                source_path=payload.get("source_path", ""),
                heading=payload.get("heading", ""),
                score=score,
                chunk_index=payload.get("chunk_index", 0),
            ))
        return results

    async def delete_by_source(self, source_path: str) -> None:
        """Delete all points for a given source path."""
        client = await self._get_client()
        await client.delete(
            collection_name=self._collection,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="source_path",
                            match=models.MatchValue(value=source_path),
                        )
                    ]
                )
            ),
        )

    async def delete_by_payload_filter(self, filt: Any) -> None:
        """Delete all points matching an arbitrary Qdrant Filter.

        Used by Doc Studio to purge a notebook's or a single source's chunks.
        """
        client = await self._get_client()
        await client.delete(
            collection_name=self._collection,
            points_selector=models.FilterSelector(filter=filt),
        )

    async def get_content_hashes(self, source_paths: List[str]) -> Dict[str, str]:
        """Return a mapping of source_path -> content_hash for given paths.

        Fetches the first chunk of each source_path to read its stored hash.
        """
        client = await self._get_client()
        result: Dict[str, str] = {}
        for sp in source_paths:
            try:
                records, _ = await client.scroll(
                    collection_name=self._collection,
                    scroll_filter=models.Filter(
                        must=[
                            models.FieldCondition(
                                key="source_path",
                                match=models.MatchValue(value=sp),
                            ),
                            models.FieldCondition(
                                key="chunk_index",
                                match=models.MatchValue(value=0),
                            ),
                        ]
                    ),
                    limit=1,
                    with_payload=True,
                )
                if records:
                    h = (records[0].payload or {}).get("content_hash", "")
                    if h:
                        result[sp] = h
            except Exception:
                pass  # treat as "no stored hash" -> will re-ingest
        return result

    async def get_stats(self) -> Dict[str, Any]:
        """Return collection point count and status."""
        client = await self._get_client()
        try:
            info = await client.get_collection(self._collection)
            return {
                "collection": self._collection,
                "points_count": info.points_count,
                "status": info.status.value if info.status else "unknown",
            }
        except Exception as e:
            return {"collection": self._collection, "error": str(e)}

    async def is_available(self) -> bool:
        """Quick connectivity check."""
        try:
            client = await self._get_client()
            await client.get_collections()
            return True
        except Exception:
            return False

    async def close(self) -> None:
        if self._client:
            await self._client.close()
            self._client = None
