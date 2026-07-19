"""Micro-benchmarks for hot paths in the AIPiloty backend.

Run:
    pytest tests/performance/ --benchmark-only
    pytest tests/performance/ --benchmark-json=benchmark-results.json
"""

from __future__ import annotations

import json
import re

import pytest

pytestmark = pytest.mark.slow


# ── _extract_tool_call benchmark ─────────────────────────────────────────────

_SAMPLE_TOOL_TEXT = """
Let me check the health of the system.

```json
{"tool": "vm_health_check", "arguments": {"vm_id": 1}}
```
"""

_SAMPLE_TOOL_TEXT_XML = """
<tool_call>{"tool": "ssh_command", "arguments": {"vm_id": 1, "command": "df -h"}}</tool_call>
"""

_SAMPLE_TOOL_TEXT_NO_MATCH = """
Here is a general answer with no tool calls involved.
Just plain text output from the LLM.
"""


def test_extract_tool_call_json_block(benchmark):
    from app.services.agent.orchestrator import _extract_tool_call
    result = benchmark(_extract_tool_call, _SAMPLE_TOOL_TEXT)
    assert result is not None
    assert result["tool"] == "vm_health_check"


def test_extract_tool_call_xml_tag(benchmark):
    from app.services.agent.orchestrator import _extract_tool_call
    result = benchmark(_extract_tool_call, _SAMPLE_TOOL_TEXT_XML)
    assert result is not None
    assert result["tool"] == "ssh_command"


def test_extract_tool_call_no_match(benchmark):
    from app.services.agent.orchestrator import _extract_tool_call
    result = benchmark(_extract_tool_call, _SAMPLE_TOOL_TEXT_NO_MATCH)
    assert result is None


# ── Health endpoint round-trip ────────────────────────────────────────────────

def test_health_endpoint_latency(benchmark, client):
    """Health endpoint should complete well under 200 ms (p99 in CI)."""
    def _call():
        resp = client.get("/api/v1/health")
        assert resp.status_code in (200, 503)
        return resp

    benchmark(_call)


# ── Tool schema serialization ─────────────────────────────────────────────────

def test_tool_schema_generation(benchmark, _app):
    """to_ollama_schema() must be fast since it runs per request for each tool."""
    from app.main import app_state
    registry = app_state.get("registry")
    if registry is None:
        import pytest
        pytest.skip("app_state not populated in this test run")

    tools = registry.all_tools()
    assert tools, "No tools registered — check startup"

    def _serialize_all():
        return [t.to_ollama_schema() for t in tools]

    benchmark(_serialize_all)
