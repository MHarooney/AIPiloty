"""Web search tool — DuckDuckGo Instant Answer + HTML fallback (no API key)."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import unquote, urlparse, parse_qs

import httpx

from ..base import BaseTool, Param, ToolResult


_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")
# DDG HTML / lite result anchors
_HTML_RESULT_RE = re.compile(
    r'<a[^>]+class="[^"]*result__a[^"]*"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
    re.I | re.S,
)
_HTML_SNIPPET_RE = re.compile(
    r'<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>(.*?)</a>'
    r'|<td[^>]+class="[^"]*result-snippet[^"]*"[^>]*>(.*?)</td>',
    re.I | re.S,
)
_LITE_LINK_RE = re.compile(
    r'<a[^>]+rel="nofollow"[^>]+href="([^"]+)"[^>]*>(.*?)</a>',
    re.I | re.S,
)


def _strip_html(text: str) -> str:
    return _WS_RE.sub(" ", _TAG_RE.sub("", text or "")).strip()


def _unwrap_ddg_redirect(href: str) -> str:
    """DuckDuckGo wraps outbound links as /l/?uddg=<url>."""
    if not href:
        return href
    try:
        if "uddg=" in href:
            parsed = urlparse(href if "://" in href else f"https://duckduckgo.com{href}")
            qs = parse_qs(parsed.query)
            if "uddg" in qs and qs["uddg"]:
                return unquote(qs["uddg"][0])
    except Exception:
        pass
    return href


class WebSearchTool(BaseTool):
    """Search the web using DuckDuckGo (Instant Answer + HTML fallback)."""

    name = "web_search"
    description = (
        "Search the web for information using DuckDuckGo. Returns summaries, "
        "snippets, and links. Prefer short focused queries (one product/topic at a time). "
        "Use for comparisons, recommendations, and current external facts."
    )
    parameters = [
        Param("query", "string", "Search query (e.g. 'OpenAI gpt-image-1 features')"),
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
            async with httpx.AsyncClient(
                timeout=18,
                follow_redirects=True,
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (compatible; AIPiloty/1.0; +https://localhost) "
                        "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
                    ),
                    "Accept-Language": "en-US,en;q=0.9",
                },
            ) as client:
                instant = await self._instant_answer(client, query, max_results)
                if instant:
                    return ToolResult(
                        output="\n".join(instant),
                        metadata={"query": query, "result_count": len(instant), "source": "instant"},
                    )

                html_results = await self._html_search(client, query, max_results)
                if html_results:
                    return ToolResult(
                        output="\n".join(html_results),
                        metadata={
                            "query": query,
                            "result_count": len(html_results),
                            "source": "html",
                        },
                    )

            return ToolResult(
                output=(
                    f"No web snippets found for '{query}'. "
                    "Try a shorter query (one product name), or fetch_url on an official docs page. "
                    "If search stays empty, answer from your trained knowledge with a clear note that "
                    "web results were thin — never leave table cells as 'No information available'."
                ),
                metadata={"query": query, "result_count": 0},
            )

        except httpx.HTTPError as e:
            return ToolResult(error=f"Search request failed: {e}")
        except Exception as e:
            return ToolResult(error=f"Web search error: {e}")

    async def _instant_answer(
        self, client: httpx.AsyncClient, query: str, max_results: int
    ) -> list[str]:
        resp = await client.get(
            "https://api.duckduckgo.com/",
            params={"q": query, "format": "json", "no_html": "1", "skip_disambig": "1"},
        )
        resp.raise_for_status()
        data = resp.json()
        results: list[str] = []

        abstract = data.get("AbstractText", "")
        if abstract:
            results.append(f"**Summary**: {_strip_html(abstract)}")
            src = data.get("AbstractSource", "")
            url = data.get("AbstractURL", "")
            if src:
                results.append(f"Source: {src} — {url}")

        answer = data.get("Answer", "")
        if answer:
            results.append(f"**Answer**: {_strip_html(answer)}")

        related = data.get("RelatedTopics", [])[:max_results]
        if related:
            results.append("\n**Related:**")
            for item in related:
                text = item.get("Text", "")
                url = item.get("FirstURL", "")
                if text:
                    results.append(f"  • {_strip_html(text)}" + (f" [{url}]" if url else ""))
                for sub in item.get("Topics", [])[:3]:
                    text = sub.get("Text", "")
                    if text:
                        results.append(f"    ◦ {_strip_html(text)}")

        return results

    async def _html_search(
        self, client: httpx.AsyncClient, query: str, max_results: int
    ) -> list[str]:
        """HTML / lite DDG — works when Instant Answer is empty (most product compares)."""
        # Prefer lite (simpler markup)
        for url, params in (
            ("https://lite.duckduckgo.com/lite/", {"q": query}),
            ("https://html.duckduckgo.com/html/", {"q": query}),
        ):
            try:
                resp = await client.post(url, data=params) if "lite" in url else await client.get(
                    url, params=params
                )
                if resp.status_code >= 400:
                    continue
                parsed = self._parse_html_results(resp.text, max_results)
                if parsed:
                    return parsed
            except Exception:
                continue
        return []

    def _parse_html_results(self, html: str, max_results: int) -> list[str]:
        lines: list[str] = ["**Web results:**"]
        seen: set[str] = set()
        count = 0

        # html.duckduckgo.com style
        for m in _HTML_RESULT_RE.finditer(html):
            href = _unwrap_ddg_redirect(m.group(1))
            title = _strip_html(m.group(2))
            if not title or href in seen:
                continue
            if "duckduckgo.com" in href and "uddg=" not in m.group(1):
                continue
            seen.add(href)
            count += 1
            lines.append(f"  {count}. {title}")
            lines.append(f"     {href}")
            if count >= max_results:
                break

        if count:
            return lines

        # lite.duckduckgo.com style
        for m in _LITE_LINK_RE.finditer(html):
            href = _unwrap_ddg_redirect(m.group(1))
            title = _strip_html(m.group(2))
            if not title or len(title) < 3 or href in seen:
                continue
            if href.startswith("/") or "duckduckgo.com/y.js" in href:
                continue
            seen.add(href)
            count += 1
            lines.append(f"  {count}. {title}")
            lines.append(f"     {href}")
            if count >= max_results:
                break

        return lines if count else []
