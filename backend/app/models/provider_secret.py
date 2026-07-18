"""Encrypted third-party provider API keys (OpenAI, Gemini, …).

Keys are stored Fernet-encrypted in SQLite — never in source or .env.
Only ENCRYPTION_KEY (master key) belongs in environment config.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint

from ..core.database import Base
from ..core.encryption import decrypt, encrypt


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ProviderSecret(Base):
    __tablename__ = "provider_secrets"
    __table_args__ = (UniqueConstraint("provider", name="uq_provider_secrets_provider"),)

    id = Column(Integer, primary_key=True)
    provider = Column(String(64), nullable=False)  # openai | gemini
    label = Column(String(128), nullable=True)
    api_key_encrypted = Column(String(2048), nullable=False)
    default_model = Column(String(128), nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    last_used_at = Column(DateTime, nullable=True)

    @property
    def api_key(self) -> str:
        return decrypt(self.api_key_encrypted) if self.api_key_encrypted else ""

    @api_key.setter
    def api_key(self, value: str) -> None:
        self.api_key_encrypted = encrypt(value.strip()) if value and value.strip() else ""

    def key_hint(self) -> str:
        """Masked hint for UI — never the full secret."""
        try:
            raw = self.api_key
        except Exception:
            return "••••"
        if len(raw) <= 8:
            return "••••" + raw[-2:] if raw else "••••"
        return f"{raw[:4]}…{raw[-4:]}"

    def to_public_dict(self) -> dict:
        return {
            "id": self.id,
            "provider": self.provider,
            "label": self.label or self.provider,
            "default_model": self.default_model,
            "is_active": bool(self.is_active),
            "configured": bool(self.api_key_encrypted),
            "key_hint": self.key_hint() if self.api_key_encrypted else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "last_used_at": self.last_used_at.isoformat() if self.last_used_at else None,
        }
