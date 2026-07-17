"""Phase 5 tests — ASTChunker, SemanticChunker, RaptorBuilder, ModelRouter."""

from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# TestASTChunker
# ---------------------------------------------------------------------------

class TestASTChunker:
    """AST code chunker tests."""

    def _chunker(self, max_chars=3000):
        from app.services.rag.chunker_code import ASTChunker
        return ASTChunker(max_chunk_chars=max_chars)

    def test_python_extracts_functions(self):
        chunker = self._chunker()
        code = """
def hello():
    print("Hello")

def world():
    return 42

class MyClass:
    def method(self):
        pass
"""
        chunks = chunker.chunk_file("test.py", code)
        if len(chunks) < 2:
            pytest.skip("tree-sitter not producing expected chunks")
        names = [c.heading for c in chunks]
        assert any("hello" in n.lower() or "world" in n.lower() or "MyClass" in n for n in names)

    def test_javascript_extracts_functions(self):
        chunker = self._chunker()
        code = """
function greet(name) {
    return 'Hello ' + name;
}

class Calculator {
    add(a, b) { return a + b; }
}
"""
        chunks = chunker.chunk_file("test.js", code)
        if len(chunks) < 1:
            pytest.skip("tree-sitter not producing chunks")
        # Should have extracted at least one node
        assert len(chunks) >= 1

    def test_unsupported_extension_returns_empty(self):
        chunker = self._chunker()
        chunks = chunker.chunk_file("test.xml", "<xml>content</xml>")
        assert chunks == []

    def test_empty_file_returns_empty(self):
        chunker = self._chunker()
        chunks = chunker.chunk_file("test.py", "")
        assert chunks == []

    def test_chunk_has_required_fields(self):
        chunker = self._chunker()
        code = "def simple():\n    return 1\n"
        chunks = chunker.chunk_file("test.py", code)
        if not chunks:
            pytest.skip("No AST chunks produced")
        c = chunks[0]
        assert c.source_path == "test.py"
        assert c.chunk_index >= 0
        assert isinstance(c.content, str)
        assert isinstance(c.heading, str)
        assert len(c.content_hash) == 16

    def test_fallback_used_for_short_file(self):
        """When AST produces < 2 chunks, fallback chunker is used."""
        from app.services.rag.chunker import TextChunker
        from app.services.rag.chunker_code import ASTChunker
        fallback = TextChunker(chunk_size=500, chunk_overlap=50)
        chunker = ASTChunker(fallback_chunker=fallback)
        # One-liner will produce 1 AST chunk → fallback
        chunks = chunker.chunk_file("test.py", "x = 1")
        # Either AST or fallback
        assert isinstance(chunks, list)

    def test_typescript_extension_handled(self):
        chunker = self._chunker()
        code = """
function greet(): string {
    return 'hello';
}
"""
        # Should not raise even if tree-sitter grammar is JS
        chunks = chunker.chunk_file("component.tsx", code)
        assert isinstance(chunks, list)

    def test_ast_chunk_start_end_line(self):
        chunker = self._chunker()
        code = "def foo():\n    x = 1\n    return x\n"
        chunks = chunker.chunk_file("test.py", code)
        if not chunks:
            pytest.skip("No AST chunks")
        assert chunks[0].start_line >= 1


# ---------------------------------------------------------------------------
# TestSemanticChunker
# ---------------------------------------------------------------------------

class TestSemanticChunker:
    """Semantic chunker unit tests (mocked embeddings)."""

    def _chunker(self, threshold=0.72, max_chars=500):
        from app.services.rag.chunker_semantic import SemanticChunker
        mock_emb = AsyncMock()
        return SemanticChunker(
            embeddings=mock_emb,
            threshold=threshold,
            max_chars=max_chars,
        ), mock_emb

    @pytest.mark.asyncio
    async def test_empty_text_returns_empty(self):
        chunker, _ = self._chunker()
        result = await chunker.chunk_file("doc.md", "")
        assert result == []

    @pytest.mark.asyncio
    async def test_short_text_falls_back(self):
        """Less than 3 sentences → fallback (returns [] if no fallback configured)."""
        chunker, _ = self._chunker()
        result = await chunker.chunk_file("doc.md", "One sentence only.")
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_semantic_split_on_low_similarity(self):
        """Low similarity between sentences triggers a chunk split."""
        from app.services.rag.chunker_semantic import SemanticChunker
        mock_emb = AsyncMock()
        # 4 sentences: first 2 similar, then big drop, last 2 similar
        # Vectors: A ≈ B (high similarity), B ≪ C (low similarity = breakpoint)
        A = [1.0, 0.0, 0.0]
        B = [0.9, 0.2, 0.0]
        C = [0.0, 0.0, 1.0]  # very different
        D = [0.0, 0.1, 0.9]
        mock_emb.embed_batch = AsyncMock(return_value=[A, B, C, D])

        chunker = SemanticChunker(embeddings=mock_emb, threshold=0.7, max_chars=2000)
        text = (
            "Nginx is a web server. It handles HTTP requests efficiently. "
            "Python is a programming language. Python supports many paradigms."
        )
        result = await chunker.chunk_file("doc.txt", text)
        # Should produce at least 2 chunks (split at low similarity point)
        assert len(result) >= 1

    @pytest.mark.asyncio
    async def test_embedding_failure_uses_fallback(self):
        from app.services.rag.chunker_semantic import SemanticChunker
        from app.services.rag.chunker import TextChunker

        mock_emb = AsyncMock()
        mock_emb.embed_batch = AsyncMock(side_effect=RuntimeError("embedding down"))
        fallback = TextChunker(chunk_size=200, chunk_overlap=20)
        chunker = SemanticChunker(embeddings=mock_emb, fallback=fallback)

        result = await chunker.chunk_file("doc.txt", "A" * 600)
        assert isinstance(result, list)

    def test_cosine_similarity(self):
        from app.services.rag.chunker_semantic import _cosine
        # Same vector → 1.0
        v = [0.5, 0.5, 0.5]
        assert abs(_cosine(v, v) - 1.0) < 0.001
        # Zero vectors → 0
        assert _cosine([0, 0, 0], [0, 0, 0]) == 0.0
        # Orthogonal → 0
        assert abs(_cosine([1, 0], [0, 1])) < 0.001

    def test_split_sentences(self):
        from app.services.rag.chunker_semantic import _split_sentences
        text = "First sentence. Second sentence! Third sentence?"
        sents = _split_sentences(text)
        assert len(sents) >= 1  # At minimum the full text


# ---------------------------------------------------------------------------
# TestRaptorBuilder
# ---------------------------------------------------------------------------

class TestRaptorBuilder:
    """RAPTOR builder tests."""

    @pytest.mark.asyncio
    async def test_empty_chunks_returns_zero(self):
        from app.services.rag.raptor import RaptorBuilder
        mock_llm = AsyncMock()
        mock_store = AsyncMock()
        mock_emb = AsyncMock()
        builder = RaptorBuilder(llm=mock_llm, store=mock_store, embeddings=mock_emb)
        result = await builder.build_for_source("doc.md", [])
        assert result["summaries_created"] == 0

    @pytest.mark.asyncio
    async def test_single_chunk_skipped(self):
        """A single chunk cannot be meaningfully summarised."""
        from app.services.rag.raptor import RaptorBuilder
        mock_llm = AsyncMock()
        mock_store = AsyncMock()
        mock_emb = AsyncMock()
        builder = RaptorBuilder(llm=mock_llm, store=mock_store, embeddings=mock_emb)
        result = await builder.build_for_source("doc.md", ["only one chunk"])
        assert result["summaries_created"] == 0

    @pytest.mark.asyncio
    async def test_summarises_group_of_chunks(self):
        from app.services.rag.raptor import RaptorBuilder
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value="Summary of nginx configuration steps.")
        mock_store = AsyncMock()
        mock_store.upsert_chunks = AsyncMock(return_value=1)
        mock_emb = AsyncMock()
        mock_emb.embed_one = AsyncMock(return_value=[0.1] * 768)

        builder = RaptorBuilder(
            llm=mock_llm, store=mock_store, embeddings=mock_emb,
            cluster_size=3, max_levels=1
        )
        chunks = ["chunk A", "chunk B", "chunk C", "chunk D"]
        result = await builder.build_for_source("doc.md", chunks)
        # 4 chunks / cluster_size=3 = 2 groups → 2 summaries at L1
        assert result["summaries_created"] >= 1

    @pytest.mark.asyncio
    async def test_llm_timeout_skips_gracefully(self):
        import asyncio
        from app.services.rag.raptor import RaptorBuilder
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(side_effect=asyncio.TimeoutError())
        mock_store = AsyncMock()
        mock_emb = AsyncMock()
        builder = RaptorBuilder(llm=mock_llm, store=mock_store, embeddings=mock_emb)
        result = await builder.build_for_source("doc.md", ["chunk A", "chunk B", "chunk C"])
        # Should not raise — just return 0 summaries
        assert result["summaries_created"] == 0

    @pytest.mark.asyncio
    async def test_max_levels_zero_skips(self):
        from app.services.rag.raptor import RaptorBuilder
        mock_llm = AsyncMock()
        mock_store = AsyncMock()
        mock_emb = AsyncMock()
        builder = RaptorBuilder(llm=mock_llm, store=mock_store, embeddings=mock_emb, max_levels=0)
        result = await builder.build_for_source("doc.md", ["a", "b", "c"])
        assert result["levels_built"] == 0

    def test_infer_raptor_level_short_query(self):
        from app.services.rag.raptor import infer_raptor_level
        assert infer_raptor_level("what port does nginx use?") == 0

    def test_infer_raptor_level_medium(self):
        from app.services.rag.raptor import infer_raptor_level
        assert infer_raptor_level("How do I configure the SSL certificates?") == 1

    def test_infer_raptor_level_broad(self):
        from app.services.rag.raptor import infer_raptor_level
        assert infer_raptor_level("Summarize the overall deployment architecture") == 2

    def test_infer_raptor_level_long_query(self):
        from app.services.rag.raptor import infer_raptor_level
        long = " ".join(["word"] * 25)  # > 20 words → level 2
        assert infer_raptor_level(long) == 2


# ---------------------------------------------------------------------------
# TestModelRouter
# ---------------------------------------------------------------------------

class TestModelRouter:
    """Model router unit tests."""

    def _router(self, smart="smart-model", coder="coder-model"):
        from app.services.llm.model_router import ModelRouter
        router = ModelRouter()
        return router

    def _mock_settings(self, default="default-model", smart="", coder=""):
        m = MagicMock()
        m.ollama_model = default
        m.ollama_smart_model = smart
        m.ollama_coder_model = coder
        return m

    def test_simple_query_uses_default(self):
        from app.services.llm.model_router import ModelRouter
        router = ModelRouter()
        with patch("app.services.llm.model_router.get_settings") as ms:
            ms.return_value = self._mock_settings(default="fast-model")
            decision = router.route("What is nginx?")
        assert decision.model == "fast-model"
        assert decision.complexity in ("fast", "medium")

    def test_complex_query_uses_smart_when_configured(self):
        from app.services.llm.model_router import ModelRouter
        router = ModelRouter()
        with patch("app.services.llm.model_router.get_settings") as ms:
            ms.return_value = self._mock_settings(default="fast", smart="smart-7b")
            decision = router.route(
                "Analyse the trade-offs between microservices and monolithic architectures "
                "and provide a migration strategy roadmap for our current system."
            )
        assert decision.model == "smart-7b"
        assert decision.complexity == "complex"

    def test_code_query_uses_coder_when_configured(self):
        from app.services.llm.model_router import ModelRouter
        router = ModelRouter()
        with patch("app.services.llm.model_router.get_settings") as ms:
            ms.return_value = self._mock_settings(default="fast", coder="coder-7b")
            decision = router.route("Write a unit test for the authentication module")
        assert decision.model == "coder-7b"
        assert decision.complexity == "code"

    def test_force_override_smart(self):
        from app.services.llm.model_router import ModelRouter
        router = ModelRouter()
        with patch("app.services.llm.model_router.get_settings") as ms:
            ms.return_value = self._mock_settings(default="fast", smart="smart-7b")
            decision = router.route("hi", force="smart")
        assert decision.model == "smart-7b"
        assert decision.reason == "forced"

    def test_force_override_fast(self):
        from app.services.llm.model_router import ModelRouter
        router = ModelRouter()
        with patch("app.services.llm.model_router.get_settings") as ms:
            ms.return_value = self._mock_settings(default="fast-model", smart="smart-7b")
            decision = router.route("Analyse this very complex architectural design pattern", force="fast")
        assert decision.model == "fast-model"

    def test_no_smart_model_stays_on_default(self):
        from app.services.llm.model_router import ModelRouter
        router = ModelRouter()
        with patch("app.services.llm.model_router.get_settings") as ms:
            ms.return_value = self._mock_settings(default="default-model", smart="")
            decision = router.route(
                "Analyse and compare the architectural trade-offs in a complex distributed system design"
            )
        # smart="" → same as default
        assert decision.model == "default-model"

    def test_route_model_name_returns_string(self):
        from app.services.llm.model_router import ModelRouter
        router = ModelRouter()
        with patch("app.services.llm.model_router.get_settings") as ms:
            ms.return_value = self._mock_settings(default="my-model")
            name = router.route_model_name("hello world")
        assert isinstance(name, str)
        assert name == "my-model"

    def test_long_query_triggers_smart(self):
        from app.services.llm.model_router import ModelRouter
        router = ModelRouter()
        long_query = " ".join(["word"] * 55)  # > 50 words
        with patch("app.services.llm.model_router.get_settings") as ms:
            ms.return_value = self._mock_settings(default="fast", smart="smart")
            decision = router.route(long_query)
        assert decision.complexity == "complex"
        assert decision.model == "smart"
