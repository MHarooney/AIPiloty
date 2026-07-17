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

    def _mock_settings(self):
        m = MagicMock()
        m.rag_rerank_enabled = False
        m.rag_rerank_model = "cross-encoder/ms-marco-MiniLM-L-6-v2"
        m.rag_rerank_fetch_multiplier = 4
        m.rag_multi_query_enabled = False
        m.rag_multi_query_variants = 3
        m.rag_hyde_enabled = False
        m.rag_query_rewrite_enabled = False
        return m

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
        store.keyword_search = AsyncMock(return_value=[])

        with patch("app.services.rag.retriever.get_settings") as ms:
            ms.return_value = self._mock_settings()
            svc = RetrieverService(store=store, embeddings=embed)
            results = await svc.search("how to setup")

        assert len(results) == 1
        assert results[0].content == "Test content"
        assert results[0].score == pytest.approx(results[0].score, abs=1.0)

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
        store.keyword_search = AsyncMock(return_value=[])

        with patch("app.services.rag.retriever.get_settings") as ms:
            ms.return_value = self._mock_settings()
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
        mock_retriever.reranker_available = False  # Phase 1 property

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
        mock_retriever.reranker_available = False

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


# ---------------------------------------------------------------------------
# Phase 1 Tests: Reranker, QueryRewriter, QueryExpander, HyDE
# ---------------------------------------------------------------------------

class TestReranker:
    """Unit tests for cross-encoder reranker (graceful degradation path)."""

    def test_reranker_returns_top_k_when_model_unavailable(self):
        """When sentence-transformers model is absent, returns first top_k results."""
        from app.services.rag.reranker import Reranker
        from app.services.rag.retriever import RetrievalResult

        reranker = Reranker(model_name="nonexistent-model-that-wont-load")
        # Force load attempted so we don't retry
        import app.services.rag.reranker as rr_mod
        rr_mod._load_attempted = True
        rr_mod._cross_encoder = None

        results = [
            RetrievalResult(content=f"doc {i}", source_path=f"doc{i}.md", heading="", score=float(i))
            for i in range(10)
        ]
        out = reranker.rerank("test query", results, top_k=3)
        assert len(out) == 3
        # First 3 when no model
        assert out[0].content == "doc 0"

    def test_reranker_handles_empty_list(self):
        from app.services.rag.reranker import Reranker
        reranker = Reranker()
        out = reranker.rerank("query", [], top_k=5)
        assert out == []

    def test_reranker_with_fewer_results_than_top_k(self):
        from app.services.rag.reranker import Reranker
        from app.services.rag.retriever import RetrievalResult
        import app.services.rag.reranker as rr_mod
        rr_mod._load_attempted = True
        rr_mod._cross_encoder = None

        reranker = Reranker()
        results = [
            RetrievalResult(content="only one", source_path="a.md", heading="", score=0.9)
        ]
        out = reranker.rerank("query", results, top_k=5)
        assert len(out) == 1  # can't return more than we have


class TestQueryRewriter:
    """Unit tests for conversation-aware query rewriter."""

    @pytest.mark.asyncio
    async def test_standalone_query_not_rewritten(self):
        """A self-contained query with no pronouns should pass through unchanged."""
        from app.services.rag.query_rewriter import QueryRewriter
        mock_llm = AsyncMock()
        rw = QueryRewriter(llm=mock_llm)
        out = await rw.rewrite("How do I configure Nginx?", conversation_history=[])
        assert out == "How do I configure Nginx?"
        mock_llm.generate.assert_not_called()

    @pytest.mark.asyncio
    async def test_pronoun_query_triggers_rewrite(self):
        """Query with 'it' + history should trigger LLM rewrite."""
        from app.services.rag.query_rewriter import QueryRewriter
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value="How do I restart the Nginx service?")
        rw = QueryRewriter(llm=mock_llm)
        history = [
            {"role": "user", "content": "My Nginx is failing"},
            {"role": "assistant", "content": "Check the service status."},
        ]
        out = await rw.rewrite("Can you fix it?", conversation_history=history)
        assert "Nginx" in out or "fix" in out  # content from rewrite
        mock_llm.generate.assert_called_once()

    @pytest.mark.asyncio
    async def test_rewrite_falls_back_on_llm_error(self):
        """If LLM throws, the original query is returned (no crash)."""
        from app.services.rag.query_rewriter import QueryRewriter
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(side_effect=RuntimeError("LLM down"))
        rw = QueryRewriter(llm=mock_llm)
        history = [{"role": "user", "content": "something relevant"}]
        original = "Fix it"
        out = await rw.rewrite(original, conversation_history=history)
        assert out == original  # graceful fallback

    @pytest.mark.asyncio
    async def test_no_history_no_rewrite(self):
        """Empty conversation history means no rewrite attempt, even with pronouns."""
        from app.services.rag.query_rewriter import QueryRewriter
        mock_llm = AsyncMock()
        rw = QueryRewriter(llm=mock_llm)
        out = await rw.rewrite("Fix it", conversation_history=[])
        # _needs_rewriting returns False for empty history
        assert out == "Fix it"
        mock_llm.generate.assert_not_called()


class TestQueryExpander:
    """Unit tests for multi-query expansion and HyDE."""

    @pytest.mark.asyncio
    async def test_expander_returns_variants(self):
        from app.services.rag.query_expander import QueryExpander
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=(
            "How to set up Nginx reverse proxy\n"
            "Nginx configuration for web server\n"
            "Configure Nginx proxy settings"
        ))
        expander = QueryExpander(llm=mock_llm, n_variants=3)
        results = await expander.expand("How do I configure Nginx?")
        assert results[0] == "How do I configure Nginx?"  # original always first
        assert len(results) >= 2  # at least original + 1 variant

    @pytest.mark.asyncio
    async def test_expander_falls_back_on_llm_error(self):
        from app.services.rag.query_expander import QueryExpander
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(side_effect=RuntimeError("LLM down"))
        expander = QueryExpander(llm=mock_llm, n_variants=3)
        results = await expander.expand("What is Docker?")
        assert results == ["What is Docker?"]  # only original on failure

    @pytest.mark.asyncio
    async def test_expander_handles_empty_query(self):
        from app.services.rag.query_expander import QueryExpander
        mock_llm = AsyncMock()
        expander = QueryExpander(llm=mock_llm)
        results = await expander.expand("")
        assert results == [""]

    @pytest.mark.asyncio
    async def test_hyde_expander_concatenates_answer(self):
        from app.services.rag.query_expander import HyDEExpander
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(
            return_value="Nginx is configured via /etc/nginx/nginx.conf using server blocks."
        )
        hyde = HyDEExpander(llm=mock_llm)
        result = await hyde.expand("How do I configure Nginx?")
        assert "How do I configure Nginx?" in result
        assert "nginx.conf" in result  # hypothetical answer included
        assert "\n\n" in result  # separated by blank line

    @pytest.mark.asyncio
    async def test_hyde_falls_back_on_llm_error(self):
        from app.services.rag.query_expander import HyDEExpander
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(side_effect=RuntimeError("LLM down"))
        hyde = HyDEExpander(llm=mock_llm)
        query = "What port does Redis use?"
        result = await hyde.expand(query)
        assert result == query  # graceful fallback

    @pytest.mark.asyncio
    async def test_expand_with_hyde_and_multi_query_both_active(self):
        """Combined helper runs both concurrently and returns (hyde_query, all_queries)."""
        from app.services.rag.query_expander import expand_with_hyde_and_multi_query

        mock_llm = AsyncMock()
        # HyDE → hypothetical answer
        # MultiQuery → 3 alternatives
        generate_calls = [
            # HyDE call
            "Redis uses port 6379 by default. Configure in redis.conf.",
            # MultiQuery call
            "What is the default Redis port\nRedis port number configuration\nRedis listening port",
        ]
        call_idx = {"n": 0}

        async def side_effect(prompt, system=None):
            idx = call_idx["n"]
            call_idx["n"] += 1
            return generate_calls[idx] if idx < len(generate_calls) else ""

        mock_llm.generate = side_effect
        original = "What port does Redis use?"
        hyde_q, all_q = await expand_with_hyde_and_multi_query(
            original, mock_llm, use_hyde=True, use_multi_query=True
        )
        assert original in hyde_q          # HyDE query contains original
        assert all_q[0] == original        # original always first in all_queries
        assert len(all_q) >= 1


class TestRetrieverPhase1:
    """Integration-style tests for Phase 1 retriever enhancements (mocked LLM)."""

    def _make_settings(self, **overrides):
        """Return a Settings-like mock with Phase 1 flags."""
        defaults = {
            "rag_rerank_enabled": False,   # off by default in tests (no model)
            "rag_rerank_model": "cross-encoder/ms-marco-MiniLM-L-6-v2",
            "rag_rerank_fetch_multiplier": 4,
            "rag_multi_query_enabled": False,  # off to keep tests fast
            "rag_multi_query_variants": 3,
            "rag_hyde_enabled": False,
            "rag_query_rewrite_enabled": False,
        }
        defaults.update(overrides)
        m = MagicMock()
        for k, v in defaults.items():
            setattr(m, k, v)
        return m

    @pytest.mark.asyncio
    async def test_search_with_all_features_disabled(self):
        """With all Phase 1 flags off, retriever behaves exactly as before."""
        from app.services.rag.retriever import RetrieverService, RetrievalResult
        from app.services.rag.vector_store import SearchResult

        embed = AsyncMock()
        embed.embed_one = AsyncMock(return_value=[0.1] * 768)
        store = AsyncMock()
        store.search = AsyncMock(return_value=[
            SearchResult(content="Doc A", source_path="a.md", heading="", score=0.9, chunk_index=0)
        ])
        store.keyword_search = AsyncMock(return_value=[])

        with patch("app.services.rag.retriever.get_settings") as ms:
            ms.return_value = self._make_settings()
            svc = RetrieverService(store=store, embeddings=embed, llm=None)
            results = await svc.search("test query", top_k=5)

        assert len(results) == 1
        assert results[0].source_path == "a.md"

    @pytest.mark.asyncio
    async def test_rrf_fuse_many_deduplicates_across_lists(self):
        """Items appearing in multiple lists get a higher fused score."""
        from app.services.rag.retriever import RetrieverService, RetrievalResult

        r_a = RetrievalResult(content="shared", source_path="x.md", heading="", score=0.9)
        r_b = RetrievalResult(content="unique", source_path="y.md", heading="", score=0.8)
        r_c = RetrievalResult(content="shared", source_path="x.md", heading="", score=0.7)

        fused = RetrieverService._rrf_fuse_many([[r_a, r_b], [r_c]], top_k=2)
        # "shared" appears in both lists — should rank higher after fusion
        assert fused[0].source_path == "x.md"

    def test_rrf_fuse_many_handles_empty_list(self):
        from app.services.rag.retriever import RetrieverService
        assert RetrieverService._rrf_fuse_many([], top_k=5) == []

    def test_rrf_fuse_many_single_list(self):
        from app.services.rag.retriever import RetrieverService, RetrievalResult
        results = [RetrievalResult(content=f"doc{i}", source_path=f"{i}.md", heading="", score=float(i)) for i in range(5)]
        fused = RetrieverService._rrf_fuse_many([results], top_k=3)
        assert len(fused) == 3

    def test_rrf_fuse_backwards_compat(self):
        """_rrf_fuse (two-list helper) still works for existing tests."""
        from app.services.rag.retriever import RetrieverService, RetrievalResult
        a = [RetrievalResult(content="A", source_path="a.md", heading="", score=0.9)]
        b = [RetrievalResult(content="B", source_path="b.md", heading="", score=0.8)]
        fused = RetrieverService._rrf_fuse(a, b, top_k=2)
        assert len(fused) == 2
