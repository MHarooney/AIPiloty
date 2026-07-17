"""Cross-encoder reranker — post-retrieval relevance reranking.

Uses a lightweight cross-encoder model (ms-marco-MiniLM-L-6-v2, ~90 MB) from
sentence-transformers to reorder retrieval candidates by true query-document
relevance, not just cosine similarity.

The model is loaded lazily on first use and cached as a module-level singleton,
so it does not block application startup and is only in memory when needed.

If sentence-transformers is not installed, the reranker degrades gracefully by
returning the original list unchanged — no crash, no error to the user.
"""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from .retriever import RetrievalResult

logger = logging.getLogger(__name__)

# ── Singleton model (lazy-loaded, thread-safe) ────────────────────────────
_model_lock = threading.Lock()
_cross_encoder: Optional[object] = None
_model_name: str = ""
_load_attempted: bool = False


def _get_model(model_name: str) -> Optional[object]:
    """Load and cache the CrossEncoder model.  Thread-safe, idempotent."""
    global _cross_encoder, _model_name, _load_attempted

    if _load_attempted and (_cross_encoder is not None or _model_name == model_name):
        return _cross_encoder

    with _model_lock:
        # Double-checked locking
        if _load_attempted and _model_name == model_name:
            return _cross_encoder

        _load_attempted = True
        _model_name = model_name
        try:
            from sentence_transformers import CrossEncoder  # type: ignore[import]
            logger.info("Loading cross-encoder reranker '%s'…", model_name)
            _cross_encoder = CrossEncoder(model_name, max_length=512)
            logger.info("Cross-encoder reranker loaded ✓")
        except ImportError:
            logger.warning(
                "sentence-transformers not installed — reranker disabled. "
                "Install with: pip install sentence-transformers"
            )
            _cross_encoder = None
        except Exception as exc:
            logger.warning("Could not load reranker model '%s': %s", model_name, exc)
            _cross_encoder = None

    return _cross_encoder


class Reranker:
    """Rerank retrieval results using a cross-encoder model.

    Usage::

        reranker = Reranker()
        top5 = reranker.rerank(query, results, top_k=5)

    If the model is unavailable the original list (truncated to top_k) is returned.
    """

    DEFAULT_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"

    def __init__(self, model_name: Optional[str] = None) -> None:
        self._model_name = model_name or self.DEFAULT_MODEL

    def rerank(
        self,
        query: str,
        results: List["RetrievalResult"],
        top_k: int = 5,
    ) -> List["RetrievalResult"]:
        """Score query-document pairs and return top_k sorted by relevance.

        Args:
            query:   The user query (already rewritten / expanded if applicable).
            results: Candidate chunks from the hybrid retriever (typically top-20).
            top_k:   How many results to keep after reranking.

        Returns:
            A new list sorted by cross-encoder score, truncated to top_k.
            Original RetrievalResult.score is replaced by the cross-encoder score.
        """
        if not results:
            return results

        model = _get_model(self._model_name)
        if model is None:
            # Graceful degradation — no reranker available
            logger.debug("Reranker unavailable, returning top-%d by RRF score", top_k)
            return results[:top_k]

        if len(results) <= top_k:
            # Nothing to reorder — still score so the score field is calibrated
            candidates = results
        else:
            candidates = results

        try:
            pairs = [(query, r.content) for r in candidates]
            raw_scores: list[float] = model.predict(pairs).tolist()  # type: ignore[union-attr]

            # Zip, sort descending, take top_k
            scored = sorted(zip(raw_scores, candidates), key=lambda x: x[0], reverse=True)
            top = scored[:top_k]

            from .retriever import RetrievalResult as RR  # local import to avoid circular
            reranked = [
                RR(
                    content=r.content,
                    source_path=r.source_path,
                    heading=r.heading,
                    score=round(float(s), 4),
                )
                for s, r in top
            ]
            logger.debug(
                "Reranker: %d → %d results | top score=%.3f",
                len(candidates), len(reranked), reranked[0].score if reranked else 0,
            )
            return reranked

        except Exception as exc:
            logger.warning("Reranker.predict failed (%s) — falling back to original order", exc)
            return results[:top_k]

    @property
    def is_available(self) -> bool:
        """True if the underlying model loaded successfully."""
        return _get_model(self._model_name) is not None
