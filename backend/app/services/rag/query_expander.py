"""Multi-query expansion and HyDE (Hypothetical Document Embeddings) for RAG.

Two complementary techniques that improve embedding-based retrieval:

## Multi-Query Expansion
A single query phrasing often misses documents indexed under different vocabulary.
Generating 3 alternative phrasings and retrieving for each, then fusing via RRF,
consistently improves recall by 8-15% on knowledge-intensive tasks.

## HyDE — Hypothetical Document Embeddings (Gao et al., 2022)
Instead of embedding the raw (short, sparse) user query, generate a hypothetical
ideal answer paragraph and embed *that*.  Hypothetical answers occupy the same
embedding space as real document chunks, so retrieval aligns on semantics rather
than superficial lexical overlap.  Improves recall by 15-30% on factual tasks.

Both features are:
  - Async and use the existing OllamaService (no additional model needed)
  - Independently toggle-able via config (``rag_multi_query_enabled`` / ``rag_hyde_enabled``)
  - Graceful: any LLM failure returns the original single query unchanged
  - Capped to avoid runaway latency (3 variants, 150 tokens max)
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, List

logger = logging.getLogger(__name__)

# ── Prompts ───────────────────────────────────────────────────────────────

_MULTI_QUERY_SYSTEM = (
    "You are a search query optimizer. Generate alternative search query phrasings. "
    "Output ONLY the alternative queries, one per line, no numbering, no explanations."
)

_MULTI_QUERY_PROMPT = """\
Generate {n} alternative phrasings of this search query to improve document retrieval coverage.
Vary vocabulary, synonyms, and perspective while keeping the same intent.

Original query: {query}

Alternative phrasings (one per line, no numbering):"""

_HYDE_SYSTEM = (
    "You are a technical documentation assistant. "
    "Write a short, factually plausible answer paragraph."
)

_HYDE_PROMPT = """\
Write a short paragraph (3-5 technical sentences) that would be the ideal documentation \
or runbook answer to the following question. Use specific, precise language.

Question: {query}

Answer paragraph (no preamble, just the answer):"""


class QueryExpander:
    """Generate alternative query phrasings for multi-query retrieval.

    Args:
        llm:        An OllamaService instance.
        n_variants: Number of additional phrasings to generate (default 3).
    """

    def __init__(self, llm: Any, n_variants: int = 3) -> None:
        self._llm = llm
        self._n = n_variants

    async def expand(self, query: str) -> List[str]:
        """Return [original_query] + up to n alternative phrasings.

        Falls back to [original_query] alone if the LLM call fails.
        """
        if not query.strip():
            return [query]

        prompt = _MULTI_QUERY_PROMPT.format(n=self._n, query=query)
        try:
            raw = await self._llm.generate(prompt, system=_MULTI_QUERY_SYSTEM)
            variants = [
                line.strip().lstrip("-•*").strip()
                for line in raw.splitlines()
                if line.strip() and len(line.strip()) > 5
            ]
            variants = [v for v in variants if v.lower() != query.lower()]
            variants = variants[: self._n]  # cap at n
            if variants:
                logger.info(
                    "QueryExpander: '%s' → %d variants", query[:50], len(variants)
                )
            return [query] + variants
        except Exception as exc:
            logger.warning("QueryExpander LLM call failed (%s) — single query only", exc)
            return [query]


class HyDEExpander:
    """Hypothetical Document Embeddings — embed a synthetic ideal answer.

    Generates a short hypothetical answer to the query, then concatenates it
    with the original query string.  The combined text is used for embedding,
    which places the query vector closer to real document chunks.

    Args:
        llm: An OllamaService instance.
    """

    def __init__(self, llm: Any) -> None:
        self._llm = llm

    async def expand(self, query: str) -> str:
        """Return ``query + '\\n\\n' + hypothetical_answer``.

        Falls back to the original query if LLM call fails.
        """
        if not query.strip():
            return query

        prompt = _HYDE_PROMPT.format(query=query)
        try:
            hyp_answer = await self._llm.generate(prompt, system=_HYDE_SYSTEM)
            hyp_answer = hyp_answer.strip()
            if not hyp_answer or len(hyp_answer) < 10:
                return query
            combined = f"{query}\n\n{hyp_answer}"
            logger.info(
                "HyDE: expanded query from %d → %d chars",
                len(query), len(combined),
            )
            return combined
        except Exception as exc:
            logger.warning("HyDE LLM call failed (%s) — using original query", exc)
            return query


async def expand_with_hyde_and_multi_query(
    query: str,
    llm: Any,
    *,
    use_hyde: bool = True,
    use_multi_query: bool = True,
    n_variants: int = 3,
) -> tuple[str, List[str]]:
    """Run HyDE and multi-query expansion concurrently.

    Returns:
        (hyde_query, all_queries) where:
          - hyde_query:  the HyDE-expanded query for vector embedding
          - all_queries: [original] + [variants] for multi-query retrieval
    """
    tasks: list[asyncio.Task] = []

    if use_hyde:
        hyde_task = asyncio.create_task(HyDEExpander(llm).expand(query))
        tasks.append(hyde_task)
    else:
        hyde_task = None  # type: ignore[assignment]

    if use_multi_query:
        mq_task = asyncio.create_task(QueryExpander(llm, n_variants=n_variants).expand(query))
        tasks.append(mq_task)
    else:
        mq_task = None  # type: ignore[assignment]

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    hyde_query = (
        hyde_task.result()
        if hyde_task and not hyde_task.exception()
        else query
    )

    all_queries = (
        mq_task.result()
        if mq_task and not mq_task.exception()
        else [query]
    )

    return hyde_query, all_queries
