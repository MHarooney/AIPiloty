"""Ownership rules for Mission Control (BE vs FE deploy authority)."""

from __future__ import annotations

from typing import Any


# Default product policy from ops history:
# - Backend: AI may SSH + git pull / restart containers (with Clearance)
# - Frontend: user builds & deploys cloud unless explicit clearance
DEFAULT_OWNERSHIP = {
    "backend": {
        "actor": "ai",
        "label": "Backend",
        "policy": "AI may SSH + pull on VM (Clearance for restarts)",
        "actions_allowed": ["ssh_read", "git_pull", "health_check", "docker_inspect"],
        "actions_need_clearance": ["docker_restart", "docker_stop", "composer", "migrate"],
    },
    "frontend": {
        "actor": "user",
        "label": "Frontend",
        "policy": "User builds & deploys to cloud",
        "actions_allowed": [],
        "actions_need_clearance": ["frontend_cloud_deploy", "docker_push_frontend"],
    },
    "database": {
        "actor": "clearance",
        "label": "Database",
        "policy": "Always requires Clearance",
        "actions_allowed": [],
        "actions_need_clearance": ["migrate", "db_shell", "drop", "seed"],
    },
}


def default_ownership() -> dict[str, Any]:
    return {k: dict(v) for k, v in DEFAULT_OWNERSHIP.items()}


def ownership_summary(raw: dict[str, Any] | None = None) -> dict[str, str]:
    """Compact strip for UI: { backend: '...', frontend: '...', database: '...' }."""
    own = raw or default_ownership()
    return {
        "backend": own.get("backend", {}).get("policy", DEFAULT_OWNERSHIP["backend"]["policy"]),
        "frontend": own.get("frontend", {}).get("policy", DEFAULT_OWNERSHIP["frontend"]["policy"]),
        "database": own.get("database", {}).get("policy", DEFAULT_OWNERSHIP["database"]["policy"]),
    }


def classify_action_risk(action: str, ownership: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return clearance requirement for a proposed action name."""
    own = ownership or default_ownership()
    action_l = (action or "").strip().lower()
    for lane, cfg in own.items():
        if action_l in [a.lower() for a in cfg.get("actions_allowed", [])]:
            return {"lane": lane, "requires_clearance": False, "risk": "low", "actor": cfg.get("actor")}
        if action_l in [a.lower() for a in cfg.get("actions_need_clearance", [])]:
            risk = "high" if lane in ("database", "frontend") else "medium"
            return {"lane": lane, "requires_clearance": True, "risk": risk, "actor": cfg.get("actor")}
    # Unknown destructive verbs → clearance
    if any(x in action_l for x in ("rm ", "drop", "delete", "restart", "stop", "kill", "deploy")):
        return {"lane": "unknown", "requires_clearance": True, "risk": "high", "actor": "clearance"}
    return {"lane": "unknown", "requires_clearance": False, "risk": "low", "actor": "ai"}
