"""HTTP GET for public URLs — enables real page summaries instead of model guesses."""

from __future__ import annotations

import ipaddress
import json
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from ....core.config import get_settings
from ..base import BaseTool, Param, ToolResult

# Strip scripts/styles and tags for readable text (no extra deps)
_SCRIPT_STYLE_RE = re.compile(r"(?is)<(script|style)[^>]*>.*?</\1>")
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _html_to_text(html: str, max_chars: int) -> str:
    t = _SCRIPT_STYLE_RE.sub(" ", html)
    t = _TAG_RE.sub(" ", t)
    t = _WS_RE.sub(" ", t).strip()
    if len(t) > max_chars:
        t = t[: max_chars - 24] + "\n… [truncated]"
    return t


def _is_url_safe(url: str) -> tuple[bool, str]:
    try:
        p = urlparse(url.strip())
    except Exception:
        return False, "Invalid URL"
    if p.scheme not in ("http", "https"):
        return False, "Only http and https are allowed"
    host = (p.hostname or "").lower()
    if not host:
        return False, "Missing host"
    if host in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
        return False, "Local hosts are not allowed"
    if host.endswith(".local") or host.endswith(".internal"):
        return False, "Local/internal hostnames are not allowed"
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False, "Private/reserved IP targets are not allowed"
    except ValueError:
        pass
    return True, ""


class FetchUrlTool(BaseTool):
    """
    Fetches a public HTTP(S) URL from the AIPiloty server (not the user's browser).
    Returns status, content-type, and extracted text (HTML simplified).
    """

    name = "fetch_url"
    description = (
        "Fetch a public web page over HTTP/HTTPS and return readable text plus metadata. "
        "Use when the user pastes a URL, asks what a page says, OR asks you to **search / look up / recommend** "
        "something (e.g. best Ollama models): you must supply a concrete https URL yourself "
        "(e.g. https://ollama.com/library or a specific /library/<model> page). One URL per call. "
        "Do not invent page text — summarize only extracted_text from the result."
    )
    parameters = [
        Param("url", "string", "Full URL including https://", required=True),
        Param(
            "max_chars",
            "integer",
            "Max characters of extracted text (default 24000, max 80000)",
            required=False,
            default=24000,
        ),
    ]
    risk_level = "low"
    category = "web"

    async def execute(self, **kwargs: Any) -> ToolResult:
        url = str(kwargs.get("url") or "").strip()
        max_chars = int(kwargs.get("max_chars") or 24000)
        max_chars = max(2000, min(max_chars, 80_000))

        ok, err = _is_url_safe(url)
        if not ok:
            return ToolResult(error=err)

        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; AIPilotyFetch/1.0; +https://aipiloty.local)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        }
        verify_ssl = get_settings().fetch_url_verify_ssl
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(25.0, connect=10.0),
                follow_redirects=True,
                max_redirects=8,
                limits=httpx.Limits(max_connections=5),
                verify=verify_ssl,
            ) as client:
                resp = await client.get(url, headers=headers)
        except httpx.HTTPError as e:
            return ToolResult(error=f"Request failed: {e}")

        ctype = (resp.headers.get("content-type") or "").split(";")[0].strip().lower()
        body = resp.text
        # Hard cap raw bytes-equivalent for safety
        if len(body) > 2_000_000:
            body = body[:2_000_000]

        if "html" in ctype or (not ctype and "<html" in body[:2000].lower()):
            text = _html_to_text(body, max_chars)
        else:
            text = body[:max_chars]
            if len(body) > max_chars:
                text += "\n… [truncated]"

        out = {
            "final_url": str(resp.url),
            "status_code": resp.status_code,
            "content_type": ctype or "unknown",
            "extracted_text": text,
            "note": "Summarize only what appears in extracted_text; quote titles/headings when relevant.",
        }
        return ToolResult(output=json.dumps(out, ensure_ascii=False), metadata={"bytes": len(body)})
