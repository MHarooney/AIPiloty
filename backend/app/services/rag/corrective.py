"""CRAG — Corrective Retrieval-Augmented Generation.

After the vector+keyword search returns top-k chunks, CRAG scores each chunk's
true relevance to the query using the cross-encoder reranker.  Based on the
maximum relevance score it assigns a quality verdict:

  • good      — at least one chunk scores ≥ HIGH_THRESHOLD (0.5): use as-is.
  • ambiguous — best score falls between LOW_THRESHOLD (0.1) and HIGH_THRESHOLD:
                results may help but the agent should also consider web search.
  • poor      — all chunks score < LOW_THRESHOLD: the KB has nothing useful;
                the agent should use web_search instead.

The quality verdict is surfaced through ``RetrievalBundle`` so the
``kb_search`` tool can advise the LLM to fall back to web search.

Reference: Shi et al. "Corrective Retrieval Augmented Generation" (2024).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import List, Optional, TYPE_CHECKING

from ...core.config import get_settings

if TYPE_CHECKING:
    from .retriever import RetrievalResult

logger = logging.getLogger(__name__)

# ── Quality thresholds ────────────────────────────────────────────────────
HIGH_THRESHOLD: float = 0.5   # ≥ this → "good"
LOW_THRESHOLD: float = 0.10   # < this → "poor"; between → "ambiguous"

Quality = str  # "good" | "ambiguous" | "poor"


@dataclass
class RetrievalBundle:
    """Results from the CRAG-assessed retrieval pipeline.

    Attributes:
        results:     Retrieval hits (already reranked if reranker is available).
        quality:     "good", "ambiguous", or "poor".
        max_score:   Highest cross-encoder score among returned chunks
                     (or the RRF score if reranker was unavailable).
        web_hint:    Human-readable hint for the LLM when quality is not "good".
    """

    results: List["RetrievalResult"]
    quality: Quality = "good"
    max_score: float = 0.0
    web_hint: str = ""


class CorrectiveRetriever:
    """Wrap RetrieverService with CRAG quality assessment.

    Args:
        retriever: A Phase-1-enhanced RetrieverService instance.
        reranker:  Optional Reranker; if provided its calibrated scores are used
                   for CRAG assessment.  When absent, RRF scores from the
                   retriever are used (less calibrated but still useful).
        high_threshold: Cross-encoder score above which quality is "good".
        low_threshold:  Cross-encoder score below which quality is "poor".
    """

    def __init__(
        self,
        retriever: "RetrieverService",  # type: ignore[name-defined]
        reranker: Optional[object] = None,
        high_threshold: float = HIGH_THRESHOLD,
        low_threshold: float = LOW_THRESHOLD,
    ) -> None:
        self._retriever = retriever
        self._reranker = reranker
        self._high = high_threshold
        self._low = low_threshold

    async def search(
        self,
        query: str,
        top_k: int = 5,
        min_score: float = 0.3,
        mode: str = "hybrid",
        notebook_id: str | None = None,
        conversation_history: List[dict] | None = None,
    ) -> RetrievalBundle:
        """Run retrieval and assess quality.

        The retriever already reranks (Phase 1), so we read the top score
        directly from the returned results list.  No second rerank pass needed.

        Returns a RetrievalBundle with quality verdict and optional web hint.
        """
        results = await self._retriever.search(
            query=query,
            top_k=top_k,
            min_score=min_score,
            mode=mode,
            notebook_id=notebook_id,
            conversation_history=conversation_history,
        )

        if not results:
            return RetrievalBundle(
                results=[],
                quality="poor",
                max_score=0.0,
                web_hint=(
                    "The knowledge base returned no results for this query. "
                    "Consider using **web_search** to find up-to-date information."
                ),
            )

        settings = get_settings()

        if not settings.rag_crag_enabled:
            # CRAG disabled — return results as-is with no quality assessment
            return RetrievalBundle(results=results, quality="good", max_score=results[0].score)

        # The top result's score is the best relevance indicator.
        # If reranker ran, score is a cross-encoder logit (can be negative or large positive).
        # If only RRF ran, score is a small positive float like 0.031.
        max_score = results[0].score if results else 0.0

        quality, web_hint = self._assess(query, max_score, bool(self._retriever.reranker_available))

        logger.info(
            "CRAG: query=%r | top_score=%.3f | quality=%s | reranker=%s",
            query[:60], max_score, quality, self._retriever.reranker_available,
        )

        return RetrievalBundle(
            results=results,
            quality=quality,
            max_score=max_score,
            web_hint=web_hint,
        )

    def _assess(self, query: str, max_score: float, reranker_active: bool) -> tuple[Quality, str]:
        """Determine quality verdict and web-search hint from the top score."""

        if reranker_active:
            # Cross-encoder logit scale: typically -5 to +10
            # Calibrated thresholds for ms-marco-MiniLM-L-6-v2
            high = self._high * 10  # 5.0
            low = self._low * 10    # 1.0
        else:
            # RRF score scale: 0.01 to 0.03 — use raw thresholds / 10
            high = self._high / 10   # 0.05
            low = self._low / 10     # 0.01

        if max_score >= high:
            return "good", ""

        if max_score >= low:
            return "ambiguous", (
                f"Knowledge base relevance is marginal (score={max_score:.2f}). "
                f"The results above may partially answer «{query[:80]}» "
                "but consider also running **web_search** for authoritative sources."
            )

        return "poor", (
            f"Knowledge base relevance is very low (score={max_score:.2f}) for «{query[:80]}». "
            "The retrieved chunks are unlikely to help. "
            "Run **web_search** to find current information on this topic."
        )
