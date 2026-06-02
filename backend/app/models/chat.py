"""Chat session and message models."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import relationship

from ..core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (
        Index("idx_sess_updated_at", "updated_at"),
    )

    id = Column(Integer, primary_key=True)
    session_key = Column(String(64), unique=True, nullable=False, default=lambda: uuid.uuid4().hex)
    title = Column(String(256), default="New Chat")
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan", order_by="ChatMessage.created_at")


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("idx_msg_session_id", "session_id"),
    )

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(20), nullable=False)  # user | assistant | system | tool
    content = Column(Text, default="")
    tool_calls_json = Column(Text, nullable=True)  # serialized JSON of tool calls
    tool_results_json = Column(Text, nullable=True)  # serialized JSON of tool results
    final_report_json = Column(Text, nullable=True)  # execution report JSON (tools_used path)
    attachments_json = Column(Text, nullable=True)  # serialized JSON of attachment metadata
    created_at = Column(DateTime, default=_utcnow)

    session = relationship("ChatSession", back_populates="messages")
