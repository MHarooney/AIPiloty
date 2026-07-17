"""Phase 3 tests — EpisodicStore, WorkingMemory."""

from __future__ import annotations

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, patch


# ---------------------------------------------------------------------------
# TestWorkingMemory
# ---------------------------------------------------------------------------

class TestWorkingMemory:
    """WorkingMemory scratchpad tests."""

    def _wm(self, budget=5000):
        from app.services.memory.working_memory import WorkingMemory
        return WorkingMemory(token_budget=budget)

    def test_empty_produces_no_prompt(self):
        wm = self._wm()
        assert wm.format_for_prompt() == ""

    def test_objective_appears_in_prompt(self):
        wm = self._wm()
        wm.set_objective("Deploy the Nginx service")
        prompt = wm.format_for_prompt()
        assert "Deploy the Nginx service" in prompt
        assert "AGENT WORKING MEMORY" in prompt

    def test_facts_appear_in_prompt(self):
        wm = self._wm()
        wm.set_objective("something")
        wm.add_fact("Server is running Ubuntu 22.04", source="tool:get_host_environment")
        prompt = wm.format_for_prompt()
        assert "Ubuntu 22.04" in prompt

    def test_tool_summary_appears(self):
        wm = self._wm()
        wm.set_objective("check system")
        wm.add_tool_summary("vm_health_check", "CPU: 23%, RAM: 12GB free, disk: OK")
        prompt = wm.format_for_prompt()
        assert "vm_health_check" in prompt

    def test_episodic_recall_appears(self):
        wm = self._wm()
        wm.set_objective("fix nginx")
        wm.add_episodic_recall("[Memory 1] (fix • 2026-07-10): Fixed nginx 502 by restarting php-fpm")
        prompt = wm.format_for_prompt()
        assert "nginx 502" in prompt
        assert "past experiences" in prompt.lower()

    def test_token_budget_limits_output(self):
        wm = self._wm(budget=50)  # tiny budget
        wm.set_objective("a very long objective that would exceed the budget if other things are added")
        wm.add_fact("some fact about the system", source="tool")
        wm.add_episodic_recall("[Memory 1] (fix • 2026-07-10): some very long recall text here")
        prompt = wm.format_for_prompt()
        assert len(prompt) <= 50 + 100  # allow some headings overhead

    def test_fact_cap_at_12(self):
        wm = self._wm()
        for i in range(20):
            wm.add_fact(f"fact number {i}", source="tool", confidence=float(i) / 20)
        assert len(wm.facts) <= 12
        # Highest confidence facts should be retained
        confidences = [f.confidence for f in wm.facts]
        assert max(confidences) >= 0.9

    def test_tool_summary_cap_at_6(self):
        wm = self._wm()
        for i in range(10):
            wm.add_tool_summary(f"tool_{i}", f"output {i}")
        assert len(wm.tool_summaries) <= 6
        # Most recent tools should be kept
        assert any("tool_9" in t.tool_name for t in wm.tool_summaries)

    def test_to_episode_summary_with_content(self):
        wm = self._wm()
        wm.set_objective("Deploy backend service")
        wm.add_fact("Service is on port 8000", source="tool", confidence=0.9)
        wm.add_tool_summary("ssh_command", "systemctl start backend succeeded", success=True)
        summary = wm.to_episode_summary()
        assert "Deploy backend service" in summary
        assert len(summary) <= 600

    def test_to_episode_summary_empty(self):
        wm = self._wm()
        assert wm.to_episode_summary() == ""

    def test_infer_category_fix(self):
        wm = self._wm()
        wm.set_objective("fix the nginx error")
        wm.add_tool_summary("ssh_command", "restarted nginx")
        assert wm.infer_category() == "incident"  # ssh implies incident

    def test_infer_category_document(self):
        wm = self._wm()
        wm.set_objective("generate a PDF report")
        wm.add_tool_summary("generate_pdf", "PDF created at /tmp/report.pdf")
        assert wm.infer_category() == "discovery"

    def test_infer_category_conversation_default(self):
        wm = self._wm()
        wm.set_objective("tell me about Python")
        assert wm.infer_category() == "conversation"

    def test_token_estimate_reasonable(self):
        wm = self._wm()
        wm.set_objective("check system health")
        wm.add_fact("disk usage is 45%", source="tool")
        estimate = wm.token_estimate
        assert 5 < estimate < 200  # reasonable range

    def test_has_content_false_when_empty(self):
        wm = self._wm()
        assert not wm._has_content()

    def test_has_content_true_with_objective(self):
        wm = self._wm()
        wm.set_objective("test")
        assert wm._has_content()


# ---------------------------------------------------------------------------
# TestEpisodicStore
# ---------------------------------------------------------------------------

class TestEpisodicStore:
    """EpisodicStore unit tests — mocked Qdrant."""

    def _make_store(self):
        from app.services.memory.episodic_store import EpisodicStore

        mock_qdrant = AsyncMock()
        mock_embed = AsyncMock()
        mock_embed.embed_one = AsyncMock(return_value=[0.1] * 768)

        store = EpisodicStore(
            qdrant_store=mock_qdrant,
            embeddings=mock_embed,
            collection="test_episodic",
        )
        return store, mock_qdrant, mock_embed

    @pytest.mark.asyncio
    async def test_remember_returns_none_when_qdrant_unavailable(self):
        from app.services.memory.episodic_store import EpisodicStore
        mock_qdrant = AsyncMock()
        mock_qdrant._get_client = AsyncMock(side_effect=Exception("Qdrant down"))
        mock_embed = AsyncMock()
        store = EpisodicStore(qdrant_store=mock_qdrant, embeddings=mock_embed)
        result = await store.remember("Some episode summary")
        assert result is None

    @pytest.mark.asyncio
    async def test_recall_returns_empty_when_qdrant_unavailable(self):
        from app.services.memory.episodic_store import EpisodicStore
        mock_qdrant = AsyncMock()
        mock_qdrant._get_client = AsyncMock(side_effect=Exception("Qdrant down"))
        mock_embed = AsyncMock()
        store = EpisodicStore(qdrant_store=mock_qdrant, embeddings=mock_embed)
        results = await store.recall("test query")
        assert results == []

    @pytest.mark.asyncio
    async def test_remember_skips_empty_summary(self):
        store, _, _ = self._make_store()
        store._ready = True  # bypass init
        result = await store.remember("")
        assert result is None

    @pytest.mark.asyncio
    async def test_recall_returns_empty_for_empty_query(self):
        store, _, _ = self._make_store()
        store._ready = True
        results = await store.recall("")
        assert results == []

    @pytest.mark.asyncio
    async def test_pii_redaction_in_summary(self):
        from app.services.memory.episodic_store import _redact
        text = "API key: sk-abc123xyz and password=secret123"
        redacted = _redact(text)
        assert "sk-abc123xyz" not in redacted
        assert "[REDACTED]" in redacted

    def test_episode_format_for_prompt(self):
        from app.services.memory.episodic_store import Episode
        ep = Episode(
            id="abc123",
            summary="Fixed nginx 502 by restarting php-fpm",
            category="fix",
            session_id="session1",
            importance=0.8,
            created_at="2026-07-10T10:00:00Z",
            score=0.75,
        )
        prompt = ep.format_for_prompt(1)
        assert "[Memory 1]" in prompt
        assert "fix" in prompt
        assert "nginx 502" in prompt
        assert "2026-07-10" in prompt

    @pytest.mark.asyncio
    async def test_list_episodes_returns_empty_when_unavailable(self):
        store, mock_qdrant, _ = self._make_store()
        store._ready = False  # simulate not ready
        mock_qdrant._get_client = AsyncMock(side_effect=Exception("down"))
        results = await store.list_episodes()
        assert results == []

    @pytest.mark.asyncio
    async def test_forget_returns_false_when_unavailable(self):
        store, mock_qdrant, _ = self._make_store()
        store._ready = False
        mock_qdrant._get_client = AsyncMock(side_effect=Exception("down"))
        result = await store.forget("some-id")
        assert result is False

    @pytest.mark.asyncio
    async def test_count_returns_zero_when_unavailable(self):
        store, mock_qdrant, _ = self._make_store()
        # _ready=False → _ensure_ready tries to connect → fails → returns 0
        store._ready = False
        mock_qdrant._get_client = AsyncMock(side_effect=Exception("Qdrant down"))
        result = await store.count()
        assert result == 0

    def test_is_available_false_initially(self):
        store, _, _ = self._make_store()
        assert store.is_available is False

    def test_is_available_true_after_ready(self):
        store, _, _ = self._make_store()
        store._ready = True
        assert store.is_available is True


# ---------------------------------------------------------------------------
# TestEpisodeFormat
# ---------------------------------------------------------------------------

class TestEpisodeFormat:
    """Unit tests for Episode data class."""

    def test_format_citation_no_score(self):
        from app.services.memory.episodic_store import Episode
        ep = Episode(
            id="x", summary="Deployed to prod", category="pattern",
            session_id="s1", importance=0.7, created_at="2026-01-01T00:00:00Z",
        )
        formatted = ep.format_for_prompt(2)
        assert "[Memory 2]" in formatted
        assert "pattern" in formatted
        assert "Deployed to prod" in formatted

    def test_format_shows_date_only(self):
        from app.services.memory.episodic_store import Episode
        ep = Episode(
            id="x", summary="test", category="general",
            session_id="s1", importance=0.5, created_at="2026-07-15T14:30:00Z",
        )
        formatted = ep.format_for_prompt(1)
        assert "2026-07-15" in formatted
        assert "14:30" not in formatted  # only date shown


# ---------------------------------------------------------------------------
# TestWorkingMemoryIntegration
# ---------------------------------------------------------------------------

class TestWorkingMemoryIntegration:
    """Integration-style tests for WM + episode formatting."""

    def test_episodic_recalls_appear_first_in_prompt(self):
        """Episodic recalls should be the first section (highest priority)."""
        from app.services.memory.working_memory import WorkingMemory
        wm = WorkingMemory(token_budget=5000)
        wm.set_objective("fix something")
        wm.add_fact("a fact", source="tool")
        wm.add_episodic_recall("[Memory 1] (fix • 2026-07-10): previous fix")
        prompt = wm.format_for_prompt()
        # Past experiences should appear before Objective
        exp_pos = prompt.find("past experiences")
        obj_pos = prompt.find("objective")
        assert exp_pos < obj_pos, "Episodic recalls must precede objective in prompt"

    def test_full_workflow_to_episode_summary(self):
        """Simulate a full conversation lifecycle."""
        from app.services.memory.working_memory import WorkingMemory
        wm = WorkingMemory()
        wm.set_objective("Check server health and restart if needed")
        wm.add_tool_summary("vm_health_check", "CPU: 95%, memory critical", success=True)
        wm.add_fact("Server is overloaded", source="tool:vm_health_check", confidence=0.95)
        wm.add_tool_summary("ssh_command", "systemctl restart backend", success=True)

        summary = wm.to_episode_summary()
        assert "Check server health" in summary
        assert len(summary) > 10

        category = wm.infer_category()
        assert category == "incident"  # ssh implies incident

        prompt = wm.format_for_prompt()
        assert "AGENT WORKING MEMORY" in prompt
        assert "Current objective" in prompt
