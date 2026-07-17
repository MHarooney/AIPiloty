"""Self-Evaluator — Agentic RAG quality gate.

After the LLM produces its final answer the self-evaluator scores it on three
criteria derived from the RAGAS framework:

  faithfulness   — every claim is grounded in the supplied context/tool results.
  relevance      — the answer directly addresses the question asked.
  completeness   — key points from the context are covered.

If the weighted overall score falls below a configurable threshold the evaluator
sets ``should_retry=True``.  The orchestrator then injects a focused correction
prompt and runs one more LLM iteration (controlled by an ``_eval_retry_done``
flag so retries never cascade).

Design principles:
  • Uses the same OllamaService already wired into the agent — no extra LLM.
  • Times out after 20 s and returns a neutral score on any failure.
  • Output is structured JSON parsed with fallback to safe defaults.
  • Never blocks the response stream — evaluation happens *after* the final
    answer tokens have been flushed to the client.

Reference: Ragas (Es et al., 2023) faithfulness / answer-relevancy metrics.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Weights for overall score ─────────────────────────────────────────────
_W_FAITHFULNESS  = 0.50   # most important — no hallucinations
_W_RELEVANCE     = 0.30   # answer addresses the question
_W_COMPLETENESS  = 0.20   # covers key context points

_EVAL_TIMEOUT_S  = 20.0   # seconds before we give up and return neutral score
_NEUTRAL_SCORE   = 0.80   # returned on evaluation failure (optimistic default)

# ── Prompts ───────────────────────────────────────────────────────────────
_SYSTEM = (
    "You are a strict quality evaluator for AI-generated answers. "
    "Respond ONLY with valid JSON. No explanation outside the JSON object."
)

_PROMPT = """\
Evaluate this AI answer on three criteria. Score each 0.0-1.0 (two decimal places).

QUESTION:
{question}

CONTEXT (tool results + retrieved chunks used by the AI):
{context}

AI ANSWER:
{answer}

Scoring criteria:
  faithfulness   – every factual claim in the answer is supported by the CONTEXT (not from general knowledge alone)
  relevance      – the answer directly and specifically addresses the QUESTION
  completeness   – the answer covers the key points available in the CONTEXT

Respond with ONLY this JSON (no markdown fences, no extra keys):
{{"faithfulness": <float>, "relevance": <float>, "completeness": <float>, "issues": [<short string>, ...]}}

"issues" is an empty list if the answer is good; otherwise list up to 3 short problems (e.g. "Claims X but context says Y").
"""


@dataclass
class EvaluationResult:
    """Quality scores for a single LLM answer."""

    faithfulness:  float = _NEUTRAL_SCORE
    relevance:     float = _NEUTRAL_SCORE
    completeness:  float = _NEUTRAL_SCORE
    overall:       float = _NEUTRAL_SCORE
    issues:        list[str] = field(default_factory=list)
    should_retry:  bool = False
    eval_ok:       bool = True   # False when evaluation itself failed

    def to_sse_payload(self) -> dict[str, Any]:
        return {
            "faithfulness":  round(self.faithfulness, 2),
            "relevance":     round(self.relevance, 2),
            "completeness":  round(self.completeness, 2),
            "overall":       round(self.overall, 2),
            "issues":        self.issues,
            "should_retry":  self.should_retry,
        }

    def correction_hint(self, question: str) -> str:
        """Build the improvement prompt injected for the retry turn."""
        problem_lines = "\n".join(f"  - {i}" for i in self.issues) if self.issues else "  - Answer quality was below threshold."
        return (
            "[SYSTEM — Quality Gate]\n"
            f"Your previous answer scored {self.overall:.0%} on the quality evaluation "
            f"(faithfulness={self.faithfulness:.0%}, relevance={self.relevance:.0%}, "
            f"completeness={self.completeness:.0%}).\n\n"
            "Problems identified:\n"
            f"{problem_lines}\n\n"
            "Please revise your answer for the original question:\n"
            f"«{question}»\n\n"
            "Requirements:\n"
            "  1. Only state facts supported by the tool results or retrieved context shown above.\n"
            "  2. Directly address the question — do not pad with unrelated information.\n"
            "  3. If the context is insufficient, state that clearly rather than guessing.\n"
            "Provide only the revised answer — no meta-commentary."
        )


class SelfEvaluator:
    """Score LLM answers for faithfulness, relevance, and completeness.

    Args:
        llm:       OllamaService instance (reuses the agent's existing LLM).
        threshold: Overall score below which ``should_retry`` is set to True.
    """

    def __init__(self, llm: Any, threshold: float = 0.65) -> None:
        self._llm = llm
        self._threshold = threshold

    async def evaluate(
        self,
        question: str,
        context: str,
        answer: str,
    ) -> EvaluationResult:
        """Evaluate answer quality.  Returns neutral score on any failure.

        Args:
            question: The original user question.
            context:  Concatenated tool results / KB chunks used to produce answer.
            answer:   The final answer text emitted by the LLM.

        Returns:
            EvaluationResult with scores and retry recommendation.
        """
        if not answer.strip():
            return EvaluationResult(eval_ok=False)

        # Truncate long inputs to keep the evaluation prompt within token limits
        question_t = question[:400]
        context_t  = context[:2000]
        answer_t   = answer[:1200]

        prompt = _PROMPT.format(
            question=question_t,
            context=context_t,
            answer=answer_t,
        )

        try:
            raw = await asyncio.wait_for(
                self._llm.generate(prompt, system=_SYSTEM),
                timeout=_EVAL_TIMEOUT_S,
            )
            return self._parse(raw)
        except asyncio.TimeoutError:
            logger.warning("SelfEvaluator timed out after %.0fs — skipping retry", _EVAL_TIMEOUT_S)
            return EvaluationResult(eval_ok=False)
        except Exception as exc:
            logger.warning("SelfEvaluator failed (%s) — skipping retry", exc)
            return EvaluationResult(eval_ok=False)

    def _parse(self, raw: str) -> EvaluationResult:
        """Parse LLM JSON output into EvaluationResult with safe fallbacks."""
        raw = raw.strip()

        # Strip markdown code fences if the model wrapped the JSON
        if raw.startswith("```"):
            lines = raw.splitlines()
            raw = "\n".join(
                l for l in lines
                if not l.strip().startswith("```") and not l.strip().startswith("~~~")
            )

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("SelfEvaluator: could not parse JSON: %.120s", raw)
            return EvaluationResult(eval_ok=False)

        faith = float(data.get("faithfulness", _NEUTRAL_SCORE))
        relev = float(data.get("relevance",    _NEUTRAL_SCORE))
        compl = float(data.get("completeness", _NEUTRAL_SCORE))
        issues = [str(i) for i in data.get("issues", []) if i][:5]  # cap at 5

        # Clamp to [0, 1]
        faith = max(0.0, min(1.0, faith))
        relev = max(0.0, min(1.0, relev))
        compl = max(0.0, min(1.0, compl))

        overall = (faith * _W_FAITHFULNESS + relev * _W_RELEVANCE + compl * _W_COMPLETENESS)
        should_retry = overall < self._threshold

        logger.info(
            "SelfEvaluator: faith=%.2f rel=%.2f comp=%.2f overall=%.2f retry=%s issues=%s",
            faith, relev, compl, overall, should_retry, issues,
        )

        return EvaluationResult(
            faithfulness=faith,
            relevance=relev,
            completeness=compl,
            overall=round(overall, 3),
            issues=issues,
            should_retry=should_retry,
            eval_ok=True,
        )
