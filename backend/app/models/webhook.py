"""Persisted webhook model — outbound notifications on deployment events."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text

from ..core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Webhook(Base):
    __tablename__ = "webhooks"

    id = Column(Integer, primary_key=True)
    name = Column(String(256), nullable=False)
    url = Column(String(512), nullable=False)
    secret = Column(String(64), default="")
    events_json = Column(Text, default='["deployment.success"]')
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)

    @property
    def events(self) -> list[str]:
        try:
            return json.loads(self.events_json or "[]")
        except (ValueError, TypeError):
            return []

    @events.setter
    def events(self, value: list[str]) -> None:
        self.events_json = json.dumps(value)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "url": self.url,
            "secret": self.secret,
            "events": self.events,
            "active": self.active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
