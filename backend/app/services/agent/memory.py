"""Agent memory — persistent context across conversations."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


class MemoryEntry:
    """A single memory item."""

    def __init__(self, key: str, value: Any, category: str = "general",
                 importance: float = 0.5, created_at: str | None = None):
        self.key = key
        self.value = value
        self.category = category
        self.importance = importance
        self.created_at = created_at or datetime.now(timezone.utc).isoformat()
        self.access_count = 0
        self.last_accessed: str | None = None

    def access(self):
        self.access_count += 1
        self.last_accessed = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return {
            "key": self.key,
            "value": self.value,
            "category": self.category,
            "importance": self.importance,
            "created_at": self.created_at,
            "access_count": self.access_count,
            "last_accessed": self.last_accessed,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "MemoryEntry":
        entry = cls(
            key=data["key"],
            value=data["value"],
            category=data.get("category", "general"),
            importance=data.get("importance", 0.5),
            created_at=data.get("created_at"),
        )
        entry.access_count = data.get("access_count", 0)
        entry.last_accessed = data.get("last_accessed")
        return entry


class AgentMemory:
    """File-backed agent memory with categories and importance scoring.

    Write operations are serialized through an asyncio.Lock to prevent
    concurrent coroutines from corrupting the JSON file, and the actual
    file I/O is offloaded to a thread pool via asyncio.to_thread so that
    it never blocks the event loop.
    """

    def __init__(self, storage_path: str | Path = "data/agent_memory.json"):
        self._path = Path(storage_path)
        self._entries: dict[str, MemoryEntry] = {}
        self._write_lock: asyncio.Lock | None = None  # lazy-init after event loop starts
        self._load()

    def _load(self):
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text())
                for item in data.get("entries", []):
                    entry = MemoryEntry.from_dict(item)
                    self._entries[entry.key] = entry
                logger.info("Agent memory loaded: %d entries", len(self._entries))
            except Exception as e:
                logger.warning("Failed to load agent memory: %s", e)

    def _get_write_lock(self) -> asyncio.Lock:
        if self._write_lock is None:
            self._write_lock = asyncio.Lock()
        return self._write_lock

    def _serialize(self) -> str:
        data = {
            "version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "entries": [e.to_dict() for e in self._entries.values()],
        }
        return json.dumps(data, indent=2)

    async def _save(self) -> None:
        """Persist memory to disk without blocking the event loop."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        payload = self._serialize()
        async with self._get_write_lock():
            await asyncio.to_thread(self._path.write_text, payload, "utf-8")

    async def remember(self, key: str, value: Any, category: str = "general",
                       importance: float = 0.5) -> MemoryEntry:
        """Store or update a memory entry."""
        if key in self._entries:
            self._entries[key].value = value
            self._entries[key].importance = importance
        else:
            self._entries[key] = MemoryEntry(key, value, category, importance)
        await self._save()
        return self._entries[key]

    def recall(self, key: str) -> Optional[Any]:
        """Retrieve a memory by key."""
        entry = self._entries.get(key)
        if entry:
            entry.access()
            return entry.value
        return None

    def search(self, query: str, category: Optional[str] = None,
               limit: int = 10) -> list[MemoryEntry]:
        """Search memories by keyword and optional category."""
        query_lower = query.lower()
        results = []
        for entry in self._entries.values():
            if category and entry.category != category:
                continue
            text = f"{entry.key} {json.dumps(entry.value)}".lower()
            if query_lower in text:
                entry.access()
                results.append(entry)

        # Sort by importance * recency
        results.sort(key=lambda e: e.importance * (1 + e.access_count * 0.1), reverse=True)
        return results[:limit]

    async def forget(self, key: str) -> bool:
        """Remove a memory entry."""
        if key in self._entries:
            del self._entries[key]
            await self._save()
            return True
        return False

    def get_context_summary(self, category: Optional[str] = None,
                            max_entries: int = 5) -> str:
        """Get a summary of important memories for LLM context injection."""
        entries = [e for e in self._entries.values()
                   if category is None or e.category == category]
        entries.sort(key=lambda e: e.importance, reverse=True)
        entries = entries[:max_entries]

        if not entries:
            return ""

        lines = ["## Agent Memory Context"]
        for e in entries:
            val = e.value if isinstance(e.value, str) else json.dumps(e.value)
            lines.append(f"- **{e.key}** [{e.category}]: {val}")
        return "\n".join(lines)

    @property
    def size(self) -> int:
        return len(self._entries)

    def list_categories(self) -> list[str]:
        return list(set(e.category for e in self._entries.values()))

    async def clear(self, category: Optional[str] = None) -> None:
        """Clear all entries, or only those in a specific category."""
        if category:
            self._entries = {k: v for k, v in self._entries.items() if v.category != category}
        else:
            self._entries.clear()
        await self._save()
