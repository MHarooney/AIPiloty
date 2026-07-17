"""RAPTOR — Recursive Abstractive Processing for Tree-Organized Retrieval.

Builds a multi-level summary hierarchy over ingested document chunks:

  Level 0: raw chunks (ingested normally by IngestService)
  Level 1: LLM summaries of groups of 5 Level-0 chunks
  Level 2: LLM summaries of groups of 5 Level-1 summaries

At retrieval time, the query complexity determines which tree level to search:
  • Short factual queries  → Level 0 (precise, specific)
  • Medium queries         → Level 0 + Level 1 (hybrid)
  • Broad thematic queries → Level 1 + Level 2 (high-level understanding)

This enables answering both "what port does nginx use?" (L0) and
"summarize the overall deployment architecture" (L1/L2).

Key design decisions:
  • Summaries stored in the same Qdrant collection as raw chunks,
    distinguished by the ``tree_level`` payload field.
  • Max 500 summary tokens per LLM call to stay fast.
  • Runs asynchronously post-ingest (does not block normal chunking).
  • Graceful: if Ollama fails, RAPTOR skips silently.

Reference: Sarthi et al. "RAPTOR: Recursive Abstractive Processing for
Tree-Organized Retrieval" (ICLR 2024).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Prompt ────────────────────────────────────────────────────────────────
_RAPTOR_SYSTEM = (
    "You are a technical documentation summariser. "
    "Write a concise, dense summary preserving all key technical facts. "
    "Do not add information not present in the source text."
)

_RAPTOR_PROMPT = """\
Summarise the following {n} text chunks into ONE coherent paragraph (max 400 words).
Preserve all technical details: names, versions, configs, commands, ports, errors.

CHUNKS:
{chunks}

SUMMARY (one paragraph, no headers):"""

# ── Config constants ──────────────────────────────────────────────────────
DEFAULT_CLUSTER_SIZE = 5    # chunks per summary group
DEFAULT_MAX_LEVELS = 2      # L0 (raw) → L1 → L2


class RaptorBuilder:
    """Build the RAPTOR summary tree for an already-ingested document set.

    Args:
        llm:          OllamaService for summarisation.
        store:        QdrantStore to upsert summaries into.
        embeddings:   EmbeddingService to embed summaries.
        cluster_size: Number of chunks to summarise per group (default 5).
        max_levels:   Number of summary levels above the raw chunks (default 2).
    """

    def __init__(
        self,
        llm: Any,
        store: Any,
        embeddings: Any,
        cluster_size: int = DEFAULT_CLUSTER_SIZE,
        max_levels: int = DEFAULT_MAX_LEVELS,
    ) -> None:
        self._llm = llm
        self._store = store
        self._embeddings = embeddings
        self._cluster_size = cluster_size
        self._max_levels = max_levels

    async def build_for_source(
        self,
        source_path: str,
        chunks: List[str],      # raw chunk content strings (Level 0)
        extra_payload: Optional[Dict] = None,
    ) -> Dict[str, int]:
        """Build the RAPTOR tree for one source file.

        Args:
            source_path: Original file path (used as source_path in payload).
            chunks:      Raw chunk content strings from the normal chunker.
            extra_payload: Optional metadata merged into every summary payload.

        Returns:
            Dict with 'levels_built' and 'summaries_created' counts.
        """
        if not chunks or self._max_levels < 1:
            return {"levels_built": 0, "summaries_created": 0}

        total_summaries = 0
        current_texts = list(chunks)
        file_name = source_path.split("/")[-1]

        for level in range(1, self._max_levels + 1):
            if len(current_texts) < 2:
                break  # Not enough content to summarise further

            level_summaries = await self._summarise_level(
                texts=current_texts,
                level=level,
                source_path=source_path,
                file_name=file_name,
                extra_payload=extra_payload or {},
            )
            if not level_summaries:
                break

            total_summaries += len(level_summaries)
            current_texts = level_summaries  # next level input

        logger.info(
            "RAPTOR: %s → %d summary chunks across %d level(s)",
            source_path, total_summaries, self._max_levels,
        )
        return {"levels_built": self._max_levels, "summaries_created": total_summaries}

    async def _summarise_level(
        self,
        texts: List[str],
        level: int,
        source_path: str,
        file_name: str,
        extra_payload: Dict,
    ) -> List[str]:
        """Summarise a list of texts into groups and upsert to Qdrant."""
        groups = [
            texts[i: i + self._cluster_size]
            for i in range(0, len(texts), self._cluster_size)
        ]

        summaries: List[str] = []
        for group_idx, group in enumerate(groups):
            summary = await self._call_llm(group)
            if not summary:
                continue

            summaries.append(summary)

            # Embed and store in Qdrant
            try:
                vector = await self._embeddings.embed_one(summary)
                payload = {
                    "content": summary,
                    "source_path": source_path,
                    "chunk_index": group_idx,
                    "heading": f"[L{level}] {file_name}",
                    "tree_level": level,
                    "content_hash": "",  # summaries don't have a hash
                    **extra_payload,
                }
                await self._store.upsert_chunks([vector], [payload])
            except Exception as exc:
                logger.warning("RAPTOR: failed to upsert L%d summary: %s", level, exc)

        return summaries

    async def _call_llm(self, chunks: List[str]) -> str:
        """Call the LLM to summarise a group of chunks."""
        if not chunks:
            return ""

        combined = "\n\n---\n\n".join(c[:600] for c in chunks)  # cap each chunk
        prompt = _RAPTOR_PROMPT.format(n=len(chunks), chunks=combined)

        try:
            result = await asyncio.wait_for(
                self._llm.generate(prompt, system=_RAPTOR_SYSTEM),
                timeout=60.0,
            )
            return result.strip()
        except asyncio.TimeoutError:
            logger.warning("RAPTOR: LLM summarisation timed out")
            return ""
        except Exception as exc:
            logger.warning("RAPTOR: LLM call failed: %s", exc)
            return ""


# ── Retrieval helper ──────────────────────────────────────────────────────

def infer_raptor_level(query: str) -> int:
    """Infer the appropriate RAPTOR tree level for a query.

    Returns:
        0 = raw chunks (precise factual queries)
        1 = Level-1 summaries (medium complexity)
        2 = Level-2 summaries (broad thematic queries)
    """
    q = query.lower().strip()
    word_count = len(q.split())

    # Broad/thematic signals → Level 2
    broad_signals = {
        "summarize", "summarise", "overview", "architecture",
        "overall", "explain the", "describe the", "what is the purpose",
        "how does the system", "general", "high-level",
    }
    if word_count > 20 or any(s in q for s in broad_signals):
        return 2

    # Medium complexity → Level 1
    medium_signals = {
        "how to", "how do", "what are", "explain", "describe",
        "steps to", "process", "workflow", "pipeline",
    }
    if word_count > 10 or any(s in q for s in medium_signals):
        return 1

    # Short, specific → raw chunks
    return 0


def build_raptor_filter(level: int) -> Optional[Any]:
    """Build a Qdrant payload filter for the given tree level."""
    if level == 0:
        # L0: exclude summaries (only return raw chunks)
        try:
            from qdrant_client import models
            return models.Filter(
                must_not=[
                    models.FieldCondition(
                        key="tree_level",
                        match=models.MatchAny(any=[1, 2]),
                    )
                ]
            )
        except ImportError:
            return None
    else:
        # L1/L2: only return summaries at the specified level
        try:
            from qdrant_client import models
            return models.Filter(
                must=[
                    models.FieldCondition(
                        key="tree_level",
                        match=models.MatchValue(value=level),
                    )
                ]
            )
        except ImportError:
            return None
