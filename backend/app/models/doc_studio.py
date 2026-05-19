"""SQLAlchemy models for the Doc Studio feature.

Tables:
  ds_notebooks        — top-level workspace containers
  ds_notebook_sources — ingested sources per notebook (file / url / project)
  ds_notebook_artifacts — generated documents per notebook
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from ..core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_uuid() -> str:
    return str(uuid.uuid4())


class Notebook(Base):
    __tablename__ = "ds_notebooks"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    name = Column(String(256), nullable=False)
    project_id = Column(String(36), nullable=True)   # optional link to a project folder
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    sources = relationship(
        "NotebookSource", back_populates="notebook", cascade="all, delete-orphan"
    )
    artifacts = relationship(
        "NotebookArtifact", back_populates="notebook", cascade="all, delete-orphan"
    )


class NotebookSource(Base):
    __tablename__ = "ds_notebook_sources"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    notebook_id = Column(
        String(36), ForeignKey("ds_notebooks.id", ondelete="CASCADE"), nullable=False
    )
    kind = Column(String(32), nullable=False)      # upload | url | project_ingest
    title = Column(String(512), nullable=False)
    is_enabled = Column(Boolean, default=True, nullable=False)
    # pending | indexing | ready | error
    status = Column(String(32), default="pending", nullable=False)
    # JSON blob: {filename?, url?, project_id?, path?, char_count?}
    meta_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    notebook = relationship("Notebook", back_populates="sources")


class NotebookArtifact(Base):
    __tablename__ = "ds_notebook_artifacts"

    id = Column(String(36), primary_key=True, default=_new_uuid)
    notebook_id = Column(
        String(36), ForeignKey("ds_notebooks.id", ondelete="CASCADE"), nullable=False
    )
    template = Column(String(64), nullable=False)   # brd | pt_report | srs | …
    title = Column(String(512), nullable=False)
    content_md = Column(Text, nullable=False, default="")
    # Relative path to generated DOCX/PDF inside the workspace (nullable until exported)
    docx_path = Column(String(1024), nullable=True)
    pdf_path = Column(String(1024), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    notebook = relationship("Notebook", back_populates="artifacts")
