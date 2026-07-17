"""Conversation-aware query rewriter for RAG retrieval.

In multi-turn chat, user messages frequently contain unresolved references:
  "Can you fix that?"   → "that" is context from 3 turns ago
  "What about the port?"  → "the port" refers to something mentioned earlier

Sending these to the embedding model produces poor results because the vector
space has no conversational context.  This module rewrites the latest user
message into a fully self-contained search query that includes all needed context.

The rewriter:
  1. Detects whether rewriting is actually needed (heuristic pronoun check).
  2. Calls the LLM with a compact, focused prompt (≤200 output tokens).
  3. Falls back to the original query on any failure — never blocks retrieval.
  4. Is disabled automatically when ``conversation_history`` is empty.
"""

from __future__ import annotations

import logging
import re
from typing import Any

logger = logging.getLogger(__name__)

# Pronouns / vague references that signal the query needs context resolution
_COREFERENCE_SIGNALS = frozenset({
    "it", "its", "this", "that", "these", "those",
    "they", "them", "their", "there", "here",
    "he", "she", "him", "her", "his",
    "above", "below", "previously", "mentioned",
    "the same", "same thing", "that error", "the issue",
    "fix it", "fix that", "do that", "do it", "run it",
    "the file", "the path", "the command", "the output",
    "the result", "the one", "another one",
})

# Patterns that indicate a completely standalone query (skip rewrite)
_STANDALONE_STARTERS = re.compile(
    r"^(what is|what are|how to|how do|explain|describe|show me|list|give me|"
    r"search for|find|create|generate|make|write|deploy|check|run|ssh|connect)\b",
    re.IGNORECASE,
)


def _needs_rewriting(query: str, history: list[dict[str, Any]]) -> bool:
    """Heuristic: decide whether query rewriting is worthwhile."""
    if not history:
        return False

    q_lower = query.lower().strip()
    words = set(q_lower.split())

    # Any coreference signal present?
    if words & _COREFERENCE_SIGNALS:
        return True

    # Very short queries without clear standalone markers (e.g. "and?", "why?")
    if len(words) <= 4 and not _STANDALONE_STARTERS.match(q_lower):
        return True

    return False


def _format_history_snippet(history: list[dict[str, Any]], max_turns: int = 4) -> str:
    """Summarise the last few turns for the rewrite prompt."""
    recent = history[-max_turns * 2:]  # user+assistant pairs
    lines: list[str] = []
    for msg in recent:
        role = msg.get("role", "user")
        content = str(msg.get("content") or "")[:300]  # cap each turn
        if role in ("user", "assistant"):
            lines.append(f"{role.capitalize()}: {content}")
    return "\n".join(lines)


_REWRITE_SYSTEM = (
    "You are a search query optimizer. Rewrite the user's LAST message into a "
    "concise, fully self-contained search query (1-2 sentences). "
    "Include all relevant context from the conversation. "
    "Output ONLY the rewritten query — no explanation, no quotes, no preamble."
)


class QueryRewriter:
    """Rewrite ambiguous multi-turn queries into self-contained search queries.

    Args:
        llm: An OllamaService instance used for text generation.
    """

    def __init__(self, llm: Any) -> None:
        self._llm = llm

    async def rewrite(
        self,
        query: str,
        conversation_history: list[dict[str, Any]] | None = None,
    ) -> str:
        """Return a rewritten query if context resolution is needed, else the original.

        Args:
            query:                 The latest user message.
            conversation_history:  List of ``{"role": ..., "content": ...}`` dicts
                                   from the ongoing conversation (most recent last).

        Returns:
            Rewritten query string, or the original query if rewriting was skipped.
        """
        history = conversation_history or []

        if not _needs_rewriting(query, history):
            logger.debug("QueryRewriter: no rewrite needed for %r", query[:60])
            return query

        snippet = _format_history_snippet(history)
        prompt = (
            f"Conversation so far:\n{snippet}\n\n"
            f"Last user message: {query}\n\n"
            "Rewrite the last message as a standalone search query:"
        )

        try:
            rewritten = await self._llm.generate(prompt, system=_REWRITE_SYSTEM)
            rewritten = rewritten.strip().strip('"').strip("'")
            if not rewritten or len(rewritten) < 4:
                return query
            logger.info("QueryRewriter: %r → %r", query[:60], rewritten[:80])
            return rewritten
        except Exception as exc:
            logger.warning("QueryRewriter LLM call failed (%s) — using original query", exc)
            return query
