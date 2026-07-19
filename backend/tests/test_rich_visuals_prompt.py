"""Ensure system prompt builds and includes rich-visuals guidance."""
from __future__ import annotations

from app.services.agent.orchestrator import _SYSTEM_PROMPT_CACHE, _build_system_prompt
from app.services.tools.base import BaseTool, ToolResult


class _DummyTool(BaseTool):
    name = "dummy"
    description = "dummy"
    category = "test"
    risk_level = "low"
    parameters = []

    async def execute(self, **kwargs) -> ToolResult:  # type: ignore[override]
        return ToolResult(success=True, output="ok")


def test_system_prompt_includes_rich_visuals():
    _SYSTEM_PROMPT_CACHE.clear()
    prompt = _build_system_prompt([_DummyTool()])
    assert "RICH VISUALS IN CHAT" in prompt
    assert "```mermaid" in prompt
    assert "generate_image" in prompt
    assert "GitHub-flavored" in prompt
    assert "{MFA OK?}" in prompt  # f-string: {{MFA OK?}} → Mermaid diamond
    assert "style A --> B" in prompt
    assert "mindmap" in prompt
    assert "root((DevOps))" in prompt
