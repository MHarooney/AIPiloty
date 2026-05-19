"""Web search tool — DuckDuckGo Instant Answer API (no API key required)."""

from __future__ import annotations

import re
from typing import Any

import httpx

from ..base import BaseTool, Param, ToolResult


_TAG_RE = re.compile(r"<[^>]+>")


def _strip_html(text: str) -> str:
    return _TAG_RE.sub("", text).strip()


class WebSearchTool(BaseTool):
    """Search the web using DuckDuckGo Instant Answer API."""

    name = "web_search"
    description = (
        "Search the web for information using DuckDuckGo. Returns instant answers, "
        "abstracts, and related topics. Use when the user asks about external info, "
        "comparisons, recommendations, or anything requiring current knowledge."
    )
    parameters = [
        Param("query", "string", "Search query (e.g. 'best nginx reverse proxy config')"),
        Param("max_results", "integer", "Maximum results to return", required=False, default=8),
    ]
    risk_level = "low"
    category = "research"
    rate_limit_per_minute = 15

    async def execute(self, **kw: Any) -> ToolResult:
        query = kw.get("query", "").strip()
        max_results = int(kw.get("max_results", 8))
        if not query:
            return ToolResult(error="Query is required")

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(
                    "https://api.duckduckgo.com/",
                    params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
                    headers={"User-Agent": "AIPiloty/1.0"},
                )
                resp.raise_for_status()
                data = resp.json()

            results = []

            # Abstract (Wikipedia-style)
            abstract = data.get("AbstractText", "")
            if abstract:
                results.append(f"**Summary**: {_strip_html(abstract)}")
                src = data.get("AbstractSource", "")
                url = data.get("AbstractURL", "")
                if src:
                    results.append(f"Source: {src} — {url}")

            # Answer (instant answer)
            answer = data.get("Answer", "")
            if answer:
                results.append(f"**Answer**: {_strip_html(answer)}")

            # Related topics
            related = data.get("RelatedTopics", [])[:max_results]
            if related:
                results.append("\n**Related:**")
                for item in related:
                    text = item.get("Text", "")
                    url = item.get("FirstURL", "")
                    if text:
                        results.append(f"  • {_strip_html(text)}" + (f" [{url}]" if url else ""))
                    # Nested topics (category groups)
                    for sub in item.get("Topics", [])[:3]:
                        text = sub.get("Text", "")
                        if text:
                            results.append(f"    ◦ {_strip_html(text)}")

            if not results:
                return ToolResult(
                    output=f"No direct results for '{query}'. Try rephrasing or use fetch_url with a specific URL.",
                    metadata={"query": query, "result_count": 0},
                )

            return ToolResult(
                output="\n".join(results),
                metadata={"query": query, "result_count": len(results)},
            )

        except httpx.HTTPError as e:
            return ToolResult(error=f"Search request failed: {e}")
        except Exception as e:
            return ToolResult(error=f"Web search error: {e}")
