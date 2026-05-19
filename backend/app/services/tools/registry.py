"""Tool registry — auto-discovery and schema generation."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from .base import BaseTool

logger = logging.getLogger(__name__)


class ToolRegistry:
    """Central registry of all available tools."""

    def __init__(self) -> None:
        self._tools: Dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        if tool.name in self._tools:
            logger.warning("Overwriting tool registration: %s", tool.name)
        self._tools[tool.name] = tool
        logger.info("Registered tool: %s [%s]", tool.name, tool.category)

    def register_many(self, tools: list[BaseTool]) -> None:
        for t in tools:
            self.register(t)

    def get(self, name: str) -> Optional[BaseTool]:
        return self._tools.get(name)

    def all_tools(self) -> List[BaseTool]:
        return list(self._tools.values())

    def by_category(self, category: str) -> List[BaseTool]:
        return [t for t in self._tools.values() if t.category == category]

    def to_ollama_schemas(self, categories: Optional[set[str]] = None) -> List[dict]:
        """Build Ollama tool schemas, optionally filtered by category."""
        tools = self._tools.values()
        if categories:
            tools = [t for t in tools if t.category in categories]
        return [t.to_ollama_schema() for t in tools]

    @property
    def tool_names(self) -> List[str]:
        return list(self._tools.keys())
