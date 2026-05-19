"""Ollama-backed embedding service for RAG."""

from __future__ import annotations

import logging
from typing import List

import httpx

from ...core.config import get_settings

logger = logging.getLogger(__name__)

_TIMEOUT = 60.0
_BATCH_SIZE = 32


class EmbeddingService:
    """Generate embeddings via the local Ollama instance."""

    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.embedding_model

    async def embed_one(self, text: str) -> List[float]:
        """Embed a single text string."""
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(
                f"{self.base_url}/api/embeddings",
                json={"model": self.model, "prompt": text},
            )
            if r.status_code != 200:
                body = r.text
                raise RuntimeError(
                    f"Ollama embedding error ({r.status_code}): {body}. "
                    f"Ensure the model is pulled: `ollama pull {self.model}`"
                )
            data = r.json()
            return data["embedding"]

    async def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of texts. Calls Ollama sequentially in small batches."""
        results: List[List[float]] = []
        for i in range(0, len(texts), _BATCH_SIZE):
            batch = texts[i : i + _BATCH_SIZE]
            for text in batch:
                vec = await self.embed_one(text)
                results.append(vec)
        return results

    async def is_available(self) -> bool:
        """Check whether the embedding model is loaded in Ollama."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(f"{self.base_url}/api/tags")
                if r.status_code != 200:
                    return False
                models = r.json().get("models", [])
                return any(
                    m.get("name", "").startswith(self.model)
                    for m in models
                )
        except Exception:
            return False
