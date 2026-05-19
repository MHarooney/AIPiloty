"""Text chunking for RAG ingestion — heading-aware Markdown + sliding window."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List

from ...core.config import get_settings


@dataclass
class Chunk:
    """A single chunk of text with metadata."""

    content: str
    source_path: str
    chunk_index: int
    heading: str
    content_hash: str


_HEADING_RE = re.compile(r"^(#{1,4})\s+(.+)$", re.MULTILINE)


class TextChunker:
    """Split text into overlapping chunks for embedding."""

    def __init__(
        self,
        chunk_size: int | None = None,
        chunk_overlap: int | None = None,
    ) -> None:
        settings = get_settings()
        self.chunk_size = chunk_size or settings.kb_chunk_size
        self.chunk_overlap = chunk_overlap or settings.kb_chunk_overlap

    def chunk_file(self, path: str, content: str) -> List[Chunk]:
        """Chunk a file's content based on its extension."""
        ext = Path(path).suffix.lower()
        if ext in (".md", ".markdown"):
            return self._chunk_markdown(path, content)
        return self._chunk_sliding_window(path, content, heading="")

    def _chunk_markdown(self, path: str, content: str) -> List[Chunk]:
        """Split Markdown on headings, then apply sliding window per section."""
        sections: list[tuple[str, str]] = []
        positions = [(m.start(), m.group(2).strip()) for m in _HEADING_RE.finditer(content)]

        if not positions:
            return self._chunk_sliding_window(path, content, heading="")

        # Text before first heading
        if positions[0][0] > 0:
            preamble = content[: positions[0][0]].strip()
            if preamble:
                sections.append(("", preamble))

        for i, (pos, heading) in enumerate(positions):
            end = positions[i + 1][0] if i + 1 < len(positions) else len(content)
            body = content[pos:end].strip()
            if body:
                sections.append((heading, body))

        chunks: List[Chunk] = []
        for heading, body in sections:
            sub_chunks = self._chunk_sliding_window(path, body, heading)
            chunks.extend(sub_chunks)

        # Re-index after combining sections
        for i, c in enumerate(chunks):
            chunks[i] = Chunk(
                content=c.content,
                source_path=c.source_path,
                chunk_index=i,
                heading=c.heading,
                content_hash=c.content_hash,
            )
        return chunks

    def _chunk_sliding_window(self, path: str, text: str, heading: str) -> List[Chunk]:
        """Split text into fixed-size overlapping windows by character count."""
        text = text.strip()
        if not text:
            return []

        if len(text) <= self.chunk_size:
            return [
                Chunk(
                    content=text,
                    source_path=path,
                    chunk_index=0,
                    heading=heading,
                    content_hash=_hash(text),
                )
            ]

        chunks: List[Chunk] = []
        start = 0
        idx = 0
        while start < len(text):
            end = start + self.chunk_size
            fragment = text[start:end]
            chunks.append(
                Chunk(
                    content=fragment,
                    source_path=path,
                    chunk_index=idx,
                    heading=heading,
                    content_hash=_hash(fragment),
                )
            )
            idx += 1
            start += self.chunk_size - self.chunk_overlap
        return chunks


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()[:16]
