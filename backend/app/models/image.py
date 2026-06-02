"""Generated image model for tracking image generation history."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Index, Integer, String, Text, Float

from ..core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class GeneratedImage(Base):
    __tablename__ = "generated_images"
    __table_args__ = (
        Index("idx_img_created_at", "created_at"),
    )

    id = Column(Integer, primary_key=True)
    image_id = Column(String(64), unique=True, nullable=False, default=lambda: uuid.uuid4().hex)
    prompt = Column(Text, nullable=False)
    negative_prompt = Column(Text, nullable=True)
    width = Column(Integer, default=512)
    height = Column(Integer, default=512)
    steps = Column(Integer, default=20)
    seed = Column(Integer, nullable=True)
    model = Column(String(128), nullable=True)
    provider = Column(String(64), default="local")
    relative_path = Column(String(512), nullable=False)
    file_size = Column(Integer, default=0)
    generation_time_ms = Column(Integer, default=0)
    status = Column(String(20), default="completed")  # completed | failed | pending
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
