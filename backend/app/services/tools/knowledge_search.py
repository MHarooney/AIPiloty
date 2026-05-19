"""kb_search — Agent tool for searching the local knowledge base."""

from __future__ import annotations

import logging
from typing import Any

from .base import BaseTool, Param, ToolResult
from .registry import ToolRegistry
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
        "Returns numbered results with content excerpts, source paths, and relevance scores."
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

    def __init__(self, retriever: RetrieverService) -> None:
        self._retriever = retriever

    async def execute(self, **kwargs: Any) -> ToolResult:
        query: str = kwargs.get("query", "")
        top_k: int = int(kwargs.get("top_k", 5))
        top_k = max(1, min(top_k, 10))

        if not query.strip():
            return ToolResult(error="query is required and cannot be empty.")

        try:
            results = await self._retriever.search(query=query, top_k=top_k)
        except RuntimeError as e:
            return ToolResult(
                error=f"Knowledge base search failed: {e}. "
                "Check that Qdrant is running and the embedding model is pulled."
            )
        except Exception as e:
            logger.exception("kb_search unexpected error")
            return ToolResult(error=f"Knowledge base unavailable: {e}")

        if not results:
            return ToolResult(
                output="No results found in the knowledge base for that query. "
                "The index may be empty — try ingesting documents first via /api/v1/rag/ingest."
            )

        formatted = []
        for i, r in enumerate(results, 1):
            formatted.append(r.format_citation(i))

        output = (
            f"Found {len(results)} result(s) in the knowledge base:\n\n"
            + "\n\n---\n\n".join(formatted)
        )
        return ToolResult(
            output=output,
            metadata={
                "result_count": len(results),
                "sources": [r.source_path for r in results],
            },
        )
