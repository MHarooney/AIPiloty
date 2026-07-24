"""Build Flight Deck mission context for the agent + UI."""

from __future__ import annotations

import json
from typing import Any, Optional

from .ownership import default_ownership, ownership_summary


# Configurable runway templates — never hardcode Laravel-only steps in the UI.
PIPELINE_PROFILES: dict[str, list[dict[str, str]]] = {
    "docker_full": [
        {"id": "gate_validate", "label": "Gate Validate"},
        {"id": "git_pull", "label": "Git Pull"},
        {"id": "docker_build", "label": "Docker Build"},
        {"id": "docker_push", "label": "Docker Push"},
        {"id": "ssh_pull", "label": "Pull on Server"},
        {"id": "ssh_stop", "label": "Stop & Remove"},
        {"id": "ssh_run", "label": "Start Container"},
        {"id": "health_check", "label": "Health Check"},
    ],
    "docker_remote_only": [
        {"id": "gate_validate", "label": "Gate Validate"},
        {"id": "ssh_pull", "label": "Pull Image"},
        {"id": "ssh_stop", "label": "Stop Container"},
        {"id": "ssh_run", "label": "Start Container"},
        {"id": "health_check", "label": "Health Check"},
    ],
    "backend_pull_restart": [
        {"id": "gate_validate", "label": "Gate Validate"},
        {"id": "ssh_git_pull", "label": "Git Pull on VM"},
        {"id": "docker_restart", "label": "Restart Backend Container"},
        {"id": "health_check", "label": "Health Check"},
    ],
    "inspect_only": [
        {"id": "health_check", "label": "Health Check"},
        {"id": "docker_inspect", "label": "Docker Inspect"},
        {"id": "disk_check", "label": "Disk Check"},
    ],
}


def _parse_json(raw: Optional[str]) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def mission_to_flight_deck(dep: Any, vm: Any | None = None) -> dict[str, Any]:
    """Normalize a Deployment (+ optional VM) into Mission Board / Flight Deck DTO."""
    d = dep.to_dict() if hasattr(dep, "to_dict") else dict(dep)
    meta = _parse_json(d.get("mission_meta") or getattr(dep, "mission_meta", None))
    ownership = meta.get("ownership") or default_ownership()
    profile = (
        d.get("pipeline_profile")
        or getattr(dep, "pipeline_profile", None)
        or meta.get("pipeline_profile")
        or "docker_remote_only"
    )
    steps = PIPELINE_PROFILES.get(profile) or PIPELINE_PROFILES["docker_remote_only"]

    vm_info = None
    if vm is not None:
        vm_info = {
            "id": getattr(vm, "id", None),
            "name": getattr(vm, "name", None),
            "host_ip": getattr(vm, "host_ip", None),
            "provider": getattr(vm, "provider", None),
            "ssh_username": getattr(vm, "ssh_username", None),
        }
    elif d.get("vm_credential_id"):
        vm_info = {"id": d["vm_credential_id"]}

    public_url = d.get("public_url") or getattr(dep, "public_url", None) or meta.get("public_url")
    api_url = d.get("api_url") or getattr(dep, "api_url", None) or meta.get("api_url")
    backend_container = (
        d.get("backend_container")
        or getattr(dep, "backend_container", None)
        or meta.get("backend_container")
    )

    return {
        "id": d.get("id"),
        "name": d.get("name"),
        "project_name": d.get("project_name"),
        "environment": d.get("environment"),
        "status": d.get("status"),
        "public_url": public_url,
        "api_url": api_url,
        "branch": d.get("branch"),
        "repository_url": d.get("repository_url"),
        "deploy_path": d.get("deploy_path"),
        "container_name": d.get("container_name"),
        "backend_container": backend_container,
        "dockerhub_image": d.get("dockerhub_image"),
        "dockerhub_tag": d.get("dockerhub_tag"),
        "port_mapping": d.get("port_mapping"),
        "pipeline_profile": profile,
        "pipeline_steps": steps,
        "ownership": ownership,
        "ownership_summary": ownership_summary(ownership),
        "vm": vm_info,
        "vm_credential_id": d.get("vm_credential_id"),
        "last_deployed_at": d.get("last_deployed_at"),
        "error_message": d.get("error_message"),
        "ai_can": meta.get("ai_can")
        or [
            "SSH read-only diagnostics",
            "Health checks",
            "Docker inspect",
            "Backend git pull (with Clearance for restart)",
        ],
        "you_must": meta.get("you_must")
        or [
            "Frontend cloud build/deploy",
            "DNS / SSL changes",
            "Any destructive DB operation (after Clearance)",
        ],
        "notes": meta.get("notes"),
        "updated_at": d.get("updated_at"),
        "created_at": d.get("created_at"),
    }


def build_mission_prompt_block(mission: dict[str, Any]) -> str:
    """System prompt section injected when a Mission is active in chat."""
    own = mission.get("ownership_summary") or ownership_summary()
    vm = mission.get("vm") or {}
    steps = mission.get("pipeline_steps") or []
    step_line = " → ".join(s.get("label", s.get("id", "?")) for s in steps)

    return f"""
## ACTIVE MISSION (Flight Deck — HARD SCOPE)
You are operating on ONE mission. Do NOT touch other tenants/deployments.

- Mission: {mission.get('name')} (id={mission.get('id')})
- Environment: {mission.get('environment')}
- Public URL: {mission.get('public_url') or 'n/a'}
- API URL: {mission.get('api_url') or 'n/a'}
- Branch: {mission.get('branch') or 'n/a'}
- Frontend container: {mission.get('container_name') or 'n/a'}
- Backend container: {mission.get('backend_container') or 'n/a'}
- VM: {vm.get('name') or 'n/a'} @ {vm.get('host_ip') or 'n/a'} (vm_id={vm.get('id') or mission.get('vm_credential_id')})
- Pipeline profile: {mission.get('pipeline_profile')}
- Expected runway: {step_line or 'dynamic'}

### OWNERSHIP RULES (must follow)
- Backend: {own.get('backend')}
- Frontend: {own.get('frontend')}
- Database: {own.get('database')}

### SAFETY
- Prefer read-only diagnostics first (vm_health_check, docker inspect, logs).
- Never restart/stop/remove containers or delete files without explicit user Clearance.
- Never deploy frontend cloud builds yourself — tell the user to build/update cloud.
- For backend pull/restart: propose a Flight Plan, wait for approval, then execute only approved steps.
- If the issue is a code bug: prefer LOCAL FIX PATH (fix locally → push git → user/AI ship per ownership) over hacking the VM.
""".strip()
