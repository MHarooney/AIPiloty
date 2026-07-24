"""Mission Control API — Flight Deck view over deployments."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.deployment import Deployment, DeploymentStatus
from ...models.vm import VMCredential
from ...services.mission.context import PIPELINE_PROFILES, mission_to_flight_deck
from ...services.mission.ownership import classify_action_risk, default_ownership

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/missions", tags=["Missions"])

# Read-only remote commands only — never restart/stop/rm from this probe path
_SAFE_REMOTE_COMMANDS = {
    "docker_ps": "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}'",
    "disk": "df -h / /var /mnt 2>/dev/null | head -20",
    "uptime": "uptime",
    "mem": "free -h 2>/dev/null || true",
}


def _default_ssh_key_path() -> Optional[str]:
    home = Path.home()
    for name in ("id_ed25519_digitalocean", "id_ed25519", "id_rsa"):
        p = home / ".ssh" / name
        if p.is_file():
            return str(p)
    return None


async def _ssh_readonly(host: str, user: str, command: str, port: int = 22) -> dict[str, Any]:
    """Run a read-only SSH command via system ssh (supports ed25519 keys)."""
    key = _default_ssh_key_path()
    cmd = [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=12",
        "-p",
        str(port),
    ]
    if key:
        cmd.extend(["-i", key])
    cmd.append(f"{user}@{host}")
    cmd.append(command)

    def _run() -> dict[str, Any]:
        import subprocess

        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
            return {
                "ok": proc.returncode == 0,
                "stdout": (proc.stdout or "")[:8000],
                "stderr": (proc.stderr or "")[:2000],
                "return_code": proc.returncode,
            }
        except Exception as exc:
            return {"ok": False, "stdout": "", "stderr": str(exc), "return_code": -1}

    return await asyncio.to_thread(_run)


async def _load_mission(db: AsyncSession, mission_id: int) -> tuple[Deployment, Optional[VMCredential]]:
    result = await db.execute(
        select(Deployment)
        .options(selectinload(Deployment.vm_credential))
        .where(Deployment.id == mission_id)
    )
    dep = result.scalar_one_or_none()
    if not dep:
        raise HTTPException(404, "Mission not found")
    return dep, dep.vm_credential


@router.get("/profiles")
async def list_pipeline_profiles(identity: str = Depends(require_auth)):
    return {
        "profiles": [
            {"id": k, "steps": v, "label": k.replace("_", " ").title()}
            for k, v in PIPELINE_PROFILES.items()
        ],
        "default_ownership": default_ownership(),
    }


@router.get("/")
async def list_missions(
    limit: int = Query(100, ge=1, le=200),
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Deployment)
        .options(selectinload(Deployment.vm_credential))
        .order_by(Deployment.updated_at.desc())
        .limit(limit)
    )
    deps = result.scalars().all()
    missions = [mission_to_flight_deck(d, d.vm_credential) for d in deps]

    healthy = sum(1 for m in missions if (m.get("status") or "") == "running")
    failed = sum(1 for m in missions if (m.get("status") or "") == "failed")
    pending = sum(1 for m in missions if (m.get("status") or "") in ("pending", "building", "deploying"))
    return {
        "missions": missions,
        "summary": {
            "healthy": healthy,
            "needs_attention": failed,
            "pending_deploys": pending,
            "total": len(missions),
        },
    }


@router.get("/{mission_id}")
async def get_mission(
    mission_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    dep, vm = await _load_mission(db, mission_id)
    return mission_to_flight_deck(dep, vm)


class ClearanceCheck(BaseModel):
    action: str = Field(..., min_length=1, max_length=128)


@router.post("/{mission_id}/clearance-check")
async def clearance_check(
    mission_id: int,
    payload: ClearanceCheck,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    dep, vm = await _load_mission(db, mission_id)
    mission = mission_to_flight_deck(dep, vm)
    decision = classify_action_risk(payload.action, mission.get("ownership"))
    return {
        "mission_id": mission_id,
        "action": payload.action,
        **decision,
        "ownership_summary": mission.get("ownership_summary"),
    }


@router.get("/{mission_id}/probe")
async def probe_mission(
    mission_id: int,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Read-only Flight Deck probe — never mutates containers or files."""
    dep, vm = await _load_mission(db, mission_id)
    mission = mission_to_flight_deck(dep, vm)
    evidence: list[dict[str, Any]] = []

    # HTTP probe (safe) — try URL as-is, then common health suffixes for APIs
    import httpx

    async def _http_probe(label: str, url: str, try_suffixes: list[str] | None = None) -> None:
        candidates = [url.rstrip("/")]
        for suf in try_suffixes or []:
            candidates.append(url.rstrip("/") + suf)
        last_err = ""
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            for candidate in candidates:
                try:
                    resp = await client.get(candidate)
                    # Root 404 on API gateways is common; keep trying suffixes
                    if resp.status_code == 404 and candidate != candidates[-1]:
                        continue
                    status = "success" if resp.status_code < 400 else (
                        "warning" if resp.status_code < 500 else "failed"
                    )
                    evidence.append(
                        {
                            "type": "http",
                            "step": label,
                            "status": status,
                            "summary": f"{candidate} → HTTP {resp.status_code}",
                            "http_status": resp.status_code,
                        }
                    )
                    return
                except Exception as exc:
                    last_err = str(exc)
        evidence.append(
            {
                "type": "http",
                "step": label,
                "status": "failed",
                "summary": f"{url} unreachable: {last_err or 'no response'}",
            }
        )

    if mission.get("public_url"):
        await _http_probe("public_url", str(mission["public_url"]))
        await _http_probe("health_check", str(mission["public_url"]))
    if mission.get("api_url"):
        await _http_probe(
            "api_url",
            str(mission["api_url"]),
            try_suffixes=["/api", "/up", "/health", "/api/health"],
        )

    # SSH read-only probe when VM is known
    if vm and vm.host_ip:
        for step_id, cmd in _SAFE_REMOTE_COMMANDS.items():
            # Scope docker ps filter to mission containers when known
            if step_id == "docker_ps":
                names = [n for n in (mission.get("container_name"), mission.get("backend_container")) if n]
                if names:
                    # Still list all — filter client-side so we don't miss related soketi etc.
                    pass
            result = await _ssh_readonly(vm.host_ip, vm.ssh_username or "root", cmd, vm.ssh_port or 22)
            stdout = result.get("stdout") or ""
            if step_id == "docker_ps" and stdout:
                names = {n for n in (mission.get("container_name"), mission.get("backend_container")) if n}
                if names:
                    filtered = "\n".join(
                        line for line in stdout.splitlines() if any(n in line for n in names)
                    )
                    if filtered:
                        stdout = filtered
            evidence.append(
                {
                    "type": "ssh",
                    "step": step_id,
                    "status": "success" if result.get("ok") else "failed",
                    "summary": f"{step_id}: {'ok' if result.get('ok') else 'failed'}",
                    "snippet": stdout[:1500] if stdout else (result.get("stderr") or "")[:500],
                    "exit_code": result.get("return_code"),
                }
            )

    overall = "healthy"
    if any(e.get("status") == "failed" for e in evidence):
        overall = "needs_attention"
    elif any(e.get("status") == "warning" for e in evidence):
        overall = "warning"

    return {
        "mission": mission,
        "health": overall,
        "evidence": evidence,
        "probed_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "safe": True,
        "note": "Read-only probe — no containers were restarted or removed.",
    }


class EnsureLmsTestPayload(BaseModel):
    """Create/update the LMS Test mission from discovered docker facts (idempotent)."""

    vm_credential_id: Optional[int] = None
    force_update: bool = True


@router.post("/ensure-lms-test")
async def ensure_lms_test_mission(
    payload: EnsureLmsTestPayload = EnsureLmsTestPayload(),
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Idempotently register https://lms-test.innovito.net as a Mission.

    Does not touch the VM — only writes AIPiloty DB metadata.
    """
    # Resolve VM
    vm_id = payload.vm_credential_id
    vm: Optional[VMCredential] = None
    if vm_id:
        vr = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
        vm = vr.scalar_one_or_none()
    if vm is None:
        vr = await db.execute(
            select(VMCredential).where(VMCredential.host_ip == "24.144.80.17").limit(1)
        )
        vm = vr.scalar_one_or_none()
    if vm is None:
        # Create VM credential shell (key loaded from local agent host at probe time)
        vm = VMCredential(
            name="root@24.144.80.17",
            provider="digitalocean",
            host_ip="24.144.80.17",
            ssh_username="root",
            ssh_port=22,
            is_active=True,
        )
        # Prefer attaching local DO key content if present (encrypted at rest)
        key_path = _default_ssh_key_path()
        if key_path and "digitalocean" in key_path:
            try:
                vm.decrypted_private_key = Path(key_path).read_text()
            except Exception:
                pass
        db.add(vm)
        await db.flush()

    name = "LMS Test (Mission Control)"
    existing = await db.execute(select(Deployment).where(Deployment.name == name))
    dep = existing.scalar_one_or_none()
    meta = {
        "ownership": default_ownership(),
        "ai_can": [
            "SSH read-only diagnostics on this VM",
            "Probe lms-test / evolms-test HTTP health",
            "Inspect frontend-vue-app-test + backend-evolms-test",
            "Backend pull/restart only after Clearance",
        ],
        "you_must": [
            "Frontend cloud build for vue LMS images",
            "Any DNS/SSL changes",
            "Never delete sibling containers on this shared VM",
        ],
        "notes": "Shared DigitalOcean VM — scope tools to lms-test containers only.",
        "public_url": "https://lms-test.innovito.net/",
        "api_url": "https://evolms-test.innovito.net/",
        "backend_container": "backend-evolms-test",
    }

    fields = dict(
        name=name,
        project_name="lms-test",
        environment="test",
        status=DeploymentStatus.RUNNING,
        vm_credential_id=vm.id,
        deploy_path="/var/www/evolms-test",
        branch="test",
        docker_image="harooney/docker-vue-lms-test",
        dockerhub_image="harooney/docker-vue-lms-test",
        dockerhub_tag="lms-vue-app",
        container_name="frontend-vue-app-test",
        backend_container="backend-evolms-test",
        port_mapping="8087:80",
        public_url="https://lms-test.innovito.net/",
        api_url="https://evolms-test.innovito.net/",
        pipeline_profile="inspect_only",
        docker_run_extra_args="--restart unless-stopped",
        mission_meta=json.dumps(meta),
    )

    created = False
    if dep is None:
        dep = Deployment(**fields)
        db.add(dep)
        created = True
    elif payload.force_update:
        for k, v in fields.items():
            if k == "name":
                continue
            setattr(dep, k, v)

    await db.commit()
    await db.refresh(dep)
    return {
        "created": created,
        "mission": mission_to_flight_deck(dep, vm),
        "message": "LMS Test mission registered in AIPiloty DB only — VM was not modified.",
    }
