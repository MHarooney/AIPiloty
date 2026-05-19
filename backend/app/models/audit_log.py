"""Audit log model — tracks key system actions."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Integer, String, Text

from ..core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    action = Column(String(128), nullable=False, index=True)
    user = Column(String(255), nullable=False, default="system")
    resource = Column(String(255), nullable=True)
    details = Column(Text, nullable=True)  # JSON string
    ip_address = Column(String(45), nullable=True)
    created_at = Column(DateTime, default=_utcnow, index=True)
