"""BaseTool ABC and ToolResult value-object for the agent tool system."""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class ToolResult:
    """Return value from any tool execution."""

    output: Any = ""
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @property
    def success(self) -> bool:
        return self.error is None

    def to_dict(self) -> dict:
        d: dict = {"success": self.success, "output": self.output}
        if self.error:
            d["error"] = self.error
        if self.metadata:
            d["metadata"] = self.metadata
        return d


@dataclass
class Param:
    """Declarative parameter descriptor."""

    name: str
    type: str = "string"
    description: str = ""
    required: bool = True
    default: Any = None
    enum: Optional[List[str]] = None

    _TYPE_MAP = {"string": "string", "integer": "integer", "number": "number", "boolean": "boolean"}

    def to_json_schema(self) -> dict:
        schema: dict = {
            "type": self._TYPE_MAP.get(self.type, "string"),
            "description": self.description,
        }
        if self.enum:
            schema["enum"] = self.enum
        if self.default is not None:
            schema["default"] = self.default
        return schema


class BaseTool(abc.ABC):
    """Abstract base for all agent tools."""

    name: str = ""
    description: str = ""
    parameters: List[Param] = []
    risk_level: str = "low"
    requires_approval: bool = False
    rate_limit_per_minute: int = 30
    category: str = "general"

    @abc.abstractmethod
    async def execute(self, **kwargs: Any) -> ToolResult:
        ...

    def to_ollama_schema(self) -> dict:
        """Return an Ollama-compatible tool schema dict."""
        properties: Dict[str, dict] = {}
        required: List[str] = []
        for p in self.parameters:
            properties[p.name] = p.to_json_schema()
            if p.required:
                required.append(p.name)
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": {
                    "type": "object",
                    "properties": properties,
                    "required": required,
                },
            },
        }
