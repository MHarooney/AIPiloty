"""Semantic chunker — split text at cosine similarity breakpoints.

Instead of splitting on fixed character counts, this chunker detects natural
semantic boundaries by measuring cosine similarity between consecutive
sentence embeddings.  A sharp drop in similarity signals a topic transition —
a better split point than an arbitrary character threshold.

Algorithm (Anthropic-inspired, 2024):
  1. Split text into sentences using regex.
  2. Embed each sentence using the existing Ollama EmbeddingService.
  3. For each consecutive pair, compute cosine similarity.
  4. Identify indices where similarity drops below ``threshold``.
  5. Merge sentences between breakpoints into coherent chunks.
  6. Apply max_chars cap — oversized chunks are split further.

Trade-offs vs sliding window:
  ✅ Coherent topic boundaries
  ✅ Better recall for thematic queries
  ❌ ~4× slower (N embedding calls vs 0)
  ❌ Requires Ollama to be running

This chunker is optional (controlled by ``kb_semantic_chunk_enabled`` config)
and falls back to the standard sliding-window chunker on any failure.

Reference: Anthropic Contextual Retrieval blog (2024), "Semantic Chunking".
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, List, Optional

logger = logging.getLogger(__name__)

# ── Sentence splitting ────────────────────────────────────────────────────
_MIN_SENTENCE_LEN = 10   # ignore very short fragments


def _split_sentences(text: str) -> List[str]:
    """Split text into sentence-like fragments using punctuation + blank lines."""
    # Split at sentence-ending punctuation + space before capital, or on blank lines
    raw = re.split(r"(?<=[.!?])\s+(?=[A-Z\"\'])|(?:\n\n+)", text.strip())
    return [s.strip() for s in raw if len(s.strip()) >= _MIN_SENTENCE_LEN]


def _cosine(a: List[float], b: List[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = sum(x * x for x in a) ** 0.5
    mag_b = sum(x * x for x in b) ** 0.5
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (mag_a * mag_b)


@dataclass
class SemanticChunk:
    """A semantically-coherent chunk."""
    content: str
    source_path: str
    chunk_index: int
    heading: str
    content_hash: str


class SemanticChunker:
    """Split text at semantic breakpoints using embedding similarity.

    Args:
        embeddings:  EmbeddingService instance (Ollama).
        threshold:   Cosine similarity below this triggers a chunk split.
        max_chars:   Maximum chars per chunk (splits further if exceeded).
        fallback:    TextChunker to use when semantic chunking fails.
    """

    def __init__(
        self,
        embeddings: Any,
        threshold: float = 0.72,
        max_chars: int = 1500,
        fallback: Optional[Any] = None,
    ) -> None:
        self._emb = embeddings
        self._threshold = threshold
        self._max_chars = max_chars
        self._fallback = fallback

    async def chunk_file(self, path: str, content: str) -> List[SemanticChunk]:
        """Chunk a file semantically.

        Returns empty list on any embedding failure (caller should use fallback).
        """
        if not content.strip():
            return []

        sentences = _split_sentences(content)
        if len(sentences) < 3:
            # Too few sentences to benefit from semantic splitting
            return self._fallback_chunks(path, content)

        try:
            vectors = await self._emb.embed_batch(sentences)
        except Exception as exc:
            logger.warning("SemanticChunker embedding failed: %s — using fallback", exc)
            return self._fallback_chunks(path, content)

        # Compute similarities between adjacent sentences
        similarities = [
            _cosine(vectors[i], vectors[i + 1])
            for i in range(len(vectors) - 1)
        ]

        # Identify breakpoints (similarity drops below threshold)
        breakpoints: List[int] = [
            i + 1
            for i, sim in enumerate(similarities)
            if sim < self._threshold
        ]

        # Build raw segments from breakpoints
        segments: List[str] = []
        prev = 0
        for bp in breakpoints:
            seg = " ".join(sentences[prev:bp]).strip()
            if seg:
                segments.append(seg)
            prev = bp
        tail = " ".join(sentences[prev:]).strip()
        if tail:
            segments.append(tail)

        if not segments:
            return self._fallback_chunks(path, content)

        # Apply max_chars cap by splitting oversized segments
        chunks: List[SemanticChunk] = []
        idx = 0
        for seg in segments:
            if len(seg) <= self._max_chars:
                chunks.append(self._make_chunk(path, seg, idx))
                idx += 1
            else:
                # Split oversized segment at word boundaries
                for sub in self._split_by_chars(seg):
                    chunks.append(self._make_chunk(path, sub, idx))
                    idx += 1

        logger.info(
            "SemanticChunker: %s → %d sentences → %d breakpoints → %d chunks",
            Path(path).name, len(sentences), len(breakpoints), len(chunks),
        )
        return chunks

    def _split_by_chars(self, text: str) -> List[str]:
        """Split text into max_chars pieces at word boundaries."""
        parts: List[str] = []
        start = 0
        while start < len(text):
            end = start + self._max_chars
            if end >= len(text):
                parts.append(text[start:].strip())
                break
            # Back up to last space
            while end > start and text[end] != " ":
                end -= 1
            if end == start:
                end = start + self._max_chars
            parts.append(text[start:end].strip())
            start = end
        return [p for p in parts if p]

    def _make_chunk(self, path: str, text: str, idx: int) -> SemanticChunk:
        import hashlib
        return SemanticChunk(
            content=text,
            source_path=path,
            chunk_index=idx,
            heading=Path(path).stem,
            content_hash=hashlib.sha256(text.encode()).hexdigest()[:16],
        )

    def _fallback_chunks(self, path: str, content: str) -> List[SemanticChunk]:
        if self._fallback is None:
            return []
        raw = self._fallback.chunk_file(path, content)
        return [
            SemanticChunk(
                content=c.content,
                source_path=c.source_path,
                chunk_index=c.chunk_index,
                heading=c.heading,
                content_hash=c.content_hash,
            )
            for c in raw
        ]
