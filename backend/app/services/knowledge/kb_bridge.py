"""Knowledge base HTTP bridge to DeployPilot KB service."""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx

from ...core.config import get_settings

logger = logging.getLogger(__name__)

_TIMEOUT = 15.0


class KBBridgeService:
    """Proxies requests to the DeployPilot knowledge base API."""

    def __init__(self) -> None:
        settings = get_settings()
        self._base_url = settings.deploypilot_kb_url
        self._api_key = settings.deploypilot_kb_api_key

    @property
    def is_configured(self) -> bool:
        return bool(self._base_url)

    def _headers(self) -> dict[str, str]:
        h: dict[str, str] = {"Content-Type": "application/json"}
        if self._api_key:
            h["X-API-Key"] = self._api_key
        return h

    async def health_check(self) -> dict[str, Any]:
        if not self.is_configured:
            return {"available": False, "error": "DEPLOYPILOT_KB_URL not configured"}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                r = await client.get(f"{self._base_url}/api/v2/ai-agent/knowledge/stats", headers=self._headers())
                r.raise_for_status()
                return {"available": True}
        except Exception as e:
            logger.warning("KB health check failed: %s", e)
            return {"available": False, "error": str(e)}

    async def list_documents(
        self,
        source_type: Optional[str] = None,
        tags: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {"limit": limit, "offset": offset}
        if source_type:
            params["source_type"] = source_type
        if tags:
            params["tags"] = tags
        return await self._get("/api/v2/ai-agent/knowledge", params=params)

    async def search(self, query: str, mode: str = "hybrid", limit: int = 10) -> dict[str, Any]:
        return await self._get(
            "/api/v2/ai-agent/knowledge",
            params={"search": query, "mode": mode, "limit": limit},
        )

    async def get_stats(self) -> dict[str, Any]:
        return await self._get("/api/v2/ai-agent/knowledge/stats")

    async def get_document(self, doc_id: int) -> dict[str, Any]:
        return await self._get(f"/api/v2/ai-agent/knowledge/{doc_id}")

    async def ingest(self, title: str, content: str, source_type: str = "manual", tags: Optional[list[str]] = None) -> dict[str, Any]:
        body = {"title": title, "content": content, "source_type": source_type}
        if tags:
            body["tags"] = tags  # type: ignore[assignment]
        return await self._post("/api/v2/ai-agent/knowledge", json_body=body)

    async def ingest_file(self, file_content: bytes, filename: str) -> dict[str, Any]:
        if not self.is_configured:
            return {"error": "KB not configured"}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                r = await client.post(
                    f"{self._base_url}/api/v2/ai-agent/knowledge/ingest-file",
                    headers={"X-API-Key": self._api_key} if self._api_key else {},
                    files={"file": (filename, file_content)},
                )
                r.raise_for_status()
                return r.json()
        except Exception as e:
            logger.error("KB file ingest failed: %s", e)
            return {"error": str(e)}

    async def delete_document(self, doc_id: int) -> dict[str, Any]:
        if not self.is_configured:
            return {"error": "KB not configured"}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                r = await client.delete(
                    f"{self._base_url}/api/v2/ai-agent/knowledge/{doc_id}",
                    headers=self._headers(),
                )
                r.raise_for_status()
                return r.json()
        except Exception as e:
            logger.error("KB delete failed: %s", e)
            return {"error": str(e)}

    # ── Internal helpers ──────────────────────────────

    async def _get(self, path: str, params: Optional[dict] = None) -> dict[str, Any]:
        if not self.is_configured:
            return {"error": "KB not configured"}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                r = await client.get(f"{self._base_url}{path}", headers=self._headers(), params=params)
                r.raise_for_status()
                return r.json()
        except Exception as e:
            logger.error("KB GET %s failed: %s", path, e)
            return {"error": str(e)}

    async def _post(self, path: str, json_body: dict) -> dict[str, Any]:
        if not self.is_configured:
            return {"error": "KB not configured"}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                r = await client.post(f"{self._base_url}{path}", headers=self._headers(), json=json_body)
                r.raise_for_status()
                return r.json()
        except Exception as e:
            logger.error("KB POST %s failed: %s", path, e)
            return {"error": str(e)}
