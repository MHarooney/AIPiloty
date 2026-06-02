"""Docker deployment pipeline executor — runs git pull → build → push → SSH deploy."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any, AsyncGenerator

logger = logging.getLogger(__name__)

_STEP_LABELS: dict[str, str] = {
    "git_pull":     "Git Pull",
    "docker_login": "Docker Login",
    "docker_build": "Docker Build",
    "docker_tag":   "Docker Tag",
    "docker_push":  "Docker Push",
    "ssh_pull":     "Pull on Server",
    "ssh_stop":     "Stop & Remove",
    "ssh_run":      "Start Container",
}

# Long-running steps that need a higher SSH timeout
_LONG_STEPS = {"ssh_pull", "docker_build", "docker_push"}


def _emit(event: dict) -> bytes:
    return f"data: {json.dumps(event)}\n\n".encode()


class PipelineExecutor:
    """Executes a Docker deployment pipeline and streams SSE-encoded log events."""

    def __init__(self, ssh_executor: Any) -> None:
        self._ssh = ssh_executor

    def _plan_steps(self, dep: dict) -> list[str]:
        steps: list[str] = []

        # Local steps — only if source directory is specified
        if dep.get("deploy_path") and dep.get("branch"):
            steps.append("git_pull")

        # Docker build/push — only if image names are configured
        if dep.get("dockerhub_image"):
            from ..core.config import get_settings
            s = get_settings()
            if s.docker_hub_username and s.docker_hub_password:
                steps.append("docker_login")
            if dep.get("docker_image"):
                steps.extend(["docker_build", "docker_tag"])
            steps.append("docker_push")

        # Remote SSH deployment — only if VM + container name are set
        if dep.get("vm_credential_id") and dep.get("container_name"):
            steps.extend(["ssh_pull", "ssh_stop", "ssh_run"])

        return steps

    async def stream_run(
        self,
        dep_config: dict,
        run_id: int,
    ) -> AsyncGenerator[bytes, None]:
        """Async generator that yields SSE-encoded bytes for a full pipeline run."""
        steps = self._plan_steps(dep_config)
        if not steps:
            yield _emit({"type": "error", "message": "No pipeline steps configured for this deployment. Set dockerhub_image and vm_credential_id at minimum."})
            yield b"data: [DONE]\n\n"
            return

        yield _emit({"type": "pipeline_start", "steps": steps, "labels": _STEP_LABELS, "run_id": run_id})

        log_lines: list[str] = []
        start_time = asyncio.get_event_loop().time()
        overall_status = "success"

        for step in steps:
            label = _STEP_LABELS.get(step, step)
            yield _emit({"type": "step_start", "step": step, "label": label})
            step_log: list[str] = []
            try:
                async for line in self._run_step(step, dep_config):
                    step_log.append(line)
                    log_lines.append(f"[{step}] {line}")
                    yield _emit({"type": "log", "step": step, "line": line})
                yield _emit({"type": "step_done", "step": step, "status": "success"})
            except Exception as exc:
                overall_status = "failed"
                err_msg = str(exc)
                log_lines.append(f"[{step}] ERROR: {err_msg}")
                yield _emit({"type": "step_done", "step": step, "status": "failed", "error": err_msg})
                yield _emit({"type": "pipeline_done", "status": "failed", "run_id": run_id, "error": err_msg})
                yield b"data: [DONE]\n\n"
                await self._finalize_run(run_id, dep_config["id"], "failed", "\n".join(log_lines),
                                         asyncio.get_event_loop().time() - start_time)
                return

        duration = round(asyncio.get_event_loop().time() - start_time, 1)
        yield _emit({"type": "pipeline_done", "status": "success", "run_id": run_id, "duration": duration})
        yield b"data: [DONE]\n\n"
        await self._finalize_run(run_id, dep_config["id"], "success", "\n".join(log_lines), duration)

    async def _run_step(self, step: str, dep: dict) -> AsyncGenerator[str, None]:
        """Dispatch to per-step implementation. Each branch is an async generator."""
        if step == "git_pull":
            async for line in self._local_cmd(
                ["git", "pull", "origin", dep["branch"], "--no-rebase"],
                cwd=dep.get("deploy_path"),
            ):
                yield line

        elif step == "docker_login":
            from ..core.config import get_settings
            s = get_settings()
            async for line in self._local_cmd([
                "docker", "login",
                "-u", s.docker_hub_username or "",
                "--password-stdin",
            ], stdin_data=(s.docker_hub_password or "") + "\n"):
                yield line

        elif step == "docker_build":
            platform = dep.get("build_platform") or "linux/amd64"
            dockerfile = dep.get("dockerfile") or "Dockerfile"
            tag = f"{dep['docker_image']}:{dep.get('dockerhub_tag') or 'latest'}"
            async for line in self._local_cmd(
                ["docker", "build", "-t", tag, "--platform", platform, "-f", dockerfile, "."],
                cwd=dep.get("deploy_path"),
            ):
                yield line

        elif step == "docker_tag":
            src = f"{dep['docker_image']}:{dep.get('dockerhub_tag') or 'latest'}"
            dst = f"{dep['dockerhub_image']}:{dep.get('dockerhub_tag') or 'latest'}"
            if src != dst:
                async for line in self._local_cmd(["docker", "tag", src, dst]):
                    yield line
            else:
                yield f"Skipped: source and destination tags are identical ({src})"

        elif step == "docker_push":
            target = f"{dep['dockerhub_image']}:{dep.get('dockerhub_tag') or 'latest'}"
            async for line in self._local_cmd(["docker", "push", target]):
                yield line

        elif step in ("ssh_pull", "ssh_stop", "ssh_run"):
            vm = await self._get_vm(dep["vm_credential_id"])
            if not vm:
                raise RuntimeError(f"VM {dep['vm_credential_id']} not found in database")

            cmd_str = self._build_ssh_command(step, dep)
            timeout = 300 if step in _LONG_STEPS else 60
            result = await self._ssh.execute_command(
                host=vm.host_ip,
                username=vm.ssh_username,
                command=cmd_str,
                password=vm.decrypted_password,
                private_key=vm.decrypted_private_key,
                port=vm.ssh_port or 22,
                stored_fingerprint=vm.ssh_host_key_fingerprint,
                timeout=timeout,
            )
            output = (result.get("stdout") or "") + (result.get("stderr") or "")
            for line in output.splitlines():
                if line.strip():
                    yield line
            # ssh_stop may legitimately fail (container not running) — that's fine
            if not result.get("success") and step != "ssh_stop":
                raise RuntimeError(
                    f"SSH command failed (rc={result.get('return_code')}): {output[:400]}"
                )

    @staticmethod
    def _build_ssh_command(step: str, dep: dict) -> str:
        image = f"{dep['dockerhub_image']}:{dep.get('dockerhub_tag') or 'latest'}"
        container = dep["container_name"]

        if step == "ssh_pull":
            return f"docker pull {image}"

        if step == "ssh_stop":
            # Always succeeds — container may not exist on first deploy
            return (
                f"docker stop {container} 2>/dev/null || true; "
                f"docker rm {container} 2>/dev/null || true"
            )

        # ssh_run
        parts = ["docker", "run", "-d", "--name", container]
        if dep.get("docker_network"):
            parts += ["--network", dep["docker_network"]]
        if dep.get("port_mapping"):
            parts += ["-p", dep["port_mapping"]]
        extra = (dep.get("docker_run_extra_args") or "").strip()
        if extra:
            parts += extra.split()
        parts.append(image)
        return " ".join(parts)

    async def _local_cmd(
        self,
        cmd: list[str],
        cwd: str | None = None,
        stdin_data: str | None = None,
    ) -> AsyncGenerator[str, None]:
        """Run a local subprocess and yield output lines. Raises on non-zero exit."""
        stdin_pipe = asyncio.subprocess.PIPE if stdin_data else asyncio.subprocess.DEVNULL
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            stdin=stdin_pipe,
            cwd=cwd,
        )
        if stdin_data and proc.stdin:
            proc.stdin.write(stdin_data.encode())
            proc.stdin.close()

        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode(errors="replace").rstrip()
            if line:
                yield line

        await proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(
                f"Command exited with code {proc.returncode}: {' '.join(str(c) for c in cmd)}"
            )

    async def _get_vm(self, vm_id: int):
        from ..core.database import async_session_factory
        from ..models.vm import VMCredential
        from sqlalchemy import select

        async with async_session_factory() as session:
            result = await session.execute(select(VMCredential).where(VMCredential.id == vm_id))
            return result.scalar_one_or_none()

    async def _finalize_run(
        self,
        run_id: int,
        deployment_id: int,
        status: str,
        log: str,
        duration: float,
    ) -> None:
        from ..core.database import async_session_factory
        from ..models.deployment import DeploymentRun, RunStatus, Deployment, DeploymentStatus
        from sqlalchemy import select

        async with async_session_factory() as session:
            result = await session.execute(
                select(DeploymentRun).where(DeploymentRun.id == run_id)
            )
            run = result.scalar_one_or_none()
            if run:
                run.status = RunStatus.SUCCESS if status == "success" else RunStatus.FAILED
                run.completed_at = datetime.now(timezone.utc)
                run.log = log
                run.duration_seconds = duration

            dep_result = await session.execute(
                select(Deployment).where(Deployment.id == deployment_id)
            )
            dep = dep_result.scalar_one_or_none()
            if dep:
                if status == "success":
                    dep.status = DeploymentStatus.RUNNING
                    dep.last_deployed_at = datetime.now(timezone.utc)
                    dep.error_message = None
                else:
                    dep.status = DeploymentStatus.FAILED

            await session.commit()
            logger.info(
                "DeploymentRun %d finalized: %s (%.1fs)", run_id, status, duration
            )
