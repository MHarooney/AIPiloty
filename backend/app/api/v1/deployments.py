"""Deployment API routes — CRUD + pipeline execution + run history."""

from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.deployment import (
    Deployment,
    DeploymentRun,
    DeploymentStatus,
    RunStatus,
    TriggerType,
)
from ...schemas.api import DeploymentAction, DeploymentCreate, DeploymentOut, DeploymentRunOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/deployments", tags=["Deployments"])


# ── CRUD ─────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[DeploymentOut])
async def list_deployments(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Deployment)
        .options(selectinload(Deployment.vm_credential))
        .order_by(Deployment.updated_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return [DeploymentOut(**d.to_dict()) for d in result.scalars().all()]


@router.post("/", response_model=DeploymentOut)
async def create_deployment(
    payload: DeploymentCreate,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    data = payload.model_dump()
    if not data.get("webhook_secret"):
        data["webhook_secret"] = secrets.token_hex(24)
    dep = Deployment(**data)
    db.add(dep)
    await db.flush()
    await db.refresh(dep)
    return DeploymentOut(**dep.to_dict())


@router.get("/history/all")
async def get_deployment_history(
    limit: int = 50,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Deployment)
        .where(Deployment.last_deployed_at.isnot(None))
        .order_by(Deployment.last_deployed_at.desc())
        .limit(limit)
    )
    return [{**d.to_dict(), "duration": None} for d in result.scalars().all()]


@router.get("/{deployment_id}", response_model=DeploymentOut)
async def get_deployment(
    deployment_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")
    return DeploymentOut(**dep.to_dict())


@router.put("/{deployment_id}", response_model=DeploymentOut)
async def update_deployment(
    deployment_id: int,
    payload: DeploymentCreate,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(dep, field, value)
    await db.commit()
    await db.refresh(dep)
    return DeploymentOut(**dep.to_dict())


@router.delete("/{deployment_id}")
async def delete_deployment(
    deployment_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")
    await db.delete(dep)
    await db.commit()
    return {"status": "deleted"}


@router.post("/{deployment_id}/action")
async def deployment_action(
    deployment_id: int,
    action: DeploymentAction,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")

    action_status_map = {
        "deploy": DeploymentStatus.DEPLOYING,
        "stop": DeploymentStatus.STOPPED,
        "restart": DeploymentStatus.DEPLOYING,
    }
    target_status = action_status_map.get(action.action)
    if not target_status:
        raise HTTPException(400, f"Unknown action: {action.action}")
    try:
        dep.transition_to(target_status)
    except ValueError as e:
        raise HTTPException(400, str(e))
    await db.commit()
    return {"status": "ok", "deployment": dep.to_dict()}


# ── Pipeline Run (SSE streaming) ──────────────────────────────────────────────

@router.post("/{deployment_id}/run")
async def run_deployment(
    deployment_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Start the Docker deployment pipeline. Returns an SSE stream of progress events."""
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")

    dep_config = dep.to_dict()

    run = DeploymentRun(
        deployment_id=deployment_id,
        trigger=TriggerType.MANUAL,
        triggered_by=identity,
        status=RunStatus.RUNNING,
    )
    db.add(run)
    await db.flush()
    run_id = run.id
    dep.status = DeploymentStatus.DEPLOYING
    await db.commit()

    from ...main import app_state
    from ...services.deployment.pipeline_executor import PipelineExecutor

    executor = PipelineExecutor(app_state.get("ssh_executor"))

    return StreamingResponse(
        executor.stream_run(dep_config, run_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── Run History ───────────────────────────────────────────────────────────────

@router.get("/{deployment_id}/runs", response_model=list[DeploymentRunOut])
async def list_deployment_runs(
    deployment_id: int,
    limit: int = 20,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeploymentRun)
        .where(DeploymentRun.deployment_id == deployment_id)
        .order_by(DeploymentRun.id.desc())
        .limit(limit)
    )
    return [DeploymentRunOut(**r.to_dict()) for r in result.scalars().all()]


@router.get("/{deployment_id}/runs/{run_id}", response_model=DeploymentRunOut)
async def get_deployment_run(
    deployment_id: int,
    run_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DeploymentRun).where(
            DeploymentRun.id == run_id,
            DeploymentRun.deployment_id == deployment_id,
        )
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(404, "Run not found")
    return DeploymentRunOut(**run.to_dict())


# ── Logs & Health (legacy) ────────────────────────────────────────────────────

@router.get("/{deployment_id}/logs")
async def get_deployment_logs(
    deployment_id: int,
    lines: int = 100,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")

    if not dep.vm_credential_id:
        return {
            "deployment_id": deployment_id,
            "logs": f"[No VM assigned]\nStatus: {dep.status.value if dep.status else 'unknown'}",
        }

    from ...main import app_state
    ssh = app_state.get("ssh_executor")
    if not ssh:
        return {"deployment_id": deployment_id, "logs": "[SSH executor not available]"}

    from ...models.vm import VMCredential
    vm_result = await db.execute(select(VMCredential).where(VMCredential.id == dep.vm_credential_id))
    vm = vm_result.scalar_one_or_none()
    if not vm:
        return {"deployment_id": deployment_id, "logs": "[VM not found]"}

    container = dep.container_name or dep.project_name.lower().replace(" ", "-")
    cmd = (
        f"docker logs --tail {lines} {container} 2>&1 "
        f"|| journalctl -u {container} --no-pager -n {lines} 2>/dev/null "
        f"|| echo 'No logs found for {container}'"
    )
    try:
        r = await ssh.execute_command(
            host=vm.host_ip, username=vm.ssh_username, command=cmd,
            password=vm.decrypted_password, private_key=vm.decrypted_private_key,
            port=vm.ssh_port or 22, stored_fingerprint=vm.ssh_host_key_fingerprint,
        )
        return {"deployment_id": deployment_id, "logs": r.get("stdout", "")}
    except Exception as e:
        return {"deployment_id": deployment_id, "logs": f"[Error: {e}]"}


@router.get("/{deployment_id}/health")
async def get_deployment_health(
    deployment_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")

    health: dict = {
        "deployment_id": deployment_id,
        "name": dep.name,
        "status": dep.status.value if dep.status else "unknown",
        "checks": [],
    }

    if not dep.vm_credential_id:
        health["checks"].append({"name": "vm_assigned", "status": "warning", "message": "No VM assigned"})
        return health

    from ...main import app_state
    ssh = app_state.get("ssh_executor")
    if not ssh:
        health["checks"].append({"name": "ssh", "status": "error", "message": "SSH executor unavailable"})
        return health

    from ...models.vm import VMCredential
    vm_result = await db.execute(select(VMCredential).where(VMCredential.id == dep.vm_credential_id))
    vm = vm_result.scalar_one_or_none()
    if not vm:
        health["checks"].append({"name": "vm_lookup", "status": "error", "message": "VM not found"})
        return health

    container = dep.container_name or dep.project_name.lower().replace(" ", "-")
    try:
        r = await ssh.execute_command(
            host=vm.host_ip, username=vm.ssh_username,
            command=f"docker inspect --format='{{{{.State.Status}}}}' {container} 2>/dev/null || echo 'not_found'",
            password=vm.decrypted_password, private_key=vm.decrypted_private_key,
            port=vm.ssh_port or 22, stored_fingerprint=vm.ssh_host_key_fingerprint,
        )
        container_status = r.get("stdout", "").strip().strip("'")
        health["checks"].append({
            "name": "container",
            "status": "ok" if container_status == "running" else "warning",
            "message": f"Container is {container_status}",
        })
    except Exception as e:
        health["checks"].append({"name": "container", "status": "error", "message": str(e)})

    return health


# ── Seed pre-configured deployments ──────────────────────────────────────────

@router.post("/seed/defaults")
async def seed_default_deployments(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Seed the 5 known Docker deployments. Skips any that already exist by name."""
    defaults = [
        {
            "name": "Demo Production LMS",
            "project_name": "lms-frontend",
            "environment": "production",
            "docker_image": "harooney/docker-vue-lms-demo",
            "dockerhub_image": "harooney/docker-vue-lms-demo",
            "dockerhub_tag": "lms-vue-app",
            "container_name": "frontend-vue-app-demo",
            "port_mapping": "8082:80",
            "build_platform": "linux/amd64",
            "dockerfile": "Dockerfile",
            "docker_run_extra_args": "--restart unless-stopped",
            "branch": "main",
        },
        {
            "name": "Emdad CX Production",
            "project_name": "lms-frontend",
            "environment": "production",
            "docker_image": "harooney/docker-vue-lms-emdad-cx",
            "dockerhub_image": "harooney/docker-vue-lms-emdad-cx",
            "dockerhub_tag": "lms-vue-app",
            "container_name": "vue-app-emdad-cx",
            "port_mapping": "8085:80",
            "build_platform": "linux/amd64",
            "dockerfile": "Dockerfile",
            "docker_run_extra_args": "--restart unless-stopped",
            "branch": "emdad-cx",
        },
        {
            "name": "Jisr Internal",
            "project_name": "lms-frontend",
            "environment": "production",
            "docker_image": "harooney/docker-vue-lms-jisr-internal",
            "dockerhub_image": "harooney/docker-vue-lms-jisr-internal",
            "dockerhub_tag": "lms-vue-app",
            "container_name": "vue-app-jisr-internal",
            "build_platform": "linux/amd64",
            "dockerfile": "Dockerfile",
            "docker_run_extra_args": "--restart unless-stopped",
            "branch": "jisr-internal",
        },
        {
            "name": "Demo Development LMS",
            "project_name": "lms-frontend",
            "environment": "development",
            "docker_image": "harooney/docker-vue-lms-vue-app-demo-dev",
            "dockerhub_image": "harooney/docker-vue-lms-vue-app-demo-dev",
            "dockerhub_tag": "lms-vue-app",
            "container_name": "vue-app-demo-dev",
            "port_mapping": "8083:80",
            "build_platform": "linux/amd64",
            "dockerfile": "Dockerfile",
            "docker_run_extra_args": "--restart unless-stopped",
            "branch": "develop",
        },
        {
            "name": "WFE Production",
            "project_name": "lms-frontend",
            "environment": "production",
            "docker_image": "harooney/lms-vue-app-wfe",
            "dockerhub_image": "harooney/lms-vue-app-wfe",
            "dockerhub_tag": "latest",
            "container_name": "lms-vue-app-wfe",
            "port_mapping": "80:80",
            "build_platform": "linux/amd64",
            "dockerfile": "Dockerfile",
            "docker_run_extra_args": "--restart unless-stopped",
            "branch": "wfe",
        },
    ]

    created, skipped = [], []
    for data in defaults:
        existing = await db.execute(select(Deployment).where(Deployment.name == data["name"]))
        if existing.scalar_one_or_none():
            skipped.append(data["name"])
            continue
        data["webhook_secret"] = secrets.token_hex(24)
        dep = Deployment(**data)
        db.add(dep)
        created.append(data["name"])

    await db.commit()
    return {"created": created, "skipped": skipped}

