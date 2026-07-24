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
from .url_discovery import (
    build_stack_groups,
    host_port_from_docker_ports,
    infer_urls_for_container,
    parse_nginx_port_to_urls,
)

logger = logging.getLogger(__name__)

_HOST_IP_RE = re.compile(
    r"\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}"
    r"(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b"
)

# Explicit bulk-board intents — also covers "add it/them to mission board"
_ALL_ON_BOARD_RE = re.compile(
    r"\b(all|everything|every)\b.*\b(mission|deployment|container|board)\b"
    r"|\b(mission|deployment|container)s?\b.*\b(all|everything|every)\b"
    r"|\bensure\s+that\s+they\b"
    r"|\bput\s+them\s+(all\s+)?on\b"
    r"|\b(everything|all)\s+(on|to|in)\s+(the\s+)?mission\s*board\b"
    r"|\ball\s+on\s+(the\s+)?mission\s*board\b"
    r"|\ball\s+deployments?\b"
    r"|\ball\s+containers?\b"
    r"|\badd\s+(it|them|all|these|those)\b.*\b(mission|board|deployment)\b"
    r"|\b(mission\s*board)\b.*\b(add|ensure|register|seed)\b"
    r"|\bensure_missions\b",
    re.I,
)


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
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=45)
            return {
                "ok": proc.returncode == 0,
                "stdout": (proc.stdout or "")[:200000],
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


async def _discover_nginx_urls(vm: VMCredential) -> dict[str, str]:
    """Read-only: map published host ports → public URLs via nginx vhosts."""
    result = await _ssh_readonly(
        vm.host_ip,
        vm.ssh_username or "root",
        (
            # Ignore missing globs (conf.d empty → cat exits 1); still keep stdout.
            "bash -lc 'cat /etc/nginx/sites-enabled/* /etc/nginx/conf.d/* 2>/dev/null; true'"
        ),
        vm.ssh_port or 22,
    )
    text = result.get("stdout") or ""
    if not text.strip():
        logger.info(
            "Nginx URL discovery empty on %s: ok=%s err=%s",
            vm.host_ip,
            result.get("ok"),
            (result.get("stderr") or "")[:200],
        )
        return {}
    return parse_nginx_port_to_urls(text)


def extract_host_hint(query: str | None) -> Optional[str]:
    if not query:
        return None
    m = _HOST_IP_RE.search(query)
    return m.group(0) if m else None


async def _list_target_vms(
    db: AsyncSession,
    *,
    vm_credential_id: Optional[int] = None,
    host_hint: Optional[str] = None,
    all_vms: bool = False,
) -> list[VMCredential]:
    if vm_credential_id or host_hint:
        vm = await _resolve_vm(
            db, vm_credential_id=vm_credential_id, host_hint=host_hint
        )
        return [vm] if vm else []
    if all_vms:
        vr = await db.execute(
            select(VMCredential).where(VMCredential.is_active == True)  # noqa: E712
        )
        return list(vr.scalars().all())
    vm = await _resolve_vm(db)
    return [vm] if vm else []


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

    dep = None
    existing = await db.execute(select(Deployment).where(Deployment.name == name))
    dep = existing.scalars().first()
    if dep is None and payload.get("container_name"):
        existing = await db.execute(
            select(Deployment).where(Deployment.container_name == payload["container_name"])
        )
        dep = existing.scalars().first()
    if dep is None and payload.get("backend_container"):
        existing = await db.execute(
            select(Deployment).where(
                Deployment.backend_container == payload["backend_container"]
            )
        )
        dep = existing.scalars().first()
    if dep is None and payload.get("project_name"):
        existing = await db.execute(
            select(Deployment).where(Deployment.project_name == payload.get("project_name"))
        )
        dep = existing.scalars().first()

    created = False
    updated = False

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
        # Keep a nicer human name if LMS Test already customized
        skip_name = True
        for k, v in clean.items():
            if k == "name" and skip_name:
                continue
            if getattr(dep, k, None) != v:
                setattr(dep, k, v)
                updated = True
        # Always refresh URLs when discovery found them
        for url_key in ("public_url", "api_url"):
            if clean.get(url_key) and getattr(dep, url_key, None) != clean[url_key]:
                setattr(dep, url_key, clean[url_key])
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


def _fields_from_stack(
    group: dict[str, Any],
    *,
    vm: VMCredential,
    port_to_url: dict[str, str],
) -> dict[str, Any]:
    fe = group.get("frontend")
    be = group.get("backend")
    members: list[dict[str, str]] = group.get("members") or []
    primary = fe or be or (members[0] if members else {})
    cname = (primary.get("name") if primary else "") or group.get("key") or "mission"
    img = (fe or primary or {}).get("image") or ""
    ports = (fe or be or primary or {}).get("ports") or ""

    env = "production"
    blob = " ".join(
        [group.get("key") or "", cname, *[m.get("name") or "" for m in members]]
    ).lower()
    if any(x in blob for x in ("test", "dev", "staging")):
        env = "test"

    fields: dict[str, Any] = {
        "name": group.get("name") or cname,
        "project_name": group.get("key") or cname,
        "environment": env,
        "vm_credential_id": vm.id,
        "pipeline_profile": "inspect_only",
        "branch": "main",
    }
    if fe:
        fields["container_name"] = fe.get("name")
    elif primary and not be:
        fields["container_name"] = primary.get("name")
    if be:
        fields["backend_container"] = be.get("name")

    if img and "/" in img:
        if ":" in img:
            repo, tag = img.rsplit(":", 1)
            fields["dockerhub_image"] = repo
            fields["dockerhub_tag"] = tag
            fields["docker_image"] = repo
        else:
            fields["dockerhub_image"] = img

    if host_port_from_docker_ports(ports):
        m = re.search(r":(\d+)->(\d+)", ports)
        if m:
            fields["port_mapping"] = f"{m.group(1)}:{m.group(2)}"

    for row in [fe, be, *members]:
        if not row:
            continue
        inferred = infer_urls_for_container(
            container_name=row.get("name") or "",
            ports_field=row.get("ports") or "",
            port_to_url=port_to_url,
        )
        if inferred.get("public_url") and not fields.get("public_url"):
            fields["public_url"] = inferred["public_url"]
        if inferred.get("api_url") and not fields.get("api_url"):
            fields["api_url"] = inferred["api_url"]

    if fields.get("api_url") and not fields.get("public_url") and fe:
        fields["public_url"] = fields["api_url"]
    if fields.get("public_url") and not fields.get("api_url") and be:
        fields["api_url"] = fields["public_url"]

    return fields


async def ensure_all_containers_on_vm(
    db: AsyncSession,
    *,
    force_update: bool = True,
    vm_credential_id: Optional[int] = None,
    host_hint: Optional[str] = None,
    all_vms: bool = False,
) -> dict[str, Any]:
    """Register Missions from docker (+ nginx URL map) on one or all VMs."""
    summary = await catalog_summary(db)
    targets = await _list_target_vms(
        db,
        vm_credential_id=vm_credential_id,
        host_hint=host_hint,
        all_vms=all_vms or not (vm_credential_id or host_hint),
    )
    if not targets:
        return {
            "matched": [],
            "seeded": [],
            "skipped": [],
            "catalog": summary,
            "message": "No VM in the database. Add a VM first, then ask again.",
            "safe": True,
            "vm_mutated": False,
        }

    seeded: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    matched: list[str] = []
    urls_found = 0

    for vm in targets:
        containers = await _discover_on_vm(vm)
        if not containers:
            continue
        port_to_url = await _discover_nginx_urls(vm)
        groups = build_stack_groups(containers)

        for group in groups:
            key = group.get("key") or ""
            matched.append(key)
            fields = _fields_from_stack(group, vm=vm, port_to_url=port_to_url)
            if fields.get("public_url") or fields.get("api_url"):
                urls_found += 1

            # Disambiguate same stack name across VMs
            if len(targets) > 1 and fields.get("name"):
                fields["name"] = f"{fields['name']} ({vm.host_ip})"

            result = await upsert_mission_fields(
                db,
                fields,
                meta={
                    "notes": (
                        f"Auto-registered from docker+nginx on {vm.host_ip}. "
                        "inspect_only — no deploy/restart from this seed."
                    ),
                    "discovered_status": [
                        (m.get("name"), m.get("status")) for m in (group.get("members") or [])
                    ],
                    "url_discovery": {
                        "ports_mapped": len(port_to_url),
                        "public_url": fields.get("public_url"),
                        "api_url": fields.get("api_url"),
                    },
                },
                force_update=force_update,
                catalog_id=f"{vm.host_ip}:{key}",
            )
            if result["created"] or result["updated"]:
                seeded.append(result)
            else:
                skipped.append(result)

        # Backfill URLs onto any existing Mission cards for this VM (legacy one-per-container rows)
        existing = await db.execute(
            select(Deployment).where(Deployment.vm_credential_id == vm.id)
        )
        for dep in existing.scalars().all():
            ports_field = dep.port_mapping or ""
            # port_mapping stored as "8087:80" — host port is left side
            host_ports: list[str] = []
            if ports_field and "->" not in ports_field:
                left = ports_field.split(":")[0].strip()
                if left.isdigit():
                    host_ports.append(left)
            else:
                host_ports = host_port_from_docker_ports(ports_field)
            # Also try live docker row for this container
            for row in containers:
                if row.get("name") in {
                    dep.container_name,
                    dep.backend_container,
                    dep.project_name,
                }:
                    host_ports.extend(host_port_from_docker_ports(row.get("ports") or ""))
            url = next((port_to_url[p] for p in host_ports if p in port_to_url), None)
            if not url:
                continue
            changed = False
            if not dep.public_url:
                dep.public_url = url
                changed = True
                urls_found += 1
            low_name = (dep.container_name or dep.name or "").lower()
            if (
                any(x in low_name for x in ("backend", "laravel", "api"))
                and not dep.api_url
            ):
                dep.api_url = url
                changed = True
            if changed:
                seeded.append(
                    {
                        "catalog_id": f"url-backfill:{dep.id}",
                        "created": False,
                        "updated": True,
                        "already_present": False,
                        "mission": mission_to_flight_deck(dep, vm),
                    }
                )

    await db.commit()
    host_list = ", ".join(v.host_ip for v in targets)
    parts = [
        f"Mission Board sync from VM(s) {host_list}: "
        f"{len(seeded)} created/updated, {len(skipped)} already present, "
        f"{urls_found} with detected public/API URL(s)."
    ]
    if seeded:
        parts.append(
            "Added/updated: "
            + ", ".join(
                f"{r['mission']['name']}"
                + (
                    f" → {r['mission'].get('public_url')}"
                    if r["mission"].get("public_url")
                    else ""
                )
                for r in seeded[:20]
            )
            + ("…" if len(seeded) > 20 else "")
        )
    parts.append(
        "Open Mission Board to see the cards. VMs were not modified "
        "(read-only docker ps + nginx parse + DB writes only)."
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
        "urls_found": urls_found,
    }


async def ensure_missions_for_query(
    db: AsyncSession,
    query: str | None = None,
    *,
    seed_all: bool = False,
    force_update: bool = True,
    vm_credential_id: Optional[int] = None,
    discover_all: bool = False,
    host_hint: Optional[str] = None,
) -> dict[str, Any]:
    """Ensure Missions exist for what the user asked — DB + live discovery only."""
    q = (query or "").strip()
    host = host_hint or extract_host_hint(q)
    want_all = bool(seed_all or discover_all or _ALL_ON_BOARD_RE.search(q))

    # "ok add it in the mission board" after a VM health check → that host or all VMs
    if re.search(r"\badd\s+it\b.*\bmission\b|\bmission\s*board\b", q, re.I) and host:
        want_all = True

    if want_all:
        return await ensure_all_containers_on_vm(
            db,
            force_update=force_update,
            vm_credential_id=vm_credential_id,
            host_hint=host,
            all_vms=not bool(vm_credential_id or host),
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

    candidate = candidate_from_query(query)
    if not candidate:
        return {
            "matched": [],
            "seeded": [],
            "skipped": [],
            "catalog": summary,
            "message": (
                "Nothing matched the database and the query has no URL/name to discover. "
                "Say 'put all deployments on the mission board' or pass a host IP / URL."
            ),
            "safe": True,
            "vm_mutated": False,
        }

    vm = await _resolve_vm(db, vm_credential_id=vm_credential_id, host_hint=host)
    if vm is None:
        return {
            "matched": [],
            "seeded": [],
            "skipped": [],
            "catalog": summary,
            "message": (
                "No VM credentials in the database yet. Add a VM first (VMs page), "
                "then re-ask to ensure/seed."
            ),
            "safe": True,
            "vm_mutated": False,
        }

    containers = await _discover_on_vm(vm)
    port_to_url = await _discover_nginx_urls(vm)
    enriched = merge_discovery_into_candidate(
        candidate,
        containers=containers,
        vm_host=vm.host_ip,
    )
    fields = dict(enriched["fields"])
    fields["vm_credential_id"] = vm.id
    fields.setdefault("pipeline_profile", "inspect_only")

    # Attach nginx-discovered URLs when missing
    for row in containers:
        inferred = infer_urls_for_container(
            container_name=row.get("name") or "",
            ports_field=row.get("ports") or "",
            port_to_url=port_to_url,
        )
        if inferred.get("public_url") and not fields.get("public_url"):
            # Only if this row matches the candidate container
            cname = (fields.get("container_name") or "").lower()
            if not cname or cname == (row.get("name") or "").lower():
                fields["public_url"] = inferred["public_url"]
        if inferred.get("api_url") and not fields.get("api_url"):
            bname = (fields.get("backend_container") or "").lower()
            if not bname or bname == (row.get("name") or "").lower():
                fields["api_url"] = inferred["api_url"]

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
                f"{r['mission']['name']} (id={r['mission']['id']}"
                f"{', ' + r['mission']['public_url'] if r['mission'].get('public_url') else ''})"
                for r in seeded
            )
        )
    if skipped:
        parts.append(
            "Already registered: "
            + ", ".join(f"{r['mission']['name']} (id={r['mission']['id']})" for r in skipped)
        )
    parts.append(
        f"Discovery used VM {vm.host_ip} (docker ps + nginx read-only). "
        "No containers were restarted or removed."
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
