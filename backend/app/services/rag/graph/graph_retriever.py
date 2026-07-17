"""Graph Retriever — LazyGraphRAG entity-aware chunk expansion.

Implements the core LazyGraphRAG retrieval pattern:

  1. Extract named entities from the user query (EntityExtractor)
  2. Look up matching nodes in the knowledge graph (GraphStore)
  3. Expand 1-hop neighbourhood (entity co-occurrence graph)
  4. Fetch all Qdrant chunk IDs associated with those nodes
  5. Retrieve those chunks from Qdrant by ID (with scores)
  6. Return as RetrievalResult list for RRF fusion

This is the «connected context» step in the Graph RAG column of the attached
architecture diagram.  Because entities are indexed at ingest time, retrieval
is fast — just 3 lightweight SQLite queries + one Qdrant multi-get.

Reference: LazyGraphRAG (Microsoft, Jan 2025).
"""

from __future__ import annotations

import logging
from typing import Any, List, Optional

logger = logging.getLogger(__name__)


class GraphRetriever:
    """Retrieve chunks via the knowledge graph entity index.

    Args:
        graph_store:      GraphStore instance (SQLite KG).
        entity_extractor: EntityExtractor instance (Ollama NER).
        qdrant_store:     QdrantStore instance (for chunk fetching by ID).
        embeddings:       EmbeddingService (for fallback vector scoring).
        hops:             Graph traversal depth (1 = direct neighbours only).
    """

    def __init__(
        self,
        graph_store: Any,       # GraphStore
        entity_extractor: Any,  # EntityExtractor
        qdrant_store: Any,      # QdrantStore
        embeddings: Any,        # EmbeddingService
        hops: int = 1,
    ) -> None:
        self._graph = graph_store
        self._extractor = entity_extractor
        self._store = qdrant_store
        self._embeddings = embeddings
        self._hops = hops

    async def search(
        self,
        query: str,
        top_k: int = 10,
        notebook_id: Optional[str] = None,
    ) -> "List[Any]":   # List[RetrievalResult]
        """Graph-aware search: entity → graph → chunk IDs → Qdrant fetch.

        Returns:
            List of RetrievalResult, possibly empty if no entity matches found.
        """
        if not query.strip():
            return []

        # Step 1: Extract entities from query
        try:
            extraction = await self._extractor.extract(query)
        except Exception as exc:
            logger.debug("GraphRetriever entity extraction failed: %s", exc)
            return []

        if not extraction.entities:
            logger.debug("GraphRetriever: no entities found in query %r", query[:60])
            return []

        entity_names = [e.name for e in extraction.entities]
        logger.info(
            "GraphRetriever: query entities=%s",
            entity_names[:5],
        )

        # Step 2: Find matching KG nodes
        seed_node_ids = await self._graph.find_nodes_by_name(entity_names)
        if not seed_node_ids:
            logger.debug("GraphRetriever: no KG nodes found for entities %s", entity_names)
            return []

        # Step 3: Expand neighbourhood (co-occurrence graph)
        all_node_ids = await self._graph.expand_neighborhood(seed_node_ids, hops=self._hops)

        # Step 4: Get Qdrant chunk IDs from the expanded neighbourhood
        chunk_ids = await self._graph.get_chunk_ids_for_nodes(all_node_ids)
        if not chunk_ids:
            return []

        logger.info(
            "GraphRetriever: %d seed nodes → %d expanded nodes → %d chunk IDs",
            len(seed_node_ids), len(all_node_ids), len(chunk_ids),
        )

        # Step 5: Retrieve those specific chunks from Qdrant by their IDs
        return await self._fetch_chunks_by_ids(
            query=query,
            chunk_ids=chunk_ids[:top_k * 3],   # cap to avoid huge fetches
            top_k=top_k,
            notebook_id=notebook_id,
        )

    async def _fetch_chunks_by_ids(
        self,
        query: str,
        chunk_ids: List[str],
        top_k: int,
        notebook_id: Optional[str],
    ) -> "List[Any]":  # List[RetrievalResult]
        """Fetch chunks from Qdrant by source_path (extracted from stable KG chunk IDs).

        KG chunk IDs use the format: ``source_path::chunk_index``.
        We extract unique source_paths and fetch all chunks from those files,
        then filter down to the specific chunk indices.
        """
        from ..retriever import RetrievalResult
        from qdrant_client import models

        if not chunk_ids:
            return []

        # Parse chunk_ids → {source_path: [chunk_indices]}
        source_to_indices: dict[str, list[int]] = {}
        for cid in chunk_ids:
            if "::" in cid:
                parts = cid.rsplit("::", 1)
                src = parts[0]
                try:
                    idx = int(parts[1])
                except ValueError:
                    idx = -1
                source_to_indices.setdefault(src, []).append(idx)
            else:
                # Legacy: treat whole string as source_path
                source_to_indices.setdefault(cid, [])

        unique_sources = list(source_to_indices.keys())[:20]  # cap to avoid huge fetches

        try:
            client = await self._store._get_client()
            results: List[RetrievalResult] = []

            for source_path in unique_sources:
                wanted_indices = set(source_to_indices.get(source_path, []))

                # Build Qdrant filter for this source_path
                filters: list = [
                    models.FieldCondition(
                        key="source_path",
                        match=models.MatchValue(value=source_path),
                    )
                ]
                if notebook_id:
                    filters.append(
                        models.FieldCondition(
                            key="notebook_id",
                            match=models.MatchValue(value=notebook_id),
                        )
                    )

                records, _ = await client.scroll(
                    collection_name=self._store._collection,
                    scroll_filter=models.Filter(must=filters),
                    limit=50,
                    with_payload=True,
                    with_vectors=False,
                )

                for rec in records:
                    payload = rec.payload or {}
                    chunk_index = payload.get("chunk_index", -1)
                    # Include if this specific chunk index was referenced, or all if no specific indices
                    if not wanted_indices or chunk_index in wanted_indices:
                        results.append(RetrievalResult(
                            content=payload.get("content", ""),
                            source_path=source_path,
                            heading=payload.get("heading", ""),
                            score=0.6,   # graph-retrieved baseline score
                        ))

            return results[:top_k]

        except Exception as exc:
            logger.warning("GraphRetriever._fetch_chunks_by_ids failed: %s", exc)
            return []

    @property
    def is_available(self) -> bool:
        """True if all required components are accessible."""
        return (
            self._graph is not None
            and self._extractor is not None
            and self._store is not None
        )
