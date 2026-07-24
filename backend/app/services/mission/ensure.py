"""Idempotent Mission seeding — AIPiloty DB only; catalog is DB + discovery."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...models.deployment import Deployment, DeploymentStatus
from ...models.vm import VMCredential
from .catalog import (
    candidate_from_query,
    catalog_summary,
    match_missions_in_db,
    merge_discovery_into_candidate,
    parse_docker_ps,
)
from .context import mission_to_flight_deck
from .ownership import default_ownership

logger = logging.getLogger(__name__)


def _default_ssh_key_path() -> Optional[str]:
    home = Path.home()
    for name in ("id_ed25519_digitalocean", "id_ed25519", "id_rsa"):
        p = home / ".ssh" / name
        if p.is_file():
            return str(p)
    return None


async def _ssh_readonly(host: str, user: str, command: str, port: int = 22) -> dict[str, Any]:
    key = _default_ssh_key_path()
    cmd = [
        "ssh",
        "-o", "BatchMode=yes",
        "-o", "StrictHostKeyChecking=accept-new",
        "-o", "ConnectTimeout=12",
        "-p", str(port),
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
            }
        except Exception as exc:
            return {"ok": False, "stdout": "", "stderr": str(exc)}

    return await asyncio.to_thread(_run)


async def _resolve_vm(
    db: AsyncSession,
    *,
    vm_credential_id: Optional[int] = None,
    host_hint: Optional[str] = None,
) -> Optional[VMCredential]:
    """Resolve an existing VM credential. Never invent hosts in source code."""
    if vm_credential_id:
        vr = await db.execute(select(VMCredential).where(VMCredential.id == vm_credential_id))
        vm = vr.scalar_one_or_none()
        if vm:
            return vm
    if host_hint:
        vr = await db.execute(
            select(VMCredential).where(VMCredential.host_ip == host_hint).limit(1)
        )
        vm = vr.scalar_one_or_none()
        if vm:
            return vm
    vr = await db.execute(
        select(VMCredential).where(VMCredential.is_active == True).limit(1)  # noqa: E712
    )
    return vr.scalar_one_or_none()


async def _discover_on_vm(vm: VMCredential) -> list[dict[str, str]]:
    result = await _ssh_readonly(
        vm.host_ip,
        vm.ssh_username or "root",
        "docker ps --format '{{.Names}}\\t{{.Status}}\\t{{.Image}}\\t{{.Ports}}'",
        vm.ssh_port or 22,
    )
    if not result.get("ok"):
        logger.info("Discovery SSH failed on %s: %s", vm.host_ip, result.get("stderr"))
        return []
    return parse_docker_ps(result.get("stdout") or "")


async def upsert_mission_fields(
    db: AsyncSession,
    fields: dict[str, Any],
    *,
    meta: Optional[dict[str, Any]] = None,
    force_update: bool = True,
    catalog_id: str = "dynamic",
) -> dict[str, Any]:
    """Create or refresh one Mission row. DB write only."""
    payload = dict(fields)
    ownership_meta = {
        "ownership": default_ownership(),
        **(meta or {}),
        "public_url": payload.get("public_url"),
        "api_url": payload.get("api_url"),
        "backend_container": payload.get("backend_container"),
    }
    payload["mission_meta"] = json.dumps(ownership_meta)
    payload["status"] = DeploymentStatus.RUNNING

    name = payload.get("name")
    if not name:
        raise ValueError("Mission name is required")

    existing = await db.execute(select(Deployment).where(Deployment.name == name))
    dep = existing.scalar_one_or_none()
    created = False
    updated = False

    # Only set columns that exist on the model
    column_keys = {
        "name", "project_name", "environment", "vm_credential_id", "deploy_path",
        "repository_url", "branch", "docker_image", "dockerhub_image", "dockerhub_tag",
        "container_name", "backend_container", "port_mapping", "public_url", "api_url",
        "pipeline_profile", "docker_run_extra_args", "dockerfile", "build_platform",
        "docker_network", "mission_meta", "status",
    }
    clean = {k: v for k, v in payload.items() if k in column_keys and v is not None}

    if dep is None:
        dep = Deployment(**clean)
        db.add(dep)
        created = True
    elif force_update:
        for k, v in clean.items():
            if k == "name":
                continue
            if getattr(dep, k, None) != v:
                setattr(dep, k, v)
                updated = True

    await db.flush()
    await db.refresh(dep)
    vm = None
    if dep.vm_credential_id:
        vr = await db.execute(select(VMCredential).where(VMCredential.id == dep.vm_credential_id))
        vm = vr.scalar_one_or_none()
    return {
        "catalog_id": catalog_id,
        "created": created,
        "updated": updated,
        "already_present": not created and not updated,
        "mission": mission_to_flight_deck(dep, vm),
    }


async def ensure_all_containers_on_vm(
    db: AsyncSession,
    *,
    force_update: bool = True,
    vm_credential_id: Optional[int] = None,
) -> dict[str, Any]:
    """Register one Mission per running container on a VM (DB-only, inspect_only).

    Used when the user explicitly asks to put *all* deployments on the Mission Board.
    """
    summary = await catalog_summary(db)
    vm = await _resolve_vm(db, vm_credential_id=vm_credential_id)
    if vm is None:
        return {
            "matched": [],
            "seeded": [],
            "skipped": [],
            "catalog": summary,
            "message": "No VM in the database. Add a VM first, then ask again.",
            "safe": True,
            "vm_mutated": False,
        }

    containers = await _discover_on_vm(vm)
    if not containers:
        return {
            "matched": [],
            "seeded": [],
            "skipped": [],
            "catalog": summary,
            "message": (
                f"Could not read docker ps on {vm.host_ip} (SSH/read-only). "
                "Trust host key / check VM credentials, then retry."
            ),
            "safe": True,
            "vm_mutated": False,
        }

    seeded: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    matched: list[str] = []

    for row in containers:
        cname = (row.get("name") or "").strip()
        if not cname:
            continue
        matched.append(cname)
        pretty = cname.replace("-", " ").replace("_", " ").title()
        img = row.get("image") or ""
        fields: dict[str, Any] = {
            "name": pretty,
            "project_name": cname,
            "environment": "test" if "test" in cname.lower() or "dev" in cname.lower() else "production",
            "vm_credential_id": vm.id,
            "pipeline_profile": "inspect_only",
            "branch": "main",
        }
        low = cname.lower()
        if any(x in low for x in ("backend", "laravel", "api")):
            fields["backend_container"] = cname
        else:
            fields["container_name"] = cname
        if img and "/" in img:
            if ":" in img:
                repo, tag = img.rsplit(":", 1)
                fields["dockerhub_image"] = repo
                fields["dockerhub_tag"] = tag
                fields["docker_image"] = repo
            else:
                fields["dockerhub_image"] = img
        ports = row.get("ports") or ""
        m = re.search(r":(\d+)->(\d+)", ports)
        if m:
            fields["port_mapping"] = f"{m.group(1)}:{m.group(2)}"

        result = await upsert_mission_fields(
            db,
            fields,
            meta={
                "notes": (
                    f"Auto-registered from docker ps on {vm.host_ip} for Mission Board. "
                    "inspect_only — no deploy/restart from this seed."
                ),
                "discovered_status": row.get("status"),
            },
            force_update=force_update,
            catalog_id=cname,
        )
        if result["created"] or result["updated"]:
            seeded.append(result)
        else:
            skipped.append(result)

    await db.commit()
    parts = [
        f"Mission Board sync from VM {vm.host_ip}: "
        f"{len(seeded)} created/updated, {len(skipped)} already present "
        f"({len(containers)} containers discovered)."
    ]
    if seeded:
        parts.append(
            "Added/updated: "
            + ", ".join(r["mission"]["name"] for r in seeded[:20])
            + ("…" if len(seeded) > 20 else "")
        )
    parts.append(
        "Open Mission Board to see the cards. VM was not modified "
        "(read-only docker ps + DB writes only)."
    )
    return {
        "matched": matched,
        "seeded": seeded,
        "skipped": skipped,
        "catalog": await catalog_summary(db),
        "discovered_containers": matched,
        "message": " ".join(parts),
        "safe": True,
        "vm_mutated": False,
    }


# Explicit bulk-board intents only — bare "mission board" alone does not seed all.
_ALL_ON_BOARD_RE = re.compile(
    r"\b(all|everything|every)\b.*\b(mission|deployment|container|board)\b"
    r"|\b(mission|deployment|container)s?\b.*\b(all|everything|every)\b"
    r"|\bensure\s+that\s+they\b"
    r"|\bput\s+them\s+(all\s+)?on\b"
    r"|\b(everything|all)\s+(on|to|in)\s+(the\s+)?mission\s*board\b"
    r"|\ball\s+on\s+(the\s+)?mission\s*board\b"
    r"|\ball\s+deployments?\b"
    r"|\ball\s+containers?\b",
    re.I,
)


async def ensure_missions_for_query(
    db: AsyncSession,
    query: str | None = None,
    *,
    seed_all: bool = False,
    force_update: bool = True,
    vm_credential_id: Optional[int] = None,
    discover_all: bool = False,
) -> dict[str, Any]:
    """Ensure Missions exist for what the user asked — DB + live discovery only."""
    q = (query or "").strip()
    want_all = bool(seed_all or discover_all or _ALL_ON_BOARD_RE.search(q))

    if want_all:
        return await ensure_all_containers_on_vm(
            db,
            force_update=force_update,
            vm_credential_id=vm_credential_id,
        )

    summary = await catalog_summary(db)
    matched_existing = await match_missions_in_db(db, query, seed_all=False)
    seeded: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    if matched_existing:
        for d in matched_existing:
            vm = None
            if d.vm_credential_id:
                vr = await db.execute(
                    select(VMCredential).where(VMCredential.id == d.vm_credential_id)
                )
                vm = vr.scalar_one_or_none()
            skipped.append(
                {
                    "catalog_id": str(d.id),
                    "created": False,
                    "updated": False,
                    "already_present": True,
                    "mission": mission_to_flight_deck(d, vm),
                }
            )
        await db.commit()
        return {
            "matched": [str(d.id) for d in matched_existing],
            "seeded": [],
            "skipped": skipped,
            "catalog": await catalog_summary(db),
            "message": (
                "Already registered in AIPiloty DB: "
                + ", ".join(f"{d.name} (id={d.id})" for d in matched_existing)
                + ". VM was not modified."
            ),
            "safe": True,
            "vm_mutated": False,
        }

    # Not in DB → build candidate from query + optional VM discovery
    candidate = candidate_from_query(query)
    if not candidate:
        return {
            "matched": [],
            "seeded": [],
            "skipped": [],
            "catalog": summary,
            "message": (
                "Nothing matched the database and the query has no URL/name to discover. "
                "Add a VM under VMs, then ask e.g. 'ensure mission https://….innovito.net/ "
                "lms-test' — discovery will docker-ps (read-only) and save into DB. "
                "Or say 'put all deployments on the mission board' to register every "
                "container from docker ps."
            ),
            "safe": True,
            "vm_mutated": False,
        }

    vm = await _resolve_vm(db, vm_credential_id=vm_credential_id)
    if vm is None:
        return {
            "matched": [],
            "seeded": [],
            "skipped": [],
            "catalog": summary,
            "message": (
                "No VM credentials in the database yet. Add a VM first (VMs page), "
                "then re-ask to ensure/seed — discovery needs a registered server."
            ),
            "safe": True,
            "vm_mutated": False,
        }

    containers = await _discover_on_vm(vm)
    enriched = merge_discovery_into_candidate(
        candidate,
        containers=containers,
        vm_host=vm.host_ip,
    )
    fields = dict(enriched["fields"])
    fields["vm_credential_id"] = vm.id
    fields.setdefault("pipeline_profile", "inspect_only")

    result = await upsert_mission_fields(
        db,
        fields,
        meta=enriched.get("meta"),
        force_update=force_update,
        catalog_id=str(enriched.get("id") or "discovered"),
    )
    if result["created"] or result["updated"]:
        seeded.append(result)
    else:
        skipped.append(result)

    await db.commit()
    parts = []
    if seeded:
        parts.append(
            "Discovered & saved to DB: "
            + ", ".join(
                f"{r['mission']['name']} (id={r['mission']['id']}, "
                f"{'created' if r['created'] else 'updated'})"
                for r in seeded
            )
        )
    if skipped:
        parts.append(
            "Already registered: "
            + ", ".join(f"{r['mission']['name']} (id={r['mission']['id']})" for r in skipped)
        )
    parts.append(
        f"Discovery used VM {vm.host_ip} (docker ps read-only). "
        "No containers were restarted or removed. Nothing came from a static git catalog."
    )

    return {
        "matched": [str(enriched.get("id"))],
        "seeded": seeded,
        "skipped": skipped,
        "catalog": await catalog_summary(db),
        "discovered_containers": [c.get("name") for c in containers],
        "message": " ".join(parts),
        "safe": True,
        "vm_mutated": False,
    }


async def list_seeded_missions(db: AsyncSession) -> list[dict[str, Any]]:
    result = await db.execute(select(Deployment).order_by(Deployment.id.asc()))
    deps = result.scalars().all()
    out: list[dict[str, Any]] = []
    for d in deps:
        vm = None
        if d.vm_credential_id:
            vr = await db.execute(
                select(VMCredential).where(VMCredential.id == d.vm_credential_id)
            )
            vm = vr.scalar_one_or_none()
        out.append(mission_to_flight_deck(d, vm))
    return out
