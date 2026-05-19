"""Git operations API — status, diff, commit, log for workspace repo."""

from __future__ import annotations

import asyncio
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from ...core.auth import require_auth
from ...core.config import get_settings

router = APIRouter(prefix="/git", tags=["Git"])

_MAX_OUTPUT = 65_536


async def _run_git(*args: str, cwd: str | None = None) -> tuple[str, str, int]:
    """Run a git command and return (stdout, stderr, returncode)."""
    settings = get_settings()
    work_dir = cwd or str(settings.resolved_workspace)

    proc = await asyncio.create_subprocess_exec(
        "git", *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=work_dir,
    )
    stdout_bytes, stderr_bytes = await asyncio.wait_for(
        proc.communicate(), timeout=30,
    )
    return (
        stdout_bytes.decode("utf-8", errors="replace")[:_MAX_OUTPUT],
        stderr_bytes.decode("utf-8", errors="replace")[:_MAX_OUTPUT],
        proc.returncode or 0,
    )


# ── Schemas ───────────────────────────────────────────


class GitFile(BaseModel):
    status: str  # M, A, D, ??, etc.
    path: str


class GitStatusResponse(BaseModel):
    branch: str
    files: List[GitFile]
    clean: bool


class GitDiffResponse(BaseModel):
    diff: str
    file: Optional[str] = None


class GitLogEntry(BaseModel):
    hash: str
    short_hash: str
    author: str
    date: str
    message: str


class GitCommitRequest(BaseModel):
    message: str
    files: Optional[List[str]] = None  # None = stage all


class GitCommitResponse(BaseModel):
    hash: str
    message: str


# ── Endpoints ─────────────────────────────────────────


@router.get("/status", response_model=GitStatusResponse)
async def git_status(identity: str = Depends(require_auth)):
    """Return current branch and changed files."""
    # Branch name
    out, _, rc = await _run_git("rev-parse", "--abbrev-ref", "HEAD")
    branch = out.strip() if rc == 0 else "unknown"

    # Porcelain status for machine-readable output
    out, err, rc = await _run_git("status", "--porcelain=v1")
    if rc != 0:
        raise HTTPException(500, f"git status failed: {err.strip()}")

    files: List[GitFile] = []
    for line in out.strip().splitlines():
        if len(line) < 4:
            continue
        status_code = line[:2].strip()
        file_path = line[3:]
        files.append(GitFile(status=status_code, path=file_path))

    return GitStatusResponse(branch=branch, files=files, clean=len(files) == 0)


@router.get("/diff", response_model=GitDiffResponse)
async def git_diff(
    file: Optional[str] = Query(None, description="Specific file to diff"),
    staged: bool = Query(False, description="Show staged changes"),
    identity: str = Depends(require_auth),
):
    """Return diff output."""
    args = ["diff", "--stat"]
    if staged:
        args.append("--cached")
    # Full diff (not just stat)
    full_args = ["diff"]
    if staged:
        full_args.append("--cached")
    if file:
        full_args.extend(["--", file])

    out, err, rc = await _run_git(*full_args)
    if rc != 0:
        raise HTTPException(500, f"git diff failed: {err.strip()}")

    return GitDiffResponse(diff=out, file=file)


@router.get("/log")
async def git_log(
    limit: int = Query(20, ge=1, le=100),
    identity: str = Depends(require_auth),
):
    """Return recent commit log."""
    fmt = "%H|%h|%an|%ci|%s"
    out, err, rc = await _run_git("log", f"--format={fmt}", f"-{limit}")
    if rc != 0:
        raise HTTPException(500, f"git log failed: {err.strip()}")

    entries: List[GitLogEntry] = []
    for line in out.strip().splitlines():
        parts = line.split("|", 4)
        if len(parts) == 5:
            entries.append(GitLogEntry(
                hash=parts[0],
                short_hash=parts[1],
                author=parts[2],
                date=parts[3],
                message=parts[4],
            ))
    return entries


@router.post("/commit", response_model=GitCommitResponse)
async def git_commit(
    body: GitCommitRequest,
    identity: str = Depends(require_auth),
):
    """Stage files and commit."""
    if not body.message.strip():
        raise HTTPException(400, "Commit message is required")

    # Stage
    if body.files:
        # Stage specific files
        for f in body.files:
            _, err, rc = await _run_git("add", "--", f)
            if rc != 0:
                raise HTTPException(400, f"git add failed for {f}: {err.strip()}")
    else:
        # Stage all
        _, err, rc = await _run_git("add", "-A")
        if rc != 0:
            raise HTTPException(500, f"git add -A failed: {err.strip()}")

    # Commit
    out, err, rc = await _run_git("commit", "-m", body.message)
    if rc != 0:
        raise HTTPException(400, f"git commit failed: {err.strip()}")

    # Get the commit hash
    hash_out, _, _ = await _run_git("rev-parse", "HEAD")
    return GitCommitResponse(hash=hash_out.strip()[:12], message=body.message)
