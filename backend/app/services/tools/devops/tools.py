"""DevOps tools — SSH command execution, deployment management."""

from __future__ import annotations

from typing import Any

from ..base import BaseTool, Param, ToolResult
from ...agent.guardrails import GuardrailService
from ...ssh.executor import SSHExecutor


class SSHCommandTool(BaseTool):
    name = "ssh_command"
    description = (
        "Execute a specific shell command on a remote VM via SSH (user-requested or custom ops). "
        "NOT for general health/status overviews — use vm_health_check for status, disk, memory, uptime, or docker summary. "
        "You can specify a registered vm_id OR provide host+username directly "
        "(e.g. when the user gives root@1.2.3.4). Direct mode auto-imports the VM for future use."
    )
    parameters = [
        Param("vm_id", "integer", "ID of a registered VM (use this OR host+username)", required=False),
        Param("host", "string", "IP address or hostname to connect to directly", required=False),
        Param("username", "string", "SSH username for direct connection (e.g. root)", required=False),
        Param("password", "string", "SSH password for direct connection (optional if key-based auth works)", required=False),
        Param("port", "integer", "SSH port for direct connection", required=False, default=22),
        Param("command", "string", "Shell command to execute"),
    ]
    risk_level = "high"
    requires_approval = True
    category = "devops"
    rate_limit_per_minute = 20

    def __init__(self, ssh: SSHExecutor, guardrails: GuardrailService, get_vm_func=None, save_vm_func=None):
        self._ssh = ssh
        self._guardrails = guardrails
        self._get_vm = get_vm_func  # async callable(vm_id) -> VMCredential
        self._save_vm = save_vm_func  # async callable(host, username, port, password) -> VMCredential

    async def execute(self, **kw: Any) -> ToolResult:
        command = kw.get("command", "")
        safety = self._guardrails.check_command_safety(command)
        if not safety["safe"]:
            return ToolResult(error=f"Command blocked: {safety['reason']}")

        host = kw.get("host")
        username = kw.get("username")
        vm_id = kw.get("vm_id")

        try:
            # --- Mode 1: Direct host+username (no DB lookup required) ---
            if host and username:
                password = kw.get("password")
                port = int(kw.get("port", 22))

                result = await self._ssh.execute_command(
                    host=host,
                    username=username,
                    command=self._guardrails.sanitize_command(command),
                    password=password,
                    port=port,
                    allow_unknown_host=True,
                )

                # Auto-import for future use
                if result.get("success") and self._save_vm:
                    try:
                        await self._save_vm(host=host, username=username, port=port, password=password)
                    except Exception:
                        pass  # non-critical — VM still executed fine

                return ToolResult(
                    output=result["stdout"],
                    metadata={
                        "return_code": result["return_code"],
                        "stderr": result["stderr"],
                        "host": host,
                        "username": username,
                    },
                )

            # --- Mode 2: Registered VM by ID ---
            if vm_id is not None:
                if not self._get_vm:
                    return ToolResult(error="VM lookup not configured")

                vm = await self._get_vm(int(vm_id))
                if not vm:
                    return ToolResult(error=f"VM {vm_id} not found in database. Provide host and username directly instead.")

                result = await self._ssh.execute_command(
                    host=vm.host_ip,
                    username=vm.ssh_username,
                    command=self._guardrails.sanitize_command(command),
                    password=vm.decrypted_password,
                    private_key=vm.decrypted_private_key,
                    port=vm.ssh_port or 22,
                    stored_fingerprint=vm.ssh_host_key_fingerprint,
                )
                return ToolResult(
                    output=result["stdout"],
                    metadata={"return_code": result["return_code"], "stderr": result["stderr"]},
                )

            return ToolResult(error="Provide either vm_id (registered VM) or host+username (direct SSH).")
        except Exception as e:
            return ToolResult(error=f"SSH execution failed: {e}")


class DeployTool(BaseTool):
    name = "deploy"
    description = "Trigger a deployment to a specific environment."
    parameters = [
        Param("deployment_id", "integer", "ID of the deployment"),
        Param("action", "string", "Action to perform", enum=["deploy", "stop", "restart"]),
    ]
    risk_level = "critical"
    requires_approval = True
    category = "devops"

    def __init__(self, deploy_func=None):
        self._deploy = deploy_func

    async def execute(self, **kw: Any) -> ToolResult:
        if not self._deploy:
            return ToolResult(error="Deployment service not configured")
        try:
            result = await self._deploy(kw["deployment_id"], kw["action"])
            return ToolResult(output=result)
        except Exception as e:
            return ToolResult(error=f"Deployment failed: {e}")


class VMHealthTool(BaseTool):
    name = "vm_health_check"
    description = (
        "Preferred tool when the user wants VM/server **status**, **health**, **check the machine**, or resource overview. "
        "Runs disk (df), memory (free), uptime, and docker container list over SSH. "
        "Use registered vm_id OR host+username (direct mode), same as ssh_command."
    )
    parameters = [
        Param("vm_id", "integer", "ID of a registered VM (use this OR host+username)", required=False),
        Param("host", "string", "IP address or hostname to connect to directly", required=False),
        Param("username", "string", "SSH username for direct connection", required=False),
        Param("password", "string", "SSH password for direct connection", required=False),
        Param("port", "integer", "SSH port for direct connection", required=False, default=22),
    ]
    risk_level = "low"
    category = "devops"

    def __init__(self, ssh: SSHExecutor, get_vm_func=None, save_vm_func=None):
        self._ssh = ssh
        self._get_vm = get_vm_func
        self._save_vm = save_vm_func

    async def _run_diagnostics(self, host: str, username: str, password=None, private_key=None, port: int = 22, fingerprint=None, allow_unknown: bool = False) -> ToolResult:
        diagnostics = []
        for cmd in ["df -h", "free -h", "uptime", "docker ps --format 'table {{.Names}}\\t{{.Status}}'"]:
            result = await self._ssh.execute_command(
                host=host,
                username=username,
                command=cmd,
                password=password,
                private_key=private_key,
                port=port,
                stored_fingerprint=fingerprint,
                allow_unknown_host=allow_unknown,
            )
            diagnostics.append(f"$ {cmd}\n{result['stdout']}")
        return ToolResult(output="\n---\n".join(diagnostics))

    async def execute(self, **kw: Any) -> ToolResult:
        host = kw.get("host")
        username = kw.get("username")
        vm_id = kw.get("vm_id")

        try:
            # --- Direct mode ---
            if host and username:
                password = kw.get("password")
                port = int(kw.get("port", 22))
                result = await self._run_diagnostics(host, username, password=password, port=port, allow_unknown=True)

                if self._save_vm:
                    try:
                        await self._save_vm(host=host, username=username, port=port, password=password)
                    except Exception:
                        pass

                return result

            # --- Registered VM mode ---
            if vm_id is not None:
                if not self._get_vm:
                    return ToolResult(error="VM lookup not configured")

                vm = await self._get_vm(int(vm_id))
                if not vm:
                    return ToolResult(error=f"VM {vm_id} not found in database. Provide host and username directly instead.")

                return await self._run_diagnostics(
                    vm.host_ip, vm.ssh_username,
                    password=vm.decrypted_password,
                    private_key=vm.decrypted_private_key,
                    port=vm.ssh_port or 22,
                    fingerprint=vm.ssh_host_key_fingerprint,
                )

            return ToolResult(error="Provide either vm_id (registered VM) or host+username (direct SSH).")
        except Exception as e:
            return ToolResult(error=f"Health check failed: {e}")
