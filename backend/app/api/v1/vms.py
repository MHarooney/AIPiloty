"""VM credential API routes — CRUD + SSH terminal."""

from __future__ import annotations

import asyncio
import logging
import time
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.vm import VMCredential
from ...schemas.api import VMCreate, VMOut

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/vms", tags=["VMs"])

# ── Per-IP rate limit for VM monitoring (5 calls / 60s) ──────────────────────
_MONITOR_LIMIT = 5
_MONITOR_WINDOW = 60.0
_monitor_hits: dict[str, list[float]] = defaultdict(list)


def _check_monitor_rate(ip: str) -> None:
    """Raise 429 if the IP has exceeded the monitoring rate limit."""
    now = time.monotonic()
    window_start = now - _MONITOR_WINDOW
    hits = [t for t in _monitor_hits[ip] if t > window_start]
    hits.append(now)
    _monitor_hits[ip] = hits
    if len(hits) > _MONITOR_LIMIT:
        raise HTTPException(
            status_code=429,
            detail="Too many monitoring requests — wait before polling again",
        )



@router.get("/", response_model=list[VMOut])
async def list_vms(
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(VMCredential).order_by(VMCredential.created_at.desc()))
    return [VMOut(**vm.to_dict()) for vm in result.scalars().all()]


@router.post("/", response_model=VMOut)
async def create_vm(
    payload: VMCreate,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    vm = VMCredential(
        name=payload.name,
        provider=payload.provider,
        host_ip=payload.host_ip,
        ssh_username=payload.ssh_username,
        ssh_port=payload.ssh_port,
        hostname=payload.hostname,
        region=payload.region,
    )
    if payload.ssh_password:
        vm.decrypted_password = payload.ssh_password
    if payload.ssh_private_key:
        vm.decrypted_private_key = payload.ssh_private_key
    db.add(vm)
    await db.flush()
    await db.refresh(vm)
    return VMOut(**vm.to_dict())


@router.get("/{vm_id}", response_model=VMOut)
async def get_vm(
    vm_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "VM not found")
    return VMOut(**vm.to_dict())


@router.delete("/{vm_id}")
async def delete_vm(
    vm_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "VM not found")
    await db.delete(vm)
    await db.commit()
    return {"status": "deleted"}


@router.post("/{vm_id}/trust-host-key")
async def trust_host_key(
    vm_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Fetch and store the SSH host key fingerprint (TOFU)."""
    from ...services.ssh.executor import get_remote_host_key_fingerprint

    result = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "VM not found")

    try:
        info = get_remote_host_key_fingerprint(vm.host_ip, vm.ssh_port or 22)
        vm.ssh_host_key_fingerprint = info["fingerprint"]
        await db.commit()
        return {"status": "trusted", "fingerprint": info["fingerprint"], "key_type": info["key_type"]}
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch host key: {e}")


@router.post("/{vm_id}/test")
async def test_vm_connection(
    vm_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Test SSH connectivity to a VM."""
    result = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "VM not found")

    from ...main import app_state

    ssh = app_state.get("ssh_executor")
    if not ssh:
        raise HTTPException(500, "SSH executor not available")

    try:
        cmd_result = await ssh.execute_command(
            host=vm.host_ip,
            username=vm.ssh_username,
            command="echo ok",
            password=vm.decrypted_password,
            private_key=vm.decrypted_private_key,
            port=vm.ssh_port or 22,
            stored_fingerprint=vm.ssh_host_key_fingerprint,
        )
        success = cmd_result.get("return_code", 1) == 0
        return {"status": "connected" if success else "failed", "output": cmd_result.get("stdout", "")}
    except Exception as e:
        return {"status": "failed", "error": str(e)}


@router.get("/{vm_id}/monitoring")
async def get_vm_monitoring(
    vm_id: int,
    request: Request,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Get real-time resource metrics from a VM via SSH."""
    client_ip = request.client.host if request.client else "unknown"
    _check_monitor_rate(client_ip)
    result = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "VM not found")

    from ...main import app_state

    ssh = app_state.get("ssh_executor")
    if not ssh:
        raise HTTPException(500, "SSH executor not available")

    metrics = {}
    commands = {
        "cpu": "top -bn1 | grep 'Cpu(s)' | awk '{print $2+$4}'",
        "memory": "free -m | awk 'NR==2{printf \"%d %d %.1f\", $3, $2, $3/$2*100}'",
        "disk": "df -h / | awk 'NR==2{printf \"%s %s %s\", $3, $2, $5}'",
        "uptime": "uptime -p 2>/dev/null || uptime",
        "load": "cat /proc/loadavg | awk '{print $1, $2, $3}'",
    }

    async def _run(cmd: str) -> str | None:
        try:
            result = await ssh.execute_command(
                host=vm.host_ip, username=vm.ssh_username, command=cmd,
                password=vm.decrypted_password, private_key=vm.decrypted_private_key,
                port=vm.ssh_port or 22, stored_fingerprint=vm.ssh_host_key_fingerprint,
            )
            return result.get("stdout", "").strip()
        except Exception:
            return None

    keys = list(commands.keys())
    results = await asyncio.gather(*[_run(commands[k]) for k in keys])
    metrics = dict(zip(keys, results))

    return {"vm_id": vm_id, "vm_name": vm.name, "metrics": metrics}


@router.get("/{vm_id}/users")
async def get_vm_users(
    vm_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """List OS users on a VM (UID >= 1000 + root)."""
    result = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "VM not found")

    from ...main import app_state

    ssh = app_state.get("ssh_executor")
    if not ssh:
        raise HTTPException(500, "SSH executor not available")

    try:
        cmd_result = await ssh.execute_command(
            host=vm.host_ip, username=vm.ssh_username,
            command="awk -F: '($3>=1000||$3==0){print $1\":\"$3\":\"$7\":\"$4}' /etc/passwd",
            password=vm.decrypted_password, private_key=vm.decrypted_private_key,
            port=vm.ssh_port or 22, stored_fingerprint=vm.ssh_host_key_fingerprint,
        )
        users = []
        for line in (cmd_result.get("stdout") or "").strip().split("\n"):
            parts = line.split(":")
            if len(parts) >= 3:
                users.append({
                    "username": parts[0],
                    "uid": int(parts[1]) if parts[1].isdigit() else 0,
                    "shell": parts[2],
                    "gid": int(parts[3]) if len(parts) > 3 and parts[3].isdigit() else 0,
                })
        return {"vm_id": vm_id, "users": users}
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch users: {e}")


from pydantic import BaseModel as _BaseModel


class _CreateUserPayload(_BaseModel):
    username: str
    shell: str = "/bin/bash"
    groups: str = ""


@router.post("/{vm_id}/users")
async def create_vm_user(
    vm_id: int,
    payload: _CreateUserPayload,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Create an OS user on a VM."""
    result = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "VM not found")

    from ...main import app_state

    ssh = app_state.get("ssh_executor")
    guardrails = app_state.get("guardrails")
    if not ssh:
        raise HTTPException(500, "SSH executor not available")

    # Sanitize username
    import re
    if not re.match(r"^[a-z_][a-z0-9_-]{0,31}$", payload.username):
        raise HTTPException(400, "Invalid username format")

    cmd = f"useradd -m -s {payload.shell} {payload.username}"
    if payload.groups:
        # Validate group names
        for g in payload.groups.split(","):
            if not re.match(r"^[a-z_][a-z0-9_-]*$", g.strip()):
                raise HTTPException(400, f"Invalid group name: {g.strip()}")
        cmd += f" -G {payload.groups}"

    if guardrails:
        safety = guardrails.check_command_safety(cmd)
        if not safety["safe"]:
            raise HTTPException(400, f"Command blocked: {safety['reason']}")

    try:
        cmd_result = await ssh.execute_command(
            host=vm.host_ip, username=vm.ssh_username, command=cmd,
            password=vm.decrypted_password, private_key=vm.decrypted_private_key,
            port=vm.ssh_port or 22, stored_fingerprint=vm.ssh_host_key_fingerprint,
        )
        if cmd_result.get("return_code", 1) != 0:
            raise HTTPException(400, cmd_result.get("stderr", "Failed to create user"))
        return {"status": "created", "username": payload.username}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to create user: {e}")


@router.delete("/{vm_id}/users/{username}")
async def delete_vm_user(
    vm_id: int,
    username: str,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Delete an OS user from a VM."""
    if username == "root":
        raise HTTPException(400, "Cannot delete root user")

    import re
    if not re.match(r"^[a-z_][a-z0-9_-]{0,31}$", username):
        raise HTTPException(400, "Invalid username format")

    result = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
    vm = result.scalar_one_or_none()
    if not vm:
        raise HTTPException(404, "VM not found")

    from ...main import app_state

    ssh = app_state.get("ssh_executor")
    if not ssh:
        raise HTTPException(500, "SSH executor not available")

    try:
        cmd_result = await ssh.execute_command(
            host=vm.host_ip, username=vm.ssh_username,
            command=f"userdel -r {username}",
            password=vm.decrypted_password, private_key=vm.decrypted_private_key,
            port=vm.ssh_port or 22, stored_fingerprint=vm.ssh_host_key_fingerprint,
        )
        if cmd_result.get("return_code", 1) != 0:
            raise HTTPException(400, cmd_result.get("stderr", "Failed to delete user"))
        return {"status": "deleted", "username": username}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to delete user: {e}")
