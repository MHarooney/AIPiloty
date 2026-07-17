"""kb_search — Agent tool for searching the local knowledge base.

Phase 1 (2026-07-17): Accepts conversation_history for query rewriting.
Phase 2 (2026-07-17): Integrates CRAG corrective retrieval — when KB relevance
is poor/ambiguous the tool appends a web-search hint so the agent can fall back.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from .base import BaseTool, Param, ToolResult
from ..rag.retriever import RetrieverService

logger = logging.getLogger(__name__)


class KnowledgeSearchTool(BaseTool):
    """Search the local knowledge base (Qdrant + Ollama embeddings).

    Use when the user asks about project docs, code, architecture,
    or anything that might be in the indexed knowledge base.
    """

    name = "kb_search"
    description = (
        "Search the local knowledge base for relevant documents, code, and notes. "
        "Use when the user asks about project-specific information, documentation, "
        "codebase details, architecture, or setup guides. "
        "Returns numbered results with content excerpts, source paths, and relevance scores. "
        "If relevance is poor the tool will suggest using web_search as a fallback."
    )
    parameters = [
        Param(
            name="query",
            type="string",
            description="The search query — describe what you are looking for.",
            required=True,
        ),
        Param(
            name="top_k",
            type="integer",
            description="Number of results to return (1-10).",
            required=False,
            default=5,
        ),
    ]
    risk_level = "low"
    requires_approval = False
    category = "knowledge"

    def __init__(
        self,
        retriever: RetrieverService,
        corrective_retriever: Optional[Any] = None,   # CorrectiveRetriever | None
    ) -> None:
        self._retriever = retriever
        self._corrective = corrective_retriever        # Phase 2: CRAG wrapper

    async def execute(self, **kwargs: Any) -> ToolResult:
        query: str = kwargs.get("query", "")
        top_k: int = int(kwargs.get("top_k", 5))
        top_k = max(1, min(top_k, 10))

        # conversation_history is injected by the orchestrator at call time
        conversation_history: list[dict] = kwargs.get("conversation_history") or []

        if not query.strip():
            return ToolResult(error="query is required and cannot be empty.")

        try:
            # Phase 2: use CorrectiveRetriever when available, else plain retriever
            if self._corrective is not None:
                bundle = await self._corrective.search(
                    query=query,
                    top_k=top_k,
                    conversation_history=conversation_history,
                )
                results = bundle.results
                quality = bundle.quality
                web_hint = bundle.web_hint
            else:
                results = await self._retriever.search(
                    query=query,
                    top_k=top_k,
                    conversation_history=conversation_history,
                )
                quality = "good"
                web_hint = ""

        except RuntimeError as e:
            return ToolResult(
                error=f"Knowledge base search failed: {e}. "
                "Check that Qdrant is running and the embedding model is pulled."
            )
        except Exception as e:
            logger.exception("kb_search unexpected error")
            return ToolResult(error=f"Knowledge base unavailable: {e}")

        if not results:
            no_result_msg = (
                "No results found in the knowledge base for that query. "
                "The index may be empty — try ingesting documents first via /api/v1/rag/ingest."
            )
            if web_hint:
                no_result_msg += f"\n\n⚠️ {web_hint}"
            return ToolResult(output=no_result_msg)

        formatted = []
        for i, r in enumerate(results, 1):
            formatted.append(r.format_citation(i))

        output = (
            f"Found {len(results)} result(s) in the knowledge base:\n\n"
            + "\n\n---\n\n".join(formatted)
        )

        # Append CRAG web-search hint when quality is ambiguous or poor
        if web_hint:
            output += f"\n\n⚠️ **CRAG quality assessment ({quality}):** {web_hint}"

        return ToolResult(
            output=output,
            metadata={
                "result_count": len(results),
                "sources": [r.source_path for r in results],
                "reranked": self._retriever.reranker_available,
                "crag_quality": quality,
            },
        )
