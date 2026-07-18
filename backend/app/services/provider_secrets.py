"""Image / LLM provider secret catalog and resolution.

Senior design:
- API keys live encrypted in DB (ProviderSecret), managed from Settings UI.
- Model catalog is static + filtered by which providers have keys.
- Agent / Images API resolve (provider, model) → live ImageProvider instance.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import async_session_factory
from ..models.provider_secret import ProviderSecret

logger = logging.getLogger(__name__)

# Canonical model catalog. Aliases let chat say "nano banana" / "dalle".
# Nano Banana family uses generateContent (not the retired 2.0 preview / Imagen predict ids).
IMAGE_MODEL_CATALOG: list[dict[str, Any]] = [
    {
        "id": "gpt-image-1",
        "provider": "openai",
        "label": "GPT Image 1",
        "description": "OpenAI — current Images API (recommended)",
        "aliases": ["gpt-image", "gptimage", "openai", "chatgpt"],
    },
    {
        "id": "dall-e-3",
        "provider": "openai",
        "label": "DALL·E 3",
        "description": "OpenAI — classic DALL·E 3 (may be unavailable on some keys)",
        "aliases": ["dalle", "dall-e", "dalle3", "dalle-3", "dall-e3"],
    },
    {
        "id": "gemini-2.5-flash-image",
        "provider": "gemini",
        "label": "Gemini · Nano Banana",
        "description": "Google Gemini 2.5 Flash Image (Nano Banana)",
        "aliases": [
            "nano-banana",
            "nano banana",
            "nano_banana",
            "nanobanana",
            "gemini-flash-image",
            "gemini-2.0-flash-preview-image-generation",
            "gemini",
        ],
    },
    {
        "id": "gemini-3.1-flash-image",
        "provider": "gemini",
        "label": "Gemini · Nano Banana 2",
        "description": "Google Gemini 3.1 Flash Image (Nano Banana 2 — newer)",
        "aliases": [
            "nano-banana-2",
            "nano banana 2",
            "nanobanana2",
            "imagen",
            "imagen3",
            "imagen-3.0-generate-002",
        ],
    },
]

SUPPORTED_PROVIDERS = ("openai", "gemini")


@dataclass
class ResolvedImageBackend:
    provider: str
    model: str
    api_key: str
    label: str


def catalog_entry(model_id: str) -> Optional[dict[str, Any]]:
    needle = (model_id or "").strip().lower()
    if not needle:
        return None
    for entry in IMAGE_MODEL_CATALOG:
        if entry["id"].lower() == needle:
            return entry
        aliases = [a.lower() for a in entry.get("aliases") or []]
        if needle in aliases:
            return entry
    return None


def user_named_image_model(text: str) -> Optional[str]:
    """Return catalog model id if the user explicitly named one in their message.

    Used so the agent cannot invent ``model=dall-e-3`` and skip the picker.
    Card clicks / typed choices include the model id in the user message.
    """
    if not (text or "").strip():
        return None
    lowered = text.lower()
    hits: list[tuple[int, str]] = []
    for entry in IMAGE_MODEL_CATALOG:
        names = [entry["id"], *(entry.get("aliases") or [])]
        for name in names:
            n = (name or "").strip().lower()
            if not n:
                continue
            # Skip ultra-generic aliases that appear in unrelated chat
            if n in {"openai", "gemini", "chatgpt"}:
                continue
            if re.search(rf"(?<![a-z0-9]){re.escape(n)}(?![a-z0-9])", lowered):
                hits.append((len(n), entry["id"]))
    if not hits:
        return None
    hits.sort(key=lambda x: x[0], reverse=True)
    return hits[0][1]


def apply_user_image_model_choice(args: dict[str, Any], user_text: str) -> dict[str, Any]:
    """Honor model/provider only when the user named them; otherwise strip for UI choice."""
    out = dict(args or {})
    named = user_named_image_model(user_text)
    if named:
        out["model"] = named
        out.pop("provider", None)
        return out
    out.pop("model", None)
    out.pop("provider", None)
    return out


def public_catalog(configured_providers: set[str] | None = None) -> list[dict[str, Any]]:
    """Models the UI/agent can offer. If configured_providers set, mark availability."""
    out = []
    for entry in IMAGE_MODEL_CATALOG:
        item = {
            "id": entry["id"],
            "provider": entry["provider"],
            "label": entry["label"],
            "description": entry["description"],
            "aliases": entry.get("aliases") or [],
            "available": (
                entry["provider"] in configured_providers
                if configured_providers is not None
                else True
            ),
        }
        out.append(item)
    return out


async def list_secrets(db: AsyncSession) -> list[ProviderSecret]:
    result = await db.execute(select(ProviderSecret).order_by(ProviderSecret.provider))
    return list(result.scalars().all())


async def get_secret(db: AsyncSession, provider: str) -> Optional[ProviderSecret]:
    result = await db.execute(
        select(ProviderSecret).where(ProviderSecret.provider == provider.lower())
    )
    return result.scalar_one_or_none()


async def upsert_secret(
    db: AsyncSession,
    *,
    provider: str,
    api_key: str,
    default_model: Optional[str] = None,
    label: Optional[str] = None,
) -> ProviderSecret:
    provider = provider.strip().lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise ValueError(f"Unsupported provider '{provider}'. Use: {', '.join(SUPPORTED_PROVIDERS)}")
    if not api_key or not api_key.strip():
        raise ValueError("api_key is required")

    row = await get_secret(db, provider)
    if row is None:
        row = ProviderSecret(provider=provider)
        db.add(row)

    row.api_key = api_key.strip()
    row.is_active = True
    if label is not None:
        row.label = label.strip() or provider
    if default_model is not None:
        entry = catalog_entry(default_model) if default_model else None
        if default_model and entry and entry["provider"] != provider:
            raise ValueError(f"Model '{default_model}' does not belong to provider '{provider}'")
        row.default_model = entry["id"] if entry else (default_model or None)
    elif not row.default_model:
        # Sensible default per provider
        for entry in IMAGE_MODEL_CATALOG:
            if entry["provider"] == provider:
                row.default_model = entry["id"]
                break
    row.updated_at = datetime.now(timezone.utc)
    await db.flush()
    return row


async def delete_secret(db: AsyncSession, provider: str) -> bool:
    row = await get_secret(db, provider)
    if not row:
        return False
    await db.delete(row)
    await db.flush()
    return True


async def configured_provider_ids(db: Optional[AsyncSession] = None) -> set[str]:
    async def _run(session: AsyncSession) -> set[str]:
        rows = await list_secrets(session)
        return {r.provider for r in rows if r.is_active and r.api_key_encrypted}

    if db is not None:
        return await _run(db)
    async with async_session_factory() as session:
        try:
            ids = await _run(session)
            await session.commit()
            return ids
        except Exception:
            await session.rollback()
            raise


async def resolve_image_backend(
    *,
    model: Optional[str] = None,
    provider: Optional[str] = None,
    db: Optional[AsyncSession] = None,
) -> tuple[Optional[ResolvedImageBackend], Optional[dict[str, Any]]]:
    """Resolve which cloud backend to use.

    Returns (backend, None) on success, or (None, clarification_payload) when the
    agent/UI should ask the user which model to use.
    """

    async def _resolve(session: AsyncSession):
        secrets = await list_secrets(session)
        active = [s for s in secrets if s.is_active and s.api_key_encrypted]
        configured = {s.provider for s in active}
        options = public_catalog(configured)
        available_options = [o for o in options if o["available"]]

        if not available_options:
            return None, {
                "status": "needs_api_key",
                "message": (
                    "No image API keys configured. Add OpenAI and/or Gemini keys in "
                    "Settings → Image Providers, then try again."
                ),
                "options": options,
            }

        chosen_model = (model or "").strip() or None
        chosen_provider = (provider or "").strip().lower() or None

        if chosen_model:
            entry = catalog_entry(chosen_model)
            if not entry:
                if len(available_options) == 1:
                    # Soft-heal typos / aliases when only one model is usable
                    only = available_options[0]
                    entry = catalog_entry(only["id"])
                    if entry and entry["provider"] in configured:
                        secret = next(s for s in active if s.provider == entry["provider"])
                        secret.last_used_at = datetime.now(timezone.utc)
                        return (
                            ResolvedImageBackend(
                                provider=entry["provider"],
                                model=entry["id"],
                                api_key=secret.api_key,
                                label=entry["label"],
                            ),
                            None,
                        )
                return None, {
                    "status": "needs_model_choice",
                    "message": f"Unknown image model '{chosen_model}'. Pick one:",
                    "options": options,
                }
            if entry["provider"] not in configured:
                return None, {
                    "status": "needs_api_key",
                    "message": (
                        f"Model {entry['label']} needs a {entry['provider']} API key. "
                        "Add it in Settings → Image Providers."
                    ),
                    "options": options,
                }
            secret = next(s for s in active if s.provider == entry["provider"])
            secret.last_used_at = datetime.now(timezone.utc)
            return (
                ResolvedImageBackend(
                    provider=entry["provider"],
                    model=entry["id"],
                    api_key=secret.api_key,
                    label=entry["label"],
                ),
                None,
            )

        if chosen_provider:
            if chosen_provider not in configured:
                return None, {
                    "status": "needs_api_key",
                    "message": f"No API key for provider '{chosen_provider}'. Add it in Settings.",
                    "options": options,
                }
            secret = next(s for s in active if s.provider == chosen_provider)
            mid = secret.default_model or next(
                e["id"] for e in IMAGE_MODEL_CATALOG if e["provider"] == chosen_provider
            )
            entry = catalog_entry(mid) or {"id": mid, "label": mid}
            secret.last_used_at = datetime.now(timezone.utc)
            return (
                ResolvedImageBackend(
                    provider=chosen_provider,
                    model=entry["id"],
                    api_key=secret.api_key,
                    label=entry.get("label", mid),
                ),
                None,
            )

        # Smart default: exactly one usable model → use it
        if len(available_options) == 1:
            only = available_options[0]
            entry = catalog_entry(only["id"])
            if entry and entry["provider"] in configured:
                secret = next(s for s in active if s.provider == entry["provider"])
                secret.last_used_at = datetime.now(timezone.utc)
                return (
                    ResolvedImageBackend(
                        provider=entry["provider"],
                        model=entry["id"],
                        api_key=secret.api_key,
                        label=entry["label"],
                    ),
                    None,
                )

        # Multiple models / providers → UI shows clickable choices (incl. locked ones)
        return None, {
            "status": "needs_model_choice",
            "message": "Which image model should I use?",
            "options": options,
        }

    if db is not None:
        return await _resolve(db)

    async with async_session_factory() as session:
        try:
            result = await _resolve(session)
            await session.commit()
            return result
        except Exception:
            await session.rollback()
            raise
