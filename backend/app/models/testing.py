"""SQLAlchemy models for the Testing feature.

Tables:
  testing_targets  — registered API targets (URL + env label)
  test_runs        — individual execution runs per target
  test_results     — individual test case results within a run
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from ..core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TestingTarget(Base):
    __tablename__ = "testing_targets"

    id = Column(Integer, primary_key=True)
    name = Column(String(128), nullable=False, default="Unnamed Target")
    url = Column(String(2048), nullable=False)
    env_label = Column(String(64), nullable=False, default="")  # e.g. "staging", "prod"
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    runs = relationship("TestRun", back_populates="target", cascade="all, delete-orphan")


class TestRun(Base):
    __tablename__ = "test_runs"

    id = Column(Integer, primary_key=True)
    target_id = Column(Integer, ForeignKey("testing_targets.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), default="pending")  # pending | running | passed | failed | error
    pass_count = Column(Integer, default=0)
    fail_count = Column(Integer, default=0)
    skip_count = Column(Integer, default=0)
    output_json = Column(Text, nullable=True)   # full JSON result blob
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    target = relationship("TestingTarget", back_populates="runs")
    results = relationship("TestResult", back_populates="run", cascade="all, delete-orphan")


class TestResult(Base):
    __tablename__ = "test_results"

    id = Column(Integer, primary_key=True)
    run_id = Column(Integer, ForeignKey("test_runs.id", ondelete="CASCADE"), nullable=False)
    test_name = Column(String(512), nullable=False)
    status = Column(String(20), nullable=False)  # passed | failed | skipped | error
    duration_ms = Column(Float, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)

    run = relationship("TestRun", back_populates="results")
