"""Deployment API routes — CRUD + actions."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.deployment import Deployment, DeploymentStatus
from ...schemas.api import DeploymentAction, DeploymentCreate, DeploymentOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/deployments", tags=["Deployments"])


@router.get("/", response_model=list[DeploymentOut])
async def list_deployments(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Deployment).order_by(Deployment.updated_at.desc()))
    return [DeploymentOut(**d.to_dict()) for d in result.scalars().all()]


@router.post("/", response_model=DeploymentOut)
async def create_deployment(
    payload: DeploymentCreate,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    dep = Deployment(**payload.model_dump())
    db.add(dep)
    await db.flush()
    await db.refresh(dep)
    return DeploymentOut(**dep.to_dict())


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


@router.get("/history/all")
async def get_deployment_history(
    limit: int = 50,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get deployment history sorted by last_deployed_at (most recent first)."""
    result = await db.execute(
        select(Deployment)
        .where(Deployment.last_deployed_at.isnot(None))
        .order_by(Deployment.last_deployed_at.desc())
        .limit(limit)
    )
    deployments = result.scalars().all()
    return [
        {
            **d.to_dict(),
            "duration": None,  # Placeholder for future timing
        }
        for d in deployments
    ]


@router.get("/{deployment_id}/logs")
async def get_deployment_logs(
    deployment_id: int,
    lines: int = 100,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get deployment logs via SSH docker logs or journalctl."""
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")

    # If no VM attached, return placeholder
    if not dep.vm_credential_id:
        return {
            "deployment_id": deployment_id,
            "logs": f"[No VM assigned — deployment '{dep.name}' logs unavailable]\n"
                    f"Status: {dep.status.value if dep.status else 'unknown'}",
        }

    from ...main import app_state

    ssh = app_state.get("ssh_executor")
    if not ssh:
        return {"deployment_id": deployment_id, "logs": "[SSH executor not available]"}

    # Fetch the VM
    from ...models.vm import VMCredential
    vm_result = await db.execute(select(VMCredential).where(VMCredential.id == dep.vm_credential_id))
    vm = vm_result.scalar_one_or_none()
    if not vm:
        return {"deployment_id": deployment_id, "logs": "[VM not found]"}

    # Try docker logs first, fall back to journalctl
    container_name = dep.project_name.lower().replace(" ", "-")
    cmd = (
        f"docker logs --tail {lines} {container_name} 2>&1 "
        f"|| journalctl -u {container_name} --no-pager -n {lines} 2>/dev/null "
        f"|| echo 'No logs found for {container_name}'"
    )

    try:
        cmd_result = await ssh.execute_command(
            host=vm.host_ip, username=vm.ssh_username, command=cmd,
            password=vm.decrypted_password, private_key=vm.decrypted_private_key,
            port=vm.ssh_port or 22, stored_fingerprint=vm.ssh_host_key_fingerprint,
        )
        return {"deployment_id": deployment_id, "logs": cmd_result.get("stdout", "")}
    except Exception as e:
        return {"deployment_id": deployment_id, "logs": f"[Error fetching logs: {e}]"}


@router.get("/{deployment_id}/health")
async def get_deployment_health(
    deployment_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Health check for a deployment — check container status and port."""
    result = await db.execute(select(Deployment).where(Deployment.id == deployment_id))
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Deployment not found")

    health = {
        "deployment_id": deployment_id,
        "name": dep.name,
        "status": dep.status.value if dep.status else "unknown",
        "checks": [],
    }

    if not dep.vm_credential_id:
        health["checks"].append({"name": "vm_assigned", "status": "warning", "message": "No VM assigned"})
        return health

    from ...main import app_state
    from ...models.vm import VMCredential

    ssh = app_state.get("ssh_executor")
    vm_result = await db.execute(select(VMCredential).where(VMCredential.id == dep.vm_credential_id))
    vm = vm_result.scalar_one_or_none()

    if not vm or not ssh:
        health["checks"].append({"name": "connectivity", "status": "error", "message": "Cannot reach VM"})
        return health

    container_name = dep.project_name.lower().replace(" ", "-")
    checks = [
        ("container_running", f"docker inspect -f '{{{{.State.Running}}}}' {container_name} 2>/dev/null || echo 'false'"),
        ("container_health", f"docker inspect -f '{{{{.State.Health.Status}}}}' {container_name} 2>/dev/null || echo 'N/A'"),
        ("memory_usage", f"docker stats --no-stream --format '{{{{.MemUsage}}}}' {container_name} 2>/dev/null || echo 'N/A'"),
        ("cpu_usage", f"docker stats --no-stream --format '{{{{.CPUPerc}}}}' {container_name} 2>/dev/null || echo 'N/A'"),
    ]

    for check_name, cmd in checks:
        try:
            cmd_result = await ssh.execute_command(
                host=vm.host_ip, username=vm.ssh_username, command=cmd,
                password=vm.decrypted_password, private_key=vm.decrypted_private_key,
                port=vm.ssh_port or 22, stored_fingerprint=vm.ssh_host_key_fingerprint,
            )
            output = (cmd_result.get("stdout") or "").strip()
            status = "ok" if output.lower() not in ("false", "n/a", "") else "warning"
            health["checks"].append({"name": check_name, "status": status, "value": output})
        except Exception as e:
            health["checks"].append({"name": check_name, "status": "error", "message": str(e)})

    return health
