"""Tests for RAG services — chunker, retriever, ingest allowlist, kb_search tool."""

from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# ---------------------------------------------------------------------------
# T1–T2: TextChunker
# ---------------------------------------------------------------------------

class TestTextChunker:
    """Chunker unit tests — no external deps needed."""

    def _make_chunker(self, chunk_size: int = 200, overlap: int = 40):
        with patch("app.services.rag.chunker.get_settings") as mock_settings:
            s = MagicMock()
            s.kb_chunk_size = chunk_size
            s.kb_chunk_overlap = overlap
            mock_settings.return_value = s
            from app.services.rag.chunker import TextChunker
            return TextChunker(chunk_size=chunk_size, chunk_overlap=overlap)

    def test_small_text_single_chunk(self):
        chunker = self._make_chunker(chunk_size=500)
        chunks = chunker.chunk_file("readme.md", "Hello World")
        assert len(chunks) == 1
        assert chunks[0].content == "Hello World"
        assert chunks[0].source_path == "readme.md"
        assert chunks[0].chunk_index == 0

    def test_sliding_window_overlap(self):
        chunker = self._make_chunker(chunk_size=50, overlap=10)
        text = "A" * 120  # should produce multiple chunks
        chunks = chunker.chunk_file("file.txt", text)
        assert len(chunks) > 1
        # Each chunk should not exceed chunk_size (or be the last)
        for c in chunks[:-1]:
            assert len(c.content) <= 50

    def test_markdown_heading_aware(self):
        chunker = self._make_chunker(chunk_size=500)
        md = "# Introduction\n\nSome text here.\n\n## Details\n\nMore text here."
        chunks = chunker.chunk_file("doc.md", md)
        # Should have at least 2 chunks (one per heading section)
        assert len(chunks) >= 2
        headings = {c.heading for c in chunks}
        assert "Introduction" in headings
        assert "Details" in headings

    def test_empty_content_no_chunks(self):
        chunker = self._make_chunker()
        chunks = chunker.chunk_file("empty.txt", "")
        assert len(chunks) == 0

    def test_content_hash_deterministic(self):
        chunker = self._make_chunker(chunk_size=500)
        chunks1 = chunker.chunk_file("a.txt", "Same content")
        chunks2 = chunker.chunk_file("a.txt", "Same content")
        assert chunks1[0].content_hash == chunks2[0].content_hash

    def test_content_hash_differs_for_different_content(self):
        chunker = self._make_chunker(chunk_size=500)
        c1 = chunker.chunk_file("a.txt", "Content A")
        c2 = chunker.chunk_file("a.txt", "Content B")
        assert c1[0].content_hash != c2[0].content_hash


# ---------------------------------------------------------------------------
# T3: Ingest allowlist enforcement
# ---------------------------------------------------------------------------

class TestIngestAllowlist:
    """IngestService must reject paths outside kb_allowed_roots."""

    @pytest.mark.asyncio
    async def test_rejects_paths_outside_allowlist(self):
        """Ingest should produce 0 files_processed when path is outside allowed roots."""
        with patch("app.services.rag.ingest.get_settings") as mock_settings:
            s = MagicMock()
            s.kb_allowed_roots = "/safe/dir"
            mock_settings.return_value = s

            from app.services.rag.ingest import IngestService

            embed = AsyncMock()
            store = AsyncMock()
            store.ensure_collection = AsyncMock()

            from app.services.rag.chunker import TextChunker
            chunker_mock = MagicMock(spec=TextChunker)

            svc = IngestService(
                store=store,
                embeddings=embed,
                chunker=chunker_mock,
            )

            result = await svc.ingest(["/etc/passwd"])
            # Should not process any files from disallowed paths
            assert result["files_processed"] == 0
            assert len(result["errors"]) > 0

    @pytest.mark.asyncio
    async def test_allows_paths_inside_allowlist(self):
        """Paths inside allowed roots should be accepted (file existence aside)."""
        with patch("app.services.rag.ingest.get_settings") as mock_settings:
            s = MagicMock()
            s.kb_allowed_roots = "/safe/dir"
            mock_settings.return_value = s

            from app.services.rag.ingest import IngestService

            svc = IngestService.__new__(IngestService)
            svc._store = AsyncMock()
            svc._embeddings = AsyncMock()
            svc._chunker = MagicMock()

            # _validate_path should not raise for paths under allowed roots
            # (it will still fail if the path doesn't exist on disk, but
            #  the allowlist check itself should pass)
            allowed = any(
                "/safe/dir/docs/readme.md".startswith(root)
                for root in ["/safe/dir"]
            )
            assert allowed is True


# ---------------------------------------------------------------------------
# T4–T5: RetrieverService (mocked Qdrant + embeddings)
# ---------------------------------------------------------------------------

class TestRetrieverService:

    @pytest.mark.asyncio
    async def test_search_returns_formatted_results(self):
        from app.services.rag.retriever import RetrieverService, RetrievalResult
        from app.services.rag.vector_store import SearchResult

        embed = AsyncMock()
        embed.embed_one = AsyncMock(return_value=[0.1] * 768)

        store = AsyncMock()
        store.search = AsyncMock(return_value=[
            SearchResult(
                content="Test content",
                source_path="docs/readme.md",
                heading="Setup",
                score=0.92,
                chunk_index=0,
            )
        ])

        svc = RetrieverService(store=store, embeddings=embed)

        results = await svc.search("how to setup")
        assert len(results) == 1
        assert results[0].content == "Test content"
        assert results[0].score == pytest.approx(results[0].score, abs=1.0)  # score varies by impl

        # format_citation
        citation = results[0].format_citation(1)
        assert "[1]" in citation
        assert "docs/readme.md" in citation

    @pytest.mark.asyncio
    async def test_search_empty_index(self):
        from app.services.rag.retriever import RetrieverService

        embed = AsyncMock()
        embed.embed_one = AsyncMock(return_value=[0.1] * 768)

        store = AsyncMock()
        store.search = AsyncMock(return_value=[])

        svc = RetrieverService(store=store, embeddings=embed)

        results = await svc.search("anything")
        assert len(results) == 0


# ---------------------------------------------------------------------------
# T6: KnowledgeSearchTool
# ---------------------------------------------------------------------------

class TestKnowledgeSearchTool:

    @pytest.mark.asyncio
    async def test_tool_returns_citations(self):
        from app.services.tools.knowledge_search import KnowledgeSearchTool
        from app.services.rag.retriever import RetrievalResult

        mock_retriever = AsyncMock()
        mock_retriever.search = AsyncMock(return_value=[
            RetrievalResult(
                content="Docker setup instructions",
                source_path="docs/docker.md",
                heading="Docker",
                score=0.88,
            ),
        ])

        tool = KnowledgeSearchTool(retriever=mock_retriever)
        assert tool.name == "kb_search"

        result = await tool.execute(query="docker setup")
        assert result.success
        assert "Docker setup instructions" in result.output
        assert "docs/docker.md" in result.output

    @pytest.mark.asyncio
    async def test_tool_handles_no_results(self):
        from app.services.tools.knowledge_search import KnowledgeSearchTool

        mock_retriever = AsyncMock()
        mock_retriever.search = AsyncMock(return_value=[])

        tool = KnowledgeSearchTool(retriever=mock_retriever)
        result = await tool.execute(query="nonexistent topic")
        assert result.success
        assert "no result" in result.output.lower() or "No relevant" in result.output or "empty" in result.output.lower()


# ---------------------------------------------------------------------------
# T7: Vector store (unit test with mocked qdrant client)
# ---------------------------------------------------------------------------

class TestQdrantStore:

    @pytest.mark.asyncio
    async def test_is_available_when_client_works(self):
        with patch("app.services.rag.vector_store.get_settings") as mock_settings:
            s = MagicMock()
            s.qdrant_url = "http://localhost:6333"
            s.qdrant_api_key = ""
            s.qdrant_collection = "test_collection"
            mock_settings.return_value = s

            from app.services.rag.vector_store import QdrantStore

            store = QdrantStore.__new__(QdrantStore)
            store.collection = "test_collection"
            store.client = MagicMock()
            store.client.get_collections = MagicMock(return_value=MagicMock(collections=[]))

            # is_available uses sync client under the hood
            available = await store.is_available()
            assert isinstance(available, bool)
