"""Pydantic schemas for API request/response validation."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Chat ──────────────────────────────────────────────────────────

class MessagePayload(BaseModel):
    role: str = "user"
    content: str
    attachment_ids: list[str] = []


class ChatRequest(BaseModel):
    messages: list[MessagePayload]
    session_key: Optional[str] = None
    auto_approve: bool = False
    model: Optional[str] = None  # Override default model for this request
    mode: Optional[str] = "auto"  # ask | agent | auto | plan | debug
    mission_id: Optional[int] = None  # Active Mission (deployment id) for Flight Deck scope


class ToolCallOut(BaseModel):
    name: str
    arguments: dict[str, Any] = {}


class ChatMessageOut(BaseModel):
    role: str
    content: str
    tool_calls: list[ToolCallOut] = []
    tool_results: list[dict[str, Any]] = []
    attachments: list[dict[str, Any]] = []
    created_at: Optional[datetime] = None
    final_report: Optional[dict[str, Any]] = None


class ChatSessionOut(BaseModel):
    session_key: str
    title: str
    messages: list[ChatMessageOut] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ── VM ────────────────────────────────────────────────────────────

class VMCreate(BaseModel):
    name: str
    provider: str
    host_ip: str
    ssh_username: str
    ssh_password: Optional[str] = None
    ssh_private_key: Optional[str] = None
    ssh_port: int = 22
    hostname: Optional[str] = None
    region: Optional[str] = None


class VMOut(BaseModel):
    id: int
    name: str
    provider: str
    host_ip: str
    hostname: Optional[str] = None
    region: Optional[str] = None
    ssh_username: str
    ssh_port: int
    is_active: bool
    ssh_host_key_fingerprint: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ── Deployment ────────────────────────────────────────────────────

class DeploymentCreate(BaseModel):
    name: str
    project_name: str
    environment: str = "staging"
    vm_credential_id: Optional[int] = None
    deploy_path: Optional[str] = None
    repository_url: Optional[str] = None
    branch: str = "main"
    # Docker pipeline fields
    docker_image: Optional[str] = None
    dockerhub_image: Optional[str] = None
    dockerhub_tag: str = "latest"
    container_name: Optional[str] = None
    port_mapping: Optional[str] = None
    build_platform: str = "linux/amd64"
    dockerfile: str = "Dockerfile"
    docker_network: Optional[str] = None
    docker_run_extra_args: Optional[str] = None
    # Trigger config
    trigger_type: str = "manual"
    cron_expression: Optional[str] = None
    webhook_secret: Optional[str] = None
    # Mission Control
    public_url: Optional[str] = None
    api_url: Optional[str] = None
    backend_container: Optional[str] = None
    pipeline_profile: Optional[str] = None
    mission_meta: Optional[str] = None


class DeploymentOut(BaseModel):
    id: int
    name: str
    project_name: str
    environment: str
    status: str
    vm_credential_id: Optional[int] = None
    deploy_path: Optional[str] = None
    repository_url: Optional[str] = None
    branch: str
    last_deployed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Docker pipeline fields
    docker_image: Optional[str] = None
    dockerhub_image: Optional[str] = None
    dockerhub_tag: str = "latest"
    container_name: Optional[str] = None
    port_mapping: Optional[str] = None
    build_platform: str = "linux/amd64"
    dockerfile: str = "Dockerfile"
    docker_network: Optional[str] = None
    docker_run_extra_args: Optional[str] = None
    trigger_type: str = "manual"
    cron_expression: Optional[str] = None
    webhook_secret: Optional[str] = None
    public_url: Optional[str] = None
    api_url: Optional[str] = None
    backend_container: Optional[str] = None
    pipeline_profile: Optional[str] = None
    mission_meta: Optional[str] = None


class DeploymentRunOut(BaseModel):
    id: int
    deployment_id: int
    trigger: str
    triggered_by: Optional[str] = None
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    log: Optional[str] = None
    duration_seconds: Optional[float] = None


class DeploymentAction(BaseModel):
    action: str = Field(..., pattern="^(deploy|stop|restart|scale|sync)$")
    params: dict[str, Any] = {}


# ── Health ────────────────────────────────────────────────────────

class ComponentHealth(BaseModel):
    ok: bool
    latency_ms: Optional[float] = None
    detail: Optional[str] = None


class HealthOut(BaseModel):
    status: str = "ok"          # "ok" | "degraded" | "unhealthy"
    app_name: str = "AIPiloty"
    # Legacy flat fields kept for backward compatibility
    ollama_connected: bool = False
    db_connected: bool = False
    # Rich per-component breakdown
    components: dict[str, ComponentHealth] = {}
