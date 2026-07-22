"""Anthropic Claude adapter — streaming chat completions.

Uses the official `anthropic` Python SDK.
Converts Anthropic message format → Ollama-shaped chunks so the
ProviderRouter can treat all providers uniformly.

Supports:
  - Streaming text completions
  - Tool/function calling (via Anthropic tool_use blocks)
  - Model selection (claude-3-5-sonnet-20241022 default)
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Optional

logger = logging.getLogger(__name__)

DEFAULT_ANTHROPIC_MODEL = "claude-3-5-sonnet-20241022"
MAX_TOKENS = 8192


def _to_anthropic_messages(
    messages: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Split messages into (system_prompt, anthropic_messages).

    Anthropic requires the system prompt as a top-level field, not a message.
    Consecutive user/assistant turns are preserved; tool results are mapped
    to the correct format.
    """
    system_parts: list[str] = []
    converted: list[dict[str, Any]] = []

    for m in messages:
        role = m.get("role", "user")
        content = m.get("content")

        if role == "system":
            if content:
                system_parts.append(str(content))
            continue

        if role == "tool":
            # Map tool results to Anthropic's user tool_result format
            converted.append({
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": m.get("tool_call_id", "unknown"),
                        "content": str(content or ""),
                    }
                ],
            })
            continue

        # Regular user / assistant
        if role in ("user", "assistant") and content:
            converted.append({"role": role, "content": str(content)})

    return "\n\n".join(system_parts), converted


def _tools_to_anthropic(
    tools: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Convert Ollama-style tool dicts to Anthropic's tool format."""
    if not tools:
        return []
    result = []
    for t in tools:
        fn = t.get("function") or t
        result.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
        })
    return result


async def anthropic_chat_stream(
    messages: list[dict[str, Any]],
    *,
    model: str | None = None,
    api_key: str | None = None,
    tools: list[dict[str, Any]] | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Stream Claude completions as Ollama-shaped chunks.

    Yields: {"message": {"content": "..."}, "done": False}
    Final:  {"message": {"content": ""}, "done": True}
    Tool calls also yield Ollama-compatible tool_calls format.
    """
    try:
        import anthropic as _anthropic
    except ImportError:
        raise RuntimeError(
            "anthropic package not installed. "
            "Run: pip install anthropic"
        )

    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY not configured")

    model_name = model or DEFAULT_ANTHROPIC_MODEL
    system_prompt, converted_messages = _to_anthropic_messages(messages)
    anthropic_tools = _tools_to_anthropic(tools)

    client = _anthropic.AsyncAnthropic(api_key=api_key)

    kwargs: dict[str, Any] = {
        "model": model_name,
        "max_tokens": MAX_TOKENS,
        "messages": converted_messages,
    }
    if system_prompt:
        kwargs["system"] = system_prompt
    if anthropic_tools:
        kwargs["tools"] = anthropic_tools

    # Accumulate tool use blocks for yielding at end
    current_tool: dict[str, Any] | None = None
    tool_input_buf: str = ""
    accumulated_text = ""

    try:
        async with client.messages.stream(**kwargs) as stream:
            async for event in stream:
                event_type = type(event).__name__

                if event_type == "RawContentBlockStartEvent":
                    block = getattr(event, "content_block", None)
                    if block and getattr(block, "type", None) == "tool_use":
                        current_tool = {
                            "id": block.id,
                            "name": block.name,
                        }
                        tool_input_buf = ""

                elif event_type == "RawContentBlockDeltaEvent":
                    delta = getattr(event, "delta", None)
                    if delta is None:
                        continue
                    delta_type = getattr(delta, "type", None)

                    if delta_type == "text_delta":
                        text = getattr(delta, "text", "") or ""
                        accumulated_text += text
                        yield {"message": {"content": text}, "done": False}

                    elif delta_type == "input_json_delta":
                        tool_input_buf += getattr(delta, "partial_json", "") or ""

                elif event_type == "RawContentBlockStopEvent":
                    if current_tool is not None:
                        # Yield complete tool call in Ollama format
                        try:
                            parsed_input = json.loads(tool_input_buf) if tool_input_buf else {}
                        except json.JSONDecodeError:
                            parsed_input = {"raw": tool_input_buf}

                        yield {
                            "message": {
                                "content": "",
                                "tool_calls": [
                                    {
                                        "function": {
                                            "name": current_tool["name"],
                                            "arguments": parsed_input,
                                        }
                                    }
                                ],
                            },
                            "done": False,
                        }
                        current_tool = None
                        tool_input_buf = ""

        yield {"message": {"content": ""}, "done": True}

    except Exception as exc:
        logger.error("[anthropic] Stream error: %s", exc)
        raise
    finally:
        await client.close()
