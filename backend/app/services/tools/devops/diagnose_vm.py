"""Deep VM diagnostics tool — runs comprehensive checks beyond basic health."""

from __future__ import annotations

from typing import Any

from ..base import BaseTool, Param, ToolResult
from ...ssh.executor import SSHExecutor


class DiagnoseVMTool(BaseTool):
    """Run deep diagnostics on a VM: services, ports, logs, security checks."""

    name = "diagnose_vm"
    description = (
        "Run comprehensive diagnostics on a VM including service status, open ports, "
        "recent error logs, failed systemd units, disk I/O, network connectivity, and "
        "security checks (firewall, failed SSH logins). Use for troubleshooting."
    )
    parameters = [
        Param("vm_id", "integer", "ID of a registered VM (use this OR host+username)", required=False),
        Param("host", "string", "IP/hostname for direct connection", required=False),
        Param("username", "string", "SSH username for direct connection", required=False),
        Param("password", "string", "SSH password (optional)", required=False),
        Param("port", "integer", "SSH port", required=False, default=22),
        Param("category", "string", "Diagnostic category", required=False,
              enum=["all", "services", "network", "security", "performance", "logs"]),
    ]
    risk_level = "low"
    category = "devops"
    rate_limit_per_minute = 10

    _DIAGNOSTICS = {
        "services": [
            ("systemctl list-units --state=failed --plain --no-legend", "Failed systemd units"),
            ("systemctl list-units --state=running --type=service --plain --no-legend | head -30", "Running services"),
            ("docker ps -a --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}' 2>/dev/null || echo 'Docker not installed'", "Docker containers"),
        ],
        "network": [
            ("ss -tlnp | head -25", "Listening ports"),
            ("ip addr show | grep 'inet ' | awk '{print $2, $NF}'", "Network interfaces"),
            ("ping -c2 -W2 1.1.1.1 2>&1 | tail -3", "Internet connectivity"),
            ("cat /etc/resolv.conf | grep nameserver", "DNS servers"),
        ],
        "security": [
            ("ufw status 2>/dev/null || iptables -L -n --line-numbers 2>/dev/null | head -20 || echo 'No firewall detected'", "Firewall status"),
            ("lastb -n 10 2>/dev/null | head -10 || journalctl -u sshd --no-pager -n 10 --grep 'Failed' 2>/dev/null || echo 'No failed login data'", "Failed login attempts"),
            ("find /etc/ssh -name 'sshd_config' -exec grep -E 'PermitRootLogin|PasswordAuthentication|Port' {} \\;", "SSH configuration"),
        ],
        "performance": [
            ("top -bn1 | head -15", "CPU/process overview"),
            ("free -h", "Memory usage"),
            ("df -h", "Disk usage"),
            ("iostat -x 1 1 2>/dev/null || echo 'iostat not available'", "Disk I/O"),
            ("cat /proc/loadavg", "Load average"),
        ],
        "logs": [
            ("journalctl --no-pager -p err -n 20 --since '24 hours ago' 2>/dev/null || dmesg | tail -20", "Recent error logs"),
            ("journalctl --no-pager -u nginx -n 10 2>/dev/null || echo 'No nginx logs'", "Nginx logs"),
            ("journalctl --no-pager -u docker -n 10 2>/dev/null || echo 'No docker logs'", "Docker daemon logs"),
        ],
    }

    def __init__(self, ssh: SSHExecutor, get_vm_func=None, save_vm_func=None):
        self._ssh = ssh
        self._get_vm = get_vm_func
        self._save_vm = save_vm_func

    async def _run_checks(self, host: str, username: str, category: str,
                          password=None, private_key=None, port: int = 22,
                          fingerprint=None, allow_unknown: bool = False) -> ToolResult:
        categories = list(self._DIAGNOSTICS.keys()) if category == "all" else [category]
        sections = []

        for cat in categories:
            commands = self._DIAGNOSTICS.get(cat, [])
            cat_results = [f"## {cat.upper()}"]
            for cmd, label in commands:
                try:
                    result = await self._ssh.execute_command(
                        host=host, username=username, command=cmd,
                        password=password, private_key=private_key, port=port,
                        stored_fingerprint=fingerprint, allow_unknown_host=allow_unknown,
                    )
                    output = (result.get("stdout") or "").strip() or "(empty)"
                    cat_results.append(f"### {label}\n```\n{output}\n```")
                except Exception as e:
                    cat_results.append(f"### {label}\n⚠ Error: {e}")
            sections.append("\n".join(cat_results))

        return ToolResult(output="\n\n---\n\n".join(sections))

    async def execute(self, **kw: Any) -> ToolResult:
        category = kw.get("category", "all")
        if category not in ("all", "services", "network", "security", "performance", "logs"):
            category = "all"

        host = kw.get("host")
        username = kw.get("username")
        vm_id = kw.get("vm_id")

        try:
            if host and username:
                password = kw.get("password")
                port = int(kw.get("port", 22))
                result = await self._run_checks(host, username, category,
                                                password=password, port=port, allow_unknown=True)
                if self._save_vm:
                    try:
                        await self._save_vm(host=host, username=username, port=port, password=password)
                    except Exception:
                        pass
                return result

            if vm_id is not None:
                if not self._get_vm:
                    return ToolResult(error="VM lookup not configured")
                vm = await self._get_vm(int(vm_id))
                if not vm:
                    return ToolResult(error=f"VM {vm_id} not found")
                return await self._run_checks(
                    vm.host_ip, vm.ssh_username, category,
                    password=vm.decrypted_password, private_key=vm.decrypted_private_key,
                    port=vm.ssh_port or 22, fingerprint=vm.ssh_host_key_fingerprint,
                )

            return ToolResult(error="Provide either vm_id or host+username.")
        except Exception as e:
            return ToolResult(error=f"Diagnostics failed: {e}")
