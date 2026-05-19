"""Deployment model with state machine support."""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from ..core.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class DeploymentStatus(str, enum.Enum):
    PENDING = "pending"
    BUILDING = "building"
    DEPLOYING = "deploying"
    RUNNING = "running"
    STOPPED = "stopped"
    FAILED = "failed"
    ROLLING_BACK = "rolling_back"


# Valid state transitions
VALID_TRANSITIONS: dict[DeploymentStatus, set[DeploymentStatus]] = {
    DeploymentStatus.PENDING: {DeploymentStatus.BUILDING, DeploymentStatus.FAILED},
    DeploymentStatus.BUILDING: {DeploymentStatus.DEPLOYING, DeploymentStatus.FAILED},
    DeploymentStatus.DEPLOYING: {DeploymentStatus.RUNNING, DeploymentStatus.FAILED, DeploymentStatus.ROLLING_BACK},
    DeploymentStatus.RUNNING: {DeploymentStatus.STOPPED, DeploymentStatus.DEPLOYING, DeploymentStatus.FAILED},
    DeploymentStatus.STOPPED: {DeploymentStatus.DEPLOYING, DeploymentStatus.PENDING},
    DeploymentStatus.FAILED: {DeploymentStatus.PENDING, DeploymentStatus.DEPLOYING},
    DeploymentStatus.ROLLING_BACK: {DeploymentStatus.RUNNING, DeploymentStatus.FAILED},
}


class Deployment(Base):
    __tablename__ = "deployments"

    id = Column(Integer, primary_key=True)
    name = Column(String(256), nullable=False)
    project_name = Column(String(256), nullable=False)
    environment = Column(String(64), default="staging")
    status = Column(Enum(DeploymentStatus), default=DeploymentStatus.PENDING, nullable=False)
    vm_credential_id = Column(Integer, ForeignKey("vm_credentials.id"), nullable=True)
    deploy_path = Column(String(512))
    repository_url = Column(String(512))
    branch = Column(String(128), default="main")
    last_deployed_at = Column(DateTime, nullable=True)
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    vm_credential = relationship("VMCredential", back_populates="deployments")

    def can_transition_to(self, new_status: DeploymentStatus) -> bool:
        allowed = VALID_TRANSITIONS.get(self.status, set())
        return new_status in allowed

    def transition_to(self, new_status: DeploymentStatus) -> None:
        if not self.can_transition_to(new_status):
            raise ValueError(
                f"Invalid transition: {self.status.value} → {new_status.value}"
            )
        self.status = new_status
        self.updated_at = _utcnow()
        if new_status == DeploymentStatus.RUNNING:
            self.last_deployed_at = _utcnow()
            self.error_message = None
        elif new_status == DeploymentStatus.FAILED:
            pass  # error_message set separately

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "project_name": self.project_name,
            "environment": self.environment,
            "status": self.status.value if self.status else None,
            "vm_credential_id": self.vm_credential_id,
            "deploy_path": self.deploy_path,
            "repository_url": self.repository_url,
            "branch": self.branch,
            "last_deployed_at": self.last_deployed_at.isoformat() if self.last_deployed_at else None,
            "error_message": self.error_message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
