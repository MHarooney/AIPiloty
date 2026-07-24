"""Curated LLM model catalog for the desktop model picker.

Only models whose provider has a configured API key (or Ollama) are returned.
Ids use ``provider:model`` so the ProviderRouter can pin correctly.
"""

from __future__ import annotations

from typing import Any

from ...core.config import get_settings

# Curated OpenRouter models (free + strong defaults) — not the full 400+ catalog.
# IDs verified against OpenRouter /models free tier (refresh periodically).
_OPENROUTER_MODELS: list[dict[str, str]] = [
    {
        "id": "openrouter:openrouter/auto",
        "label": "OpenRouter Auto",
        "description": "OpenRouter routes to the best available model",
        "provider": "openrouter",
    },
    {
        "id": "openrouter:openrouter/free",
        "label": "OpenRouter Free",
        "description": "Routes across free models only",
        "provider": "openrouter",
    },
    {
        "id": "openrouter:google/gemma-4-31b-it:free",
        "label": "Gemma 4 31B (free)",
        "description": "Google Gemma 4 via OpenRouter free tier",
        "provider": "openrouter",
    },
    {
        "id": "openrouter:openai/gpt-oss-20b:free",
        "label": "GPT-OSS 20B (free)",
        "description": "OpenAI open-weights free model",
        "provider": "openrouter",
    },
    {
        "id": "openrouter:nvidia/nemotron-3-nano-30b-a3b:free",
        "label": "Nemotron 3 Nano (free)",
        "description": "NVIDIA Nemotron free model",
        "provider": "openrouter",
    },
    {
        "id": "openrouter:poolside/laguna-s-2.1:free",
        "label": "Laguna S 2.1 (free)",
        "description": "Coding-oriented free model",
        "provider": "openrouter",
    },
]

_CLAUDE_MODELS: list[dict[str, str]] = [
    {
        "id": "claude:claude-sonnet-4-20250514",
        "label": "Claude Sonnet 4",
        "description": "Anthropic Sonnet 4",
        "provider": "claude",
    },
    {
        "id": "claude:claude-opus-4-20250514",
        "label": "Claude Opus 4",
        "description": "Anthropic Opus 4",
        "provider": "claude",
    },
]

_OPENAI_MODELS: list[dict[str, str]] = [
    {
        "id": "openai:gpt-4o",
        "label": "GPT-4o",
        "description": "OpenAI GPT-4o",
        "provider": "openai",
    },
    {
        "id": "openai:gpt-4o-mini",
        "label": "GPT-4o mini",
        "description": "Fast / cheaper OpenAI",
        "provider": "openai",
    },
]

_GEMINI_MODELS: list[dict[str, str]] = [
    {
        "id": "gemini:gemini-2.0-flash",
        "label": "Gemini 2.0 Flash",
        "description": "Google Gemini Flash",
        "provider": "gemini",
    },
    {
        "id": "gemini:gemini-2.5-pro",
        "label": "Gemini 2.5 Pro",
        "description": "Google Gemini Pro",
        "provider": "gemini",
    },
]


def configured_llm_providers() -> set[str]:
    """Return provider names that currently have credentials (ollama always)."""
    s = get_settings()
    out: set[str] = {"ollama"}
    if (s.openrouter_api_key or "").strip():
        out.add("openrouter")
    if (s.anthropic_api_key or "").strip():
        out.add("claude")
    if (s.openai_api_key or "").strip():
        out.add("openai")
    if (s.gemini_api_key or "").strip():
        out.add("gemini")
    return out


def list_llm_models(*, ollama_models: list[str] | None = None) -> dict[str, Any]:
    """Build the picker catalog: Auto + models for configured providers only."""
    configured = configured_llm_providers()
    openrouter_on = "openrouter" in configured
    models: list[dict[str, Any]] = [
        {
            "id": "auto",
            "label": "Auto" if not openrouter_on else "Auto (OpenRouter → Local)",
            "description": (
                "OpenRouter first, then other cloud keys, then local Ollama on failure"
                if openrouter_on
                else "Best available configured provider (failover chain)"
            ),
            "provider": "auto",
            "is_default": True,
        }
    ]

    if openrouter_on:
        models.extend(_OPENROUTER_MODELS)
    if "claude" in configured:
        models.extend(_CLAUDE_MODELS)
    if "openai" in configured:
        models.extend(_OPENAI_MODELS)
    if "gemini" in configured:
        models.extend(_GEMINI_MODELS)

    if "ollama" in configured:
        names = ollama_models or []
        if not names:
            s = get_settings()
            names = [s.ollama_model] if s.ollama_model else []
        for name in names:
            if not name:
                continue
            # Skip embedding-only models from the chat picker
            lower = name.lower()
            if "embed" in lower or "nomic-embed" in lower:
                continue
            models.append(
                {
                    "id": f"ollama:{name}",
                    "label": name,
                    "description": "Local Ollama (offline fallback)",
                    "provider": "ollama",
                }
            )

    return {
        "default": "auto",
        "models": models,
        "configured_providers": sorted(configured),
        "fallback": "ollama",
        "priority_hint": (
            "openrouter → … → ollama" if openrouter_on else "configured cloud → ollama"
        ),
    }
