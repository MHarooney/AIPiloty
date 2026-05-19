"""Runbook API routes — CRUD + execute."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ...core.auth import require_auth
from ...core.database import get_db
from ...models.vm import VMCredential

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/runbooks", tags=["Runbooks"])

# In-memory store
_runbooks: dict[int, dict[str, Any]] = {}
_next_id = 1


class RunbookStep(BaseModel):
    command: str
    description: str = ""


class RunbookCreate(BaseModel):
    name: str
    description: str = ""
    steps: list[RunbookStep] = Field(default_factory=list)


class RunbookOut(BaseModel):
    id: int
    name: str
    description: str
    steps: list[dict[str, str]]
    created_at: str


@router.get("/", response_model=list[RunbookOut])
async def list_runbooks(identity: str = Depends(require_auth)):
    return list(_runbooks.values())


@router.post("/", response_model=RunbookOut)
async def create_runbook(payload: RunbookCreate, identity: str = Depends(require_auth)):
    global _next_id
    rb = {
        "id": _next_id,
        "name": payload.name,
        "description": payload.description,
        "steps": [s.model_dump() for s in payload.steps],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _runbooks[_next_id] = rb
    _next_id += 1
    return rb


@router.delete("/{runbook_id}")
async def delete_runbook(runbook_id: int, identity: str = Depends(require_auth)):
    if runbook_id not in _runbooks:
        raise HTTPException(404, "Runbook not found")
    del _runbooks[runbook_id]
    return {"status": "deleted"}


@router.post("/{runbook_id}/execute")
async def execute_runbook(
    runbook_id: int,
    vm_id: int | None = None,
    identity: str = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    """Execute all runbook steps on a VM via SSH."""
    rb = _runbooks.get(runbook_id)
    if not rb:
        raise HTTPException(404, "Runbook not found")

    from ...main import app_state

    ssh_executor = app_state.get("ssh_executor")
    if not ssh_executor:
        raise HTTPException(500, "SSH executor not available")

    # Get VM if specified
    vm = None
    if vm_id:
        result = await db.execute(select(VMCredential).where(VMCredential.id == vm_id))
        vm = result.scalar_one_or_none()
        if not vm:
            raise HTTPException(404, f"VM {vm_id} not found")

    if not vm:
        return {"message": "No VM specified — runbook validated but not executed", "steps": len(rb["steps"])}

    results = []
    for i, step in enumerate(rb["steps"]):
        try:
            cmd_result = await ssh_executor.execute_command(
                host=vm.host_ip,
                username=vm.ssh_username,
                command=step["command"],
                password=vm.decrypted_password,
                private_key=vm.decrypted_private_key,
                port=vm.ssh_port or 22,
                stored_fingerprint=vm.ssh_host_key_fingerprint,
            )
            results.append({
                "step": i + 1,
                "command": step["command"],
                "success": cmd_result.get("return_code", 1) == 0,
                "output": cmd_result.get("stdout", ""),
                "error": cmd_result.get("stderr", ""),
            })
            # Stop on failure
            if cmd_result.get("return_code", 1) != 0:
                results[-1]["stopped"] = True
                break
        except Exception as e:
            results.append({"step": i + 1, "command": step["command"], "success": False, "error": str(e), "stopped": True})
            break

    succeeded = sum(1 for r in results if r["success"])
    return {
        "message": f"Executed {len(results)}/{len(rb['steps'])} steps ({succeeded} succeeded)",
        "results": results,
    }
