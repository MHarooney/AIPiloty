"""SQLite Knowledge Graph store — nodes, edges, and entity-chunk index.

Uses the existing async SQLAlchemy engine (same SQLite DB as the rest of the
app) so no new service or Docker container is needed.

Schema (auto-created via SQLAlchemy ORM):
  kg_nodes  — one row per unique entity
  kg_edges  — one row per entity co-occurrence or explicit relation
  kg_chunk_entities — many-to-many index: which entities appear in which chunks

LazyGraphRAG query path:
  1. Extract entities from user query (EntityExtractor)
  2. kg_nodes lookup → find node IDs matching query entities
  3. kg_edges lookup → expand 1-hop neighbourhood (co-occurring entities)
  4. kg_chunk_entities lookup → get Qdrant chunk IDs to fetch
  5. Boost those chunks in RRF fusion alongside vector + keyword results
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import Column, Float, Integer, String, Text, DateTime, Index
from sqlalchemy import select, text, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ....core.database import Base, async_session_factory

logger = logging.getLogger(__name__)


# ── ORM Models ────────────────────────────────────────────────────────────

class KGNode(Base):
    """A unique entity node in the knowledge graph."""
    __tablename__ = "kg_nodes"

    id = Column(String(64), primary_key=True)   # SHA-256 hash of normalised name
    name = Column(String(256), nullable=False, index=True)
    entity_type = Column(String(64), default="other")
    doc_count = Column(Integer, default=1)       # number of docs mentioning this entity
    chunk_count = Column(Integer, default=1)     # number of chunks mentioning this entity
    aliases = Column(Text, default="[]")         # JSON list of alternate names
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_kg_nodes_type", "entity_type"),
    )


class KGEdge(Base):
    """A directed edge between two entity nodes (co-occurrence or explicit relation)."""
    __tablename__ = "kg_edges"

    id = Column(Integer, primary_key=True, autoincrement=True)
    from_node = Column(String(64), nullable=False, index=True)    # FK → kg_nodes.id
    to_node = Column(String(64), nullable=False, index=True)      # FK → kg_nodes.id
    relation = Column(String(256), default="co-occurs")
    weight = Column(Float, default=1.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_kg_edges_pair", "from_node", "to_node"),
    )


class KGChunkEntity(Base):
    """Many-to-many index: which entities appear in which Qdrant chunks."""
    __tablename__ = "kg_chunk_entities"

    id = Column(Integer, primary_key=True, autoincrement=True)
    chunk_id = Column(String(256), nullable=False, index=True)    # Qdrant point UUID
    node_id = Column(String(64), nullable=False, index=True)      # FK → kg_nodes.id
    source_path = Column(String(512), default="")

    __table_args__ = (
        Index("ix_kg_chunk_entities_node", "node_id"),
    )


def _node_id(name: str) -> str:
    """Stable node ID from normalised entity name."""
    return hashlib.sha256(name.strip().lower().encode()).hexdigest()[:32]


# ── KG Store ──────────────────────────────────────────────────────────────

class GraphStore:
    """Async operations on the knowledge graph tables.

    All writes are idempotent — safe to call multiple times during re-ingest.
    All reads fall back to empty results if the tables don't exist yet.
    """

    def __init__(self) -> None:
        self._tables_ensured = False
        self._init_lock = asyncio.Lock()

    async def ensure_tables(self) -> None:
        """Create KG tables if they don't exist (no alembic needed)."""
        if self._tables_ensured:
            return
        async with self._init_lock:
            if self._tables_ensured:
                return
            try:
                from ....core.database import engine
                async with engine.begin() as conn:
                    await conn.run_sync(
                        lambda sync_conn: Base.metadata.create_all(
                            sync_conn,
                            tables=[
                                KGNode.__table__,
                                KGEdge.__table__,
                                KGChunkEntity.__table__,
                            ],
                        )
                    )
                self._tables_ensured = True
                logger.info("GraphStore: KG tables ready")
            except Exception as exc:
                logger.warning("GraphStore: could not ensure tables: %s", exc)

    # ── Write ─────────────────────────────────────────────────────────────

    async def add_entities_from_chunk(
        self,
        chunk_id: str,
        source_path: str,
        entities: List[Any],       # List[ExtractedEntity]
        relations: List[Any],      # List[ExtractedRelation]
    ) -> None:
        """Store entities + relations extracted from one chunk.

        Uses INSERT OR IGNORE + UPDATE strategy for idempotency.
        """
        if not entities:
            return
        await self.ensure_tables()

        try:
            async with async_session_factory() as session:
                entity_ids: List[str] = []

                for ent in entities:
                    nid = _node_id(ent.name)
                    entity_ids.append(nid)

                    # Upsert node
                    existing = await session.get(KGNode, nid)
                    if existing:
                        existing.chunk_count += 1
                        existing.updated_at = datetime.now(timezone.utc)
                    else:
                        session.add(KGNode(
                            id=nid,
                            name=ent.name,
                            entity_type=ent.type,
                            aliases=json.dumps(ent.aliases or []),
                        ))

                    # Chunk→entity index
                    # Only add if not already indexed for this chunk
                    result = await session.execute(
                        select(KGChunkEntity).where(
                            KGChunkEntity.chunk_id == chunk_id,
                            KGChunkEntity.node_id == nid,
                        )
                    )
                    if result.scalar_one_or_none() is None:
                        session.add(KGChunkEntity(
                            chunk_id=chunk_id,
                            node_id=nid,
                            source_path=source_path,
                        ))

                # Co-occurrence edges: link all entity pairs in this chunk
                for i in range(len(entity_ids)):
                    for j in range(i + 1, len(entity_ids)):
                        a, b = entity_ids[i], entity_ids[j]
                        # Check existing edge
                        existing_edge = await session.execute(
                            select(KGEdge).where(
                                KGEdge.from_node == a, KGEdge.to_node == b
                            )
                        )
                        edge = existing_edge.scalar_one_or_none()
                        if edge:
                            edge.weight += 0.5  # strengthen existing co-occurrence
                        else:
                            session.add(KGEdge(from_node=a, to_node=b, relation="co-occurs"))

                # Explicit relations from LLM
                for rel in relations:
                    f_id = _node_id(rel.from_entity)
                    t_id = _node_id(rel.to_entity)
                    if f_id not in entity_ids or t_id not in entity_ids:
                        continue  # only store if both nodes exist in this chunk
                    session.add(KGEdge(
                        from_node=f_id,
                        to_node=t_id,
                        relation=rel.relation[:200],
                        weight=2.0,  # explicit relations weighted higher
                    ))

                await session.commit()
        except Exception as exc:
            logger.warning("GraphStore.add_entities_from_chunk failed: %s", exc)

    # ── Read ──────────────────────────────────────────────────────────────

    async def find_nodes_by_name(self, names: List[str]) -> List[str]:
        """Return node IDs for a list of entity names (exact or partial match).

        Args:
            names: Entity names to look up (case-insensitive).

        Returns:
            List of node ID strings found in the graph.
        """
        if not names:
            return []
        await self.ensure_tables()
        try:
            async with async_session_factory() as session:
                conditions = [
                    KGNode.name.ilike(f"%{n.strip()}%") for n in names if n.strip()
                ]
                if not conditions:
                    return []
                result = await session.execute(
                    select(KGNode.id).where(or_(*conditions))
                )
                return [row[0] for row in result.all()]
        except Exception as exc:
            logger.debug("GraphStore.find_nodes_by_name: %s", exc)
            return []

    async def expand_neighborhood(
        self,
        node_ids: List[str],
        hops: int = 1,
    ) -> Set[str]:
        """Return node IDs within `hops` edges of the given seed nodes.

        Args:
            node_ids: Seed node IDs to expand from.
            hops:     Number of graph hops to traverse (default 1).

        Returns:
            Set of node IDs including seeds and their neighbors.
        """
        if not node_ids:
            return set()
        await self.ensure_tables()

        visited: Set[str] = set(node_ids)
        frontier: Set[str] = set(node_ids)

        try:
            async with async_session_factory() as session:
                for _ in range(hops):
                    if not frontier:
                        break
                    result = await session.execute(
                        select(KGEdge.from_node, KGEdge.to_node).where(
                            or_(
                                KGEdge.from_node.in_(frontier),
                                KGEdge.to_node.in_(frontier),
                            )
                        )
                    )
                    new_nodes: Set[str] = set()
                    for from_n, to_n in result.all():
                        new_nodes.add(from_n)
                        new_nodes.add(to_n)
                    frontier = new_nodes - visited
                    visited |= frontier
        except Exception as exc:
            logger.debug("GraphStore.expand_neighborhood: %s", exc)

        return visited

    async def get_chunk_ids_for_nodes(self, node_ids: Set[str]) -> List[str]:
        """Return all Qdrant chunk IDs that reference any of the given nodes."""
        if not node_ids:
            return []
        await self.ensure_tables()
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    select(KGChunkEntity.chunk_id).where(
                        KGChunkEntity.node_id.in_(node_ids)
                    ).distinct()
                )
                return [row[0] for row in result.all()]
        except Exception as exc:
            logger.debug("GraphStore.get_chunk_ids_for_nodes: %s", exc)
            return []

    # ── Stats & browsing ─────────────────────────────────────────────────

    async def get_top_entities(
        self,
        limit: int = 50,
        entity_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Return top entities by chunk_count for the KG explorer UI."""
        await self.ensure_tables()
        try:
            async with async_session_factory() as session:
                q = select(KGNode).order_by(KGNode.chunk_count.desc())
                if entity_type:
                    q = q.where(KGNode.entity_type == entity_type)
                q = q.limit(limit)
                result = await session.execute(q)
                return [
                    {
                        "id": n.id,
                        "name": n.name,
                        "type": n.entity_type,
                        "chunk_count": n.chunk_count,
                    }
                    for n in result.scalars().all()
                ]
        except Exception as exc:
            logger.debug("GraphStore.get_top_entities: %s", exc)
            return []

    async def get_entity_neighbors(
        self,
        node_id: str,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Return edges + neighbor node info for a given entity (for UI)."""
        await self.ensure_tables()
        try:
            async with async_session_factory() as session:
                result = await session.execute(
                    select(KGEdge, KGNode).join(
                        KGNode,
                        or_(
                            (KGEdge.to_node == KGNode.id) & (KGEdge.from_node == node_id),
                            (KGEdge.from_node == KGNode.id) & (KGEdge.to_node == node_id),
                        ),
                    ).order_by(KGEdge.weight.desc()).limit(limit)
                )
                neighbors = []
                for edge, node in result.all():
                    neighbors.append({
                        "neighbor_id": node.id,
                        "neighbor_name": node.name,
                        "neighbor_type": node.entity_type,
                        "relation": edge.relation,
                        "weight": edge.weight,
                    })
                return neighbors
        except Exception as exc:
            logger.debug("GraphStore.get_entity_neighbors: %s", exc)
            return []

    async def get_stats(self) -> Dict[str, Any]:
        """Return basic graph statistics."""
        await self.ensure_tables()
        try:
            async with async_session_factory() as session:
                node_count = await session.scalar(select(func.count()).select_from(KGNode))
                edge_count = await session.scalar(select(func.count()).select_from(KGEdge))
                chunk_links = await session.scalar(select(func.count()).select_from(KGChunkEntity))
                return {
                    "nodes": node_count or 0,
                    "edges": edge_count or 0,
                    "chunk_entity_links": chunk_links or 0,
                }
        except Exception as exc:
            logger.debug("GraphStore.get_stats: %s", exc)
            return {"nodes": 0, "edges": 0, "chunk_entity_links": 0}
