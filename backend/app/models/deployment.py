"""Deployment model with state machine support."""

from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Enum, Float, ForeignKey, Index, Integer, String, Text
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


class TriggerType(str, enum.Enum):
    MANUAL = "manual"
    WEBHOOK = "webhook"
    SCHEDULED = "scheduled"


class RunStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    CANCELLED = "cancelled"


# Valid state transitions
VALID_TRANSITIONS: dict[DeploymentStatus, set[DeploymentStatus]] = {
    DeploymentStatus.PENDING: {DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING, DeploymentStatus.FAILED},
    DeploymentStatus.BUILDING: {DeploymentStatus.DEPLOYING, DeploymentStatus.FAILED},
    DeploymentStatus.DEPLOYING: {DeploymentStatus.RUNNING, DeploymentStatus.FAILED, DeploymentStatus.ROLLING_BACK},
    DeploymentStatus.RUNNING: {DeploymentStatus.STOPPED, DeploymentStatus.DEPLOYING, DeploymentStatus.FAILED},
    DeploymentStatus.STOPPED: {DeploymentStatus.DEPLOYING, DeploymentStatus.PENDING},
    DeploymentStatus.FAILED: {DeploymentStatus.PENDING, DeploymentStatus.DEPLOYING},
    DeploymentStatus.ROLLING_BACK: {DeploymentStatus.RUNNING, DeploymentStatus.FAILED},
}


class Deployment(Base):
    __tablename__ = "deployments"
    __table_args__ = (
        Index("idx_dep_status", "status"),
        Index("idx_dep_updated_at", "updated_at"),
    )

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

    # Docker pipeline fields
    docker_image = Column(String(512), nullable=True)        # local build tag, e.g. harooney/docker-vue-lms-demo
    dockerhub_image = Column(String(512), nullable=True)     # DockerHub image name
    dockerhub_tag = Column(String(256), default="latest")    # DockerHub tag
    container_name = Column(String(256), nullable=True)      # container name on remote VM
    port_mapping = Column(String(64), nullable=True)         # e.g. "8082:80"
    build_platform = Column(String(64), default="linux/amd64")
    dockerfile = Column(String(256), default="Dockerfile")
    docker_network = Column(String(256), nullable=True)
    docker_run_extra_args = Column(String(512), nullable=True)  # e.g. "--restart unless-stopped"

    # Trigger configuration
    trigger_type = Column(Enum(TriggerType), default=TriggerType.MANUAL)
    cron_expression = Column(String(64), nullable=True)
    webhook_secret = Column(String(64), nullable=True)       # inbound webhook URL token

    vm_credential = relationship("VMCredential", back_populates="deployments")
    runs = relationship("DeploymentRun", back_populates="deployment", cascade="all, delete-orphan", order_by="DeploymentRun.id.desc()")

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
            # Docker pipeline fields
            "docker_image": self.docker_image,
            "dockerhub_image": self.dockerhub_image,
            "dockerhub_tag": self.dockerhub_tag or "latest",
            "container_name": self.container_name,
            "port_mapping": self.port_mapping,
            "build_platform": self.build_platform or "linux/amd64",
            "dockerfile": self.dockerfile or "Dockerfile",
            "docker_network": self.docker_network,
            "docker_run_extra_args": self.docker_run_extra_args,
            "trigger_type": self.trigger_type.value if self.trigger_type else "manual",
            "cron_expression": self.cron_expression,
            "webhook_secret": self.webhook_secret,
        }


class DeploymentRun(Base):
    __tablename__ = "deployment_runs"

    id = Column(Integer, primary_key=True)
    deployment_id = Column(Integer, ForeignKey("deployments.id", ondelete="CASCADE"), nullable=False)
    trigger = Column(Enum(TriggerType), default=TriggerType.MANUAL, nullable=False)
    triggered_by = Column(String(256), nullable=True)
    status = Column(Enum(RunStatus), default=RunStatus.PENDING, nullable=False)
    started_at = Column(DateTime, default=_utcnow)
    completed_at = Column(DateTime, nullable=True)
    log = Column(Text, nullable=True)
    duration_seconds = Column(Float, nullable=True)

    deployment = relationship("Deployment", back_populates="runs")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "deployment_id": self.deployment_id,
            "trigger": self.trigger.value if self.trigger else "manual",
            "triggered_by": self.triggered_by,
            "status": self.status.value if self.status else "pending",
            "started_at": self.started_at.isoformat() if self.started_at else None,
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            "log": self.log,
            "duration_seconds": self.duration_seconds,
        }
