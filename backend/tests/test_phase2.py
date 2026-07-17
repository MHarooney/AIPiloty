"""Phase 2 tests — CRAG, SelfEvaluator, IntentClassifier.needs_retrieval."""

from __future__ import annotations

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# TestCorrectiveRetriever
# ---------------------------------------------------------------------------

class TestCorrectiveRetriever:
    """CRAG quality assessment tests."""

    def _make_retriever_mock(self, results):
        """Return a mock RetrieverService with given RetrievalResult list."""
        from app.services.rag.retriever import RetrievalResult
        mock = AsyncMock()
        mock.search = AsyncMock(return_value=results)
        mock.reranker_available = False
        return mock

    def _settings(self, crag_enabled=True, high=0.5, low=0.10):
        m = MagicMock()
        m.rag_crag_enabled = crag_enabled
        m.rag_crag_high_threshold = high
        m.rag_crag_low_threshold = low
        return m

    @pytest.mark.asyncio
    async def test_empty_results_return_poor(self):
        from app.services.rag.corrective import CorrectiveRetriever, RetrievalBundle
        from app.services.rag.retriever import RetrievalResult

        retriever = self._make_retriever_mock([])
        cr = CorrectiveRetriever(retriever=retriever)
        with patch("app.services.rag.corrective.get_settings") as ms:
            ms.return_value = self._settings()
            bundle = await cr.search("test query")

        assert bundle.quality == "poor"
        assert bundle.results == []
        assert "web_search" in bundle.web_hint

    @pytest.mark.asyncio
    async def test_high_score_is_good(self):
        from app.services.rag.corrective import CorrectiveRetriever
        from app.services.rag.retriever import RetrievalResult

        # Reranker not active → RRF scale → high = 0.05
        results = [RetrievalResult(content="x", source_path="a.md", heading="", score=0.1)]
        retriever = self._make_retriever_mock(results)
        retriever.reranker_available = False
        cr = CorrectiveRetriever(retriever=retriever)
        with patch("app.services.rag.corrective.get_settings") as ms:
            ms.return_value = self._settings()
            bundle = await cr.search("query")

        assert bundle.quality == "good"
        assert bundle.web_hint == ""

    @pytest.mark.asyncio
    async def test_low_score_is_poor_with_web_hint(self):
        from app.services.rag.corrective import CorrectiveRetriever
        from app.services.rag.retriever import RetrievalResult

        results = [RetrievalResult(content="x", source_path="a.md", heading="", score=0.001)]
        retriever = self._make_retriever_mock(results)
        retriever.reranker_available = False
        cr = CorrectiveRetriever(retriever=retriever)
        with patch("app.services.rag.corrective.get_settings") as ms:
            ms.return_value = self._settings()
            bundle = await cr.search("obscure query")

        assert bundle.quality == "poor"
        assert "web_search" in bundle.web_hint

    @pytest.mark.asyncio
    async def test_crag_disabled_returns_good(self):
        from app.services.rag.corrective import CorrectiveRetriever
        from app.services.rag.retriever import RetrievalResult

        results = [RetrievalResult(content="x", source_path="a.md", heading="", score=0.001)]
        retriever = self._make_retriever_mock(results)
        cr = CorrectiveRetriever(retriever=retriever)
        with patch("app.services.rag.corrective.get_settings") as ms:
            ms.return_value = self._settings(crag_enabled=False)
            bundle = await cr.search("query")

        # With CRAG disabled, quality always "good" regardless of score
        assert bundle.quality == "good"
        assert bundle.web_hint == ""

    @pytest.mark.asyncio
    async def test_retrieval_bundle_has_results(self):
        from app.services.rag.corrective import CorrectiveRetriever
        from app.services.rag.retriever import RetrievalResult

        r = RetrievalResult(content="Docker setup", source_path="docker.md", heading="", score=0.9)
        retriever = self._make_retriever_mock([r])
        retriever.reranker_available = False
        cr = CorrectiveRetriever(retriever=retriever)
        with patch("app.services.rag.corrective.get_settings") as ms:
            ms.return_value = self._settings()
            bundle = await cr.search("docker setup guide")

        assert len(bundle.results) == 1
        assert bundle.results[0].content == "Docker setup"


# ---------------------------------------------------------------------------
# TestSelfEvaluator
# ---------------------------------------------------------------------------

class TestSelfEvaluator:
    """Self-evaluator unit tests."""

    @pytest.mark.asyncio
    async def test_good_answer_no_retry(self):
        from app.services.agent.self_evaluator import SelfEvaluator

        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=json.dumps({
            "faithfulness": 0.9,
            "relevance": 0.85,
            "completeness": 0.8,
            "issues": [],
        }))
        ev = SelfEvaluator(llm=mock_llm, threshold=0.65)
        result = await ev.evaluate("What is Docker?", "Docker is a container platform.", "Docker is a containerization platform.")

        assert result.eval_ok is True
        assert result.should_retry is False
        assert result.overall > 0.65

    @pytest.mark.asyncio
    async def test_poor_answer_triggers_retry(self):
        from app.services.agent.self_evaluator import SelfEvaluator

        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=json.dumps({
            "faithfulness": 0.2,
            "relevance": 0.3,
            "completeness": 0.1,
            "issues": ["Answer is off-topic", "Contradicts context"],
        }))
        ev = SelfEvaluator(llm=mock_llm, threshold=0.65)
        result = await ev.evaluate("What is Docker?", "Docker is a container runtime.", "I don't know much about this.")

        assert result.eval_ok is True
        assert result.should_retry is True
        assert result.overall < 0.65
        assert len(result.issues) == 2

    @pytest.mark.asyncio
    async def test_llm_timeout_returns_neutral(self):
        import asyncio
        from app.services.agent.self_evaluator import SelfEvaluator, _NEUTRAL_SCORE

        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(side_effect=asyncio.TimeoutError())
        ev = SelfEvaluator(llm=mock_llm, threshold=0.65)
        result = await ev.evaluate("q", "ctx", "answer")

        assert result.eval_ok is False
        assert result.should_retry is False  # Never retry on evaluation failure

    @pytest.mark.asyncio
    async def test_llm_error_returns_neutral(self):
        from app.services.agent.self_evaluator import SelfEvaluator

        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(side_effect=RuntimeError("LLM unavailable"))
        ev = SelfEvaluator(llm=mock_llm, threshold=0.65)
        result = await ev.evaluate("q", "ctx", "answer")

        assert result.eval_ok is False
        assert result.should_retry is False

    @pytest.mark.asyncio
    async def test_invalid_json_returns_neutral(self):
        from app.services.agent.self_evaluator import SelfEvaluator

        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value="not json at all!")
        ev = SelfEvaluator(llm=mock_llm, threshold=0.65)
        result = await ev.evaluate("q", "ctx", "answer")

        assert result.eval_ok is False

    @pytest.mark.asyncio
    async def test_markdown_fenced_json_parsed(self):
        from app.services.agent.self_evaluator import SelfEvaluator

        payload = {"faithfulness": 0.8, "relevance": 0.75, "completeness": 0.7, "issues": []}
        fenced = f"```json\n{json.dumps(payload)}\n```"
        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=fenced)
        ev = SelfEvaluator(llm=mock_llm, threshold=0.65)
        result = await ev.evaluate("q", "ctx", "answer")

        assert result.eval_ok is True
        assert result.faithfulness == pytest.approx(0.8, abs=0.01)

    @pytest.mark.asyncio
    async def test_scores_clamped_to_0_1(self):
        from app.services.agent.self_evaluator import SelfEvaluator

        mock_llm = AsyncMock()
        mock_llm.generate = AsyncMock(return_value=json.dumps({
            "faithfulness": 1.5,  # out of range
            "relevance": -0.3,    # negative
            "completeness": 0.7,
            "issues": [],
        }))
        ev = SelfEvaluator(llm=mock_llm, threshold=0.65)
        result = await ev.evaluate("q", "ctx", "answer")

        assert result.faithfulness == 1.0
        assert result.relevance == 0.0

    @pytest.mark.asyncio
    async def test_correction_hint_contains_question(self):
        from app.services.agent.self_evaluator import SelfEvaluator, EvaluationResult
        result = EvaluationResult(
            faithfulness=0.3,
            relevance=0.4,
            completeness=0.5,
            overall=0.36,
            issues=["Hallucinated a fact"],
            should_retry=True,
        )
        hint = result.correction_hint("What is Nginx?")
        assert "What is Nginx?" in hint
        assert "Hallucinated a fact" in hint
        assert "faithfulness" in hint.lower() or "36%" in hint

    @pytest.mark.asyncio
    async def test_to_sse_payload_structure(self):
        from app.services.agent.self_evaluator import EvaluationResult
        r = EvaluationResult(faithfulness=0.9, relevance=0.8, completeness=0.7, overall=0.84, issues=[], should_retry=False)
        payload = r.to_sse_payload()
        assert set(payload.keys()) == {"faithfulness", "relevance", "completeness", "overall", "issues", "should_retry"}
        assert isinstance(payload["faithfulness"], float)


# ---------------------------------------------------------------------------
# TestIntentClassifierPhase2
# ---------------------------------------------------------------------------

class TestIntentClassifierPhase2:
    """Tests for the new needs_retrieval() method."""

    def _clf(self):
        from app.services.agent.intent_classifier import IntentClassifier
        return IntentClassifier()

    def test_conversational_no_retrieval(self):
        clf = self._clf()
        for msg in ["hi", "thanks", "ok", "great", "sure", "bye", "got it", "awesome"]:
            assert clf.needs_retrieval(msg) is False, f"Should skip RAG for: {msg!r}"

    def test_technical_needs_retrieval(self):
        clf = self._clf()
        for msg in [
            "How do I set up Nginx?",
            "What is the Docker compose configuration?",
            "Check the server health",
            "Deploy the application to VM",
            "What are the best practices for Kubernetes?",
        ]:
            assert clf.needs_retrieval(msg) is True, f"Should retrieve for: {msg!r}"

    def test_knowledge_category_always_retrieves(self):
        clf = self._clf()
        # Knowledge-category intents always need retrieval regardless of phrasing
        assert clf.needs_retrieval("find the documentation for this") is True
        assert clf.needs_retrieval("search knowledge base") is True

    def test_empty_short_general_skips(self):
        clf = self._clf()
        # "yes" is conversational
        assert clf.needs_retrieval("yes") is False

    def test_needs_retrieval_with_precomputed_intent(self):
        from app.services.agent.intent_classifier import IntentClassifier, Intent
        clf = IntentClassifier()
        vm_intent = Intent(category="vm", confidence=0.9, suggested_tools=[], context_hints={})
        assert clf.needs_retrieval("check my server", intent=vm_intent) is True

    def test_classify_still_works(self):
        clf = self._clf()
        intent = clf.classify("ssh into the server")
        assert intent.category == "vm"
        assert intent.confidence > 0.0


# ---------------------------------------------------------------------------
# TestKnowledgeSearchToolPhase2
# ---------------------------------------------------------------------------

class TestKnowledgeSearchToolPhase2:
    """kb_search with CRAG integration."""

    @pytest.mark.asyncio
    async def test_poor_quality_appends_web_hint(self):
        from app.services.tools.knowledge_search import KnowledgeSearchTool
        from app.services.rag.retriever import RetrievalResult
        from app.services.rag.corrective import RetrievalBundle

        # Mock CorrectiveRetriever returning poor quality
        mock_corrective = AsyncMock()
        mock_corrective.search = AsyncMock(return_value=RetrievalBundle(
            results=[RetrievalResult(content="Weak result", source_path="x.md", heading="", score=0.001)],
            quality="poor",
            max_score=0.001,
            web_hint="Consider using web_search for better results.",
        ))

        mock_retriever = AsyncMock()
        mock_retriever.reranker_available = False

        tool = KnowledgeSearchTool(retriever=mock_retriever, corrective_retriever=mock_corrective)
        result = await tool.execute(query="obscure technical topic")

        assert result.success
        assert "CRAG quality assessment" in result.output
        assert "web_search" in result.output

    @pytest.mark.asyncio
    async def test_good_quality_no_web_hint(self):
        from app.services.tools.knowledge_search import KnowledgeSearchTool
        from app.services.rag.retriever import RetrievalResult
        from app.services.rag.corrective import RetrievalBundle

        mock_corrective = AsyncMock()
        mock_corrective.search = AsyncMock(return_value=RetrievalBundle(
            results=[RetrievalResult(content="Nginx config docs", source_path="nginx.md", heading="Config", score=7.5)],
            quality="good",
            max_score=7.5,
            web_hint="",  # no hint for good quality
        ))

        mock_retriever = AsyncMock()
        mock_retriever.reranker_available = True

        tool = KnowledgeSearchTool(retriever=mock_retriever, corrective_retriever=mock_corrective)
        result = await tool.execute(query="how to configure nginx")

        assert result.success
        assert "Nginx config docs" in result.output
        assert "CRAG" not in result.output  # no quality warning

    @pytest.mark.asyncio
    async def test_metadata_includes_crag_quality(self):
        from app.services.tools.knowledge_search import KnowledgeSearchTool
        from app.services.rag.retriever import RetrievalResult
        from app.services.rag.corrective import RetrievalBundle

        mock_corrective = AsyncMock()
        mock_corrective.search = AsyncMock(return_value=RetrievalBundle(
            results=[RetrievalResult(content="doc", source_path="d.md", heading="", score=3.0)],
            quality="ambiguous",
            max_score=3.0,
            web_hint="Marginal quality — consider web_search.",
        ))

        mock_retriever = AsyncMock()
        mock_retriever.reranker_available = True

        tool = KnowledgeSearchTool(retriever=mock_retriever, corrective_retriever=mock_corrective)
        result = await tool.execute(query="something uncertain")

        assert result.metadata.get("crag_quality") == "ambiguous"

    @pytest.mark.asyncio
    async def test_fallback_to_plain_retriever_when_no_corrective(self):
        """When corrective_retriever=None, plain retrieval still works."""
        from app.services.tools.knowledge_search import KnowledgeSearchTool
        from app.services.rag.retriever import RetrievalResult

        mock_retriever = AsyncMock()
        mock_retriever.search = AsyncMock(return_value=[
            RetrievalResult(content="Docker docs", source_path="docker.md", heading="", score=0.9)
        ])
        mock_retriever.reranker_available = False

        tool = KnowledgeSearchTool(retriever=mock_retriever, corrective_retriever=None)
        result = await tool.execute(query="docker")

        assert result.success
        assert "Docker docs" in result.output
        assert result.metadata.get("crag_quality") == "good"
