"""Google Gemini adapter — streaming chat completions.

Uses the official `google-generativeai` Python SDK.
Converts Gemini response format → Ollama-shaped chunks for ProviderRouter.

Supports:
  - Streaming text completions
  - Function/tool calling
  - Model selection (gemini-1.5-pro default)
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncGenerator, Optional

logger = logging.getLogger(__name__)

DEFAULT_GEMINI_MODEL = "gemini-1.5-pro"


def _to_gemini_history(
    messages: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    """Split messages into (system_prompt, gemini_history).

    Gemini uses 'user' and 'model' roles (not 'assistant').
    The system instruction is passed separately.
    """
    system_parts: list[str] = []
    history: list[dict[str, Any]] = []

    for m in messages:
        role = m.get("role", "user")
        content = m.get("content", "")

        if role == "system":
            if content:
                system_parts.append(str(content))
            continue

        if role == "tool":
            # Map tool results to Gemini's function_response format
            history.append({
                "role": "user",
                "parts": [
                    {
                        "function_response": {
                            "name": m.get("name", "tool"),
                            "response": {"content": str(content or "")},
                        }
                    }
                ],
            })
            continue

        gemini_role = "model" if role == "assistant" else "user"
        if content:
            history.append({"role": gemini_role, "parts": [{"text": str(content)}]})

    return "\n\n".join(system_parts), history


def _tools_to_gemini(
    tools: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Convert Ollama-style tools to Gemini function declarations."""
    if not tools:
        return []
    declarations = []
    for t in tools:
        fn = t.get("function") or t
        declarations.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "parameters": fn.get("parameters", {"type": "object", "properties": {}}),
        })
    return [{"function_declarations": declarations}]


async def gemini_chat_stream(
    messages: list[dict[str, Any]],
    *,
    model: str | None = None,
    api_key: str | None = None,
    tools: list[dict[str, Any]] | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """Stream Gemini completions as Ollama-shaped chunks.

    Yields: {"message": {"content": "..."}, "done": False}
    Final:  {"message": {"content": ""}, "done": True}
    """
    try:
        import google.generativeai as genai
    except ImportError:
        raise RuntimeError(
            "google-generativeai package not installed. "
            "Run: pip install google-generativeai"
        )

    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    genai.configure(api_key=api_key)

    model_name = model or DEFAULT_GEMINI_MODEL
    system_prompt, history = _to_gemini_history(messages)
    gemini_tools = _tools_to_gemini(tools)

    # Separate the last user message from history for send_message
    if not history:
        raise RuntimeError("No messages to send to Gemini")

    last_message = history[-1]
    prior_history = history[:-1]

    # Build the model
    gm_kwargs: dict[str, Any] = {}
    if system_prompt:
        gm_kwargs["system_instruction"] = system_prompt
    if gemini_tools:
        gm_kwargs["tools"] = gemini_tools

    gm = genai.GenerativeModel(model_name, **gm_kwargs)

    # Create chat session with prior history
    chat = gm.start_chat(history=prior_history)

    # Extract text from last message parts
    last_text = ""
    for part in last_message.get("parts", []):
        if isinstance(part, dict) and "text" in part:
            last_text += part["text"]
        elif isinstance(part, str):
            last_text += part

    try:
        response = await chat.send_message_async(last_text, stream=True)

        async for chunk in response:
            # Text parts
            for part in chunk.parts:
                if hasattr(part, "text") and part.text:
                    yield {"message": {"content": part.text}, "done": False}

                elif hasattr(part, "function_call") and part.function_call:
                    fc = part.function_call
                    try:
                        args = dict(fc.args) if hasattr(fc, "args") else {}
                    except Exception:
                        args = {}
                    yield {
                        "message": {
                            "content": "",
                            "tool_calls": [
                                {
                                    "function": {
                                        "name": fc.name,
                                        "arguments": args,
                                    }
                                }
                            ],
                        },
                        "done": False,
                    }

        yield {"message": {"content": ""}, "done": True}

    except Exception as exc:
        logger.error("[gemini] Stream error: %s", exc)
        raise
