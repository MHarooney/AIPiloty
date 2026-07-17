"""Episodic Memory Store — Qdrant-backed semantic memory for AIPiloty.

Stores past agent experiences (tool runs, reasoning chains, user interactions)
as embedded vectors in a dedicated Qdrant collection.  At the start of each
conversation the orchestrator performs a k-NN search over past episodes to
surface contextually relevant prior work — similar to how Claude Projects Memory
or ChatGPT Memory works.

Architecture:
  • Each episode is a short text summary + metadata (session_id, timestamp, category).
  • Embeddings use the same Ollama service already configured for KB RAG.
  • Collection: ``aipiloty_episodic_memory`` (separate from KB ``aipiloty_kb``).
  • Falls back gracefully to empty results when Qdrant is unavailable.
  • PII is redacted before storage using the same patterns as AgentMemory.
  • Max 1000 episodes; oldest/least-important evicted when limit approached.

Usage (orchestrator)::

    store = EpisodicStore(qdrant_store, embeddings)
    # At conversation start: recall related episodes
    recalls = await store.recall(query="how to fix nginx 502", top_k=3)
    # After conversation: persist new episode
    await store.remember(summary="Fixed nginx 502 by ...", category="fix", session_id="s1")
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, List, Optional

logger = logging.getLogger(__name__)

_COLLECTION = "aipiloty_episodic_memory"
_VECTOR_SIZE = 768          # nomic-embed-text default
_MAX_EPISODES = 1000        # hard cap; evict oldest when exceeded
_IMPORTANCE_DECAY = 0.95    # multiply importance by this each time a newer episode is stored


# ── Simple PII scrubber (mirrors GuardrailService patterns) ──────────────
import re as _re
_PII_RE = _re.compile(
    r"(sk-|Bearer\s|password\s*[:=]\s*|api[_\s-]?key\s*[:=]\s*)\S+",
    _re.IGNORECASE,
)

def _redact(text: str) -> str:
    return _PII_RE.sub("[REDACTED]", text)


@dataclass
class Episode:
    """A single recalled episodic memory."""

    id: str
    summary: str
    category: str               # fix | incident | pattern | discovery | conversation
    session_id: str
    importance: float           # 0.0 – 1.0
    created_at: str             # ISO-8601
    score: float = 0.0          # cosine similarity to recall query

    def format_for_prompt(self, index: int) -> str:
        dt = self.created_at[:10]  # YYYY-MM-DD
        return f"[Memory {index}] ({self.category} • {dt}): {self.summary}"


class EpisodicStore:
    """Qdrant-backed semantic episodic memory.

    Args:
        qdrant_store: An initialised ``QdrantStore`` instance (from Phase 1 RAG).
        embeddings:   An initialised ``EmbeddingService`` (Ollama).
        collection:   Override the Qdrant collection name (default: aipiloty_episodic_memory).
        max_episodes: Maximum stored episodes before eviction.
    """

    def __init__(
        self,
        qdrant_store: Any,
        embeddings: Any,
        collection: str = _COLLECTION,
        max_episodes: int = _MAX_EPISODES,
    ) -> None:
        self._store = qdrant_store
        self._embeddings = embeddings
        self._collection = collection
        self._max = max_episodes
        self._ready = False         # set True once collection ensured
        self._init_lock = asyncio.Lock()

    # ── Initialisation ────────────────────────────────────────────────────

    async def _ensure_ready(self) -> bool:
        """Ensure the episodic collection exists. Returns True if ready."""
        if self._ready:
            return True
        async with self._init_lock:
            if self._ready:
                return True
            try:
                client = await self._store._get_client()
                from qdrant_client import models
                collections = await client.get_collections()
                names = [c.name for c in collections.collections]
                if self._collection not in names:
                    await client.create_collection(
                        collection_name=self._collection,
                        vectors_config=models.VectorParams(
                            size=_VECTOR_SIZE,
                            distance=models.Distance.COSINE,
                        ),
                    )
                    logger.info("Created episodic memory collection '%s'", self._collection)
                self._ready = True
                return True
            except Exception as exc:
                logger.warning("EpisodicStore: Qdrant unavailable (%s) — running in degraded mode", exc)
                return False

    # ── Write ─────────────────────────────────────────────────────────────

    async def remember(
        self,
        summary: str,
        *,
        category: str = "general",
        session_id: str = "unknown",
        importance: float = 0.6,
    ) -> Optional[str]:
        """Embed and store a new episode. Returns episode UUID or None on failure.

        Args:
            summary:    Short text summary of the episode (max 800 chars).
            category:   One of: fix, incident, pattern, discovery, conversation, general.
            session_id: The chat session that generated this episode.
            importance: 0.0–1.0 priority weight.

        Returns:
            Episode UUID string, or None if Qdrant is unavailable.
        """
        if not summary.strip():
            return None
        if not await self._ensure_ready():
            return None

        clean = _redact(summary.strip()[:800])
        episode_id = str(uuid.uuid4())
        created_at = datetime.now(timezone.utc).isoformat()

        try:
            vector = await self._embeddings.embed_one(clean)
            client = await self._store._get_client()
            from qdrant_client import models
            await client.upsert(
                collection_name=self._collection,
                points=[
                    models.PointStruct(
                        id=episode_id,
                        vector=vector,
                        payload={
                            "summary": clean,
                            "category": category,
                            "session_id": session_id,
                            "importance": importance,
                            "created_at": created_at,
                        },
                    )
                ],
            )
            logger.debug("EpisodicStore: stored episode %s (%s)", episode_id[:8], category)
            await self._evict_if_needed(client)
            return episode_id
        except Exception as exc:
            logger.warning("EpisodicStore.remember failed: %s", exc)
            return None

    # ── Read ──────────────────────────────────────────────────────────────

    async def recall(
        self,
        query: str,
        top_k: int = 3,
        min_score: float = 0.55,
        category: Optional[str] = None,
    ) -> List[Episode]:
        """Semantic search over past episodes.

        Args:
            query:     The current user query or task description.
            top_k:     Maximum episodes to return.
            min_score: Cosine similarity threshold (0–1).
            category:  Optional filter by episode category.

        Returns:
            List of Episode dataclasses, sorted by relevance descending.
            Empty list if Qdrant unavailable or no matches found.
        """
        if not query.strip() or not await self._ensure_ready():
            return []

        try:
            vector = await self._embeddings.embed_one(query.strip()[:400])
            client = await self._store._get_client()
            from qdrant_client import models

            payload_filter = None
            if category:
                payload_filter = models.Filter(
                    must=[models.FieldCondition(
                        key="category",
                        match=models.MatchValue(value=category),
                    )]
                )

            hits = await client.search(
                collection_name=self._collection,
                query_vector=vector,
                limit=top_k,
                score_threshold=min_score,
                query_filter=payload_filter,
                with_payload=True,
            )

            episodes: List[Episode] = []
            for h in hits:
                p = h.payload or {}
                episodes.append(Episode(
                    id=str(h.id),
                    summary=p.get("summary", ""),
                    category=p.get("category", "general"),
                    session_id=p.get("session_id", "unknown"),
                    importance=float(p.get("importance", 0.5)),
                    created_at=p.get("created_at", ""),
                    score=round(h.score, 4),
                ))

            logger.info("EpisodicStore.recall: %d episodes for %r", len(episodes), query[:50])
            return episodes

        except Exception as exc:
            logger.warning("EpisodicStore.recall failed: %s", exc)
            return []

    async def list_episodes(
        self,
        limit: int = 50,
        offset: int = 0,
        category: Optional[str] = None,
    ) -> List[Episode]:
        """Return recent episodes for the Memory Browser UI.

        Sorted by ``created_at`` descending (newest first).
        """
        if not await self._ensure_ready():
            return []
        try:
            client = await self._store._get_client()
            from qdrant_client import models

            payload_filter = None
            if category:
                payload_filter = models.Filter(
                    must=[models.FieldCondition(
                        key="category",
                        match=models.MatchValue(value=category),
                    )]
                )

            result, _ = await client.scroll(
                collection_name=self._collection,
                scroll_filter=payload_filter,
                limit=limit,
                offset=offset,
                with_payload=True,
                with_vectors=False,
            )

            episodes = [
                Episode(
                    id=str(r.id),
                    summary=r.payload.get("summary", ""),
                    category=r.payload.get("category", "general"),
                    session_id=r.payload.get("session_id", "unknown"),
                    importance=float(r.payload.get("importance", 0.5)),
                    created_at=r.payload.get("created_at", ""),
                )
                for r in result
            ]
            # Sort newest first
            episodes.sort(key=lambda e: e.created_at, reverse=True)
            return episodes
        except Exception as exc:
            logger.warning("EpisodicStore.list_episodes failed: %s", exc)
            return []

    async def forget(self, episode_id: str) -> bool:
        """Delete a specific episode by ID. Returns True if deleted."""
        if not await self._ensure_ready():
            return False
        try:
            client = await self._store._get_client()
            await client.delete(
                collection_name=self._collection,
                points_selector=[episode_id],
            )
            logger.info("EpisodicStore: deleted episode %s", episode_id[:8])
            return True
        except Exception as exc:
            logger.warning("EpisodicStore.forget failed: %s", exc)
            return False

    async def count(self) -> int:
        """Return the total number of stored episodes."""
        if not await self._ensure_ready():
            return 0
        try:
            client = await self._store._get_client()
            info = await client.get_collection(self._collection)
            return info.points_count or 0
        except Exception:
            return 0

    # ── Eviction ─────────────────────────────────────────────────────────

    async def _evict_if_needed(self, client: Any) -> None:
        """If over the cap, delete oldest low-importance episodes."""
        try:
            info = await client.get_collection(self._collection)
            count = info.points_count or 0
            if count <= self._max:
                return

            # Scroll oldest episodes and delete lowest-importance ones
            result, _ = await client.scroll(
                collection_name=self._collection,
                limit=count - self._max + 50,  # fetch a bit extra
                with_payload=True,
                with_vectors=False,
            )
            # Sort by importance ascending (evict unimportant first)
            to_evict = sorted(result, key=lambda r: r.payload.get("importance", 0.5))
            evict_ids = [str(r.id) for r in to_evict[:50]]
            if evict_ids:
                await client.delete(
                    collection_name=self._collection,
                    points_selector=evict_ids,
                )
                logger.info("EpisodicStore: evicted %d old episodes", len(evict_ids))
        except Exception as exc:
            logger.debug("EpisodicStore eviction skipped: %s", exc)

    @property
    def is_available(self) -> bool:
        """True if the collection was successfully initialised."""
        return self._ready
