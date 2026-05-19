"""Guardrails — command safety, PII redaction, prompt injection defense."""

from __future__ import annotations

import re
import shlex
import logging
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

COMMAND_DENYLIST: List[re.Pattern] = [
    re.compile(r"\brm\s+(-[a-zA-Z]*)?r[a-zA-Z]*f\b.*\/", re.I),
    re.compile(r"\brm\s+(-[a-zA-Z]*)?f[a-zA-Z]*r\b.*\/", re.I),
    re.compile(r"\bmkfs\b", re.I),
    re.compile(r"\bdd\s+if=", re.I),
    re.compile(r"\bfdisk\b", re.I),
    re.compile(r"\bparted\b", re.I),
    re.compile(r"\bshutdown\b", re.I),
    re.compile(r"\breboot\b", re.I),
    re.compile(r"\bhalt\b", re.I),
    re.compile(r"\bpoweroff\b", re.I),
    re.compile(r"\biptables\s+-F\b", re.I),
    re.compile(r"\bufw\s+disable\b", re.I),
    re.compile(r"\bchmod\s+777\s+\/", re.I),
    re.compile(r"\bchmod\s+-R\s+777\b", re.I),
    re.compile(r">\s*\/etc\/(passwd|shadow|sudoers)", re.I),
    re.compile(r"\bkill\s+-9\s+1\b"),
    re.compile(r"\bpkill\s+-9\b"),
    re.compile(r"\b(userdel|deluser)\s+root\b", re.I),
    re.compile(r"\bpasswd\s+root\b", re.I),
    re.compile(r":\(\)\s*\{\s*:\|:\s*&\s*\}"),
    re.compile(r"\bwget\b.*\|\s*(ba)?sh\b", re.I),
    re.compile(r"\bcurl\b.*\|\s*(ba)?sh\b", re.I),
]

READONLY_ALLOWLIST: List[str] = [
    "df", "free", "uptime", "w", "who", "uname", "hostname",
    "cat /etc/os-release", "lsb_release",
    "systemctl status", "systemctl is-active", "systemctl list-units",
    "docker ps", "docker stats --no-stream", "docker images", "docker info",
    "docker compose ps", "docker-compose ps",
    "journalctl --no-pager", "journalctl -n",
    "netstat -tlnp", "ss -tlnp", "ss -s",
    "du -sh", "ls -la", "ls -l",
    "top -bn1", "vmstat 1 1", "iostat",
    "cat /proc/meminfo", "cat /proc/cpuinfo",
    "nginx -t", "nginx -T",
    "tail -n", "head -n",
    "wc -l", "grep", "date", "id", "whoami",
    "dpkg -l", "rpm -qa", "apt list --installed",
]

_PII_PATTERNS: List[Tuple[re.Pattern, str]] = [
    (re.compile(r"Bearer\s+[A-Za-z0-9\-._~+/]+=*", re.I), "Bearer [REDACTED]"),
    (re.compile(r"(?i)(password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+"), r"\1=[REDACTED]"),
    (re.compile(r"-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"), "[REDACTED_PRIVATE_KEY]"),
    (re.compile(r"\b[a-zA-Z0-9._%+-]+@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b"), r"[redacted]@\1"),
]


class GuardrailService:
    """Safety guardrails for the AI agent."""

    def check_command_safety(self, command: str) -> dict:
        stripped = command.strip()
        for pattern in COMMAND_DENYLIST:
            if pattern.search(stripped):
                return {
                    "safe": False,
                    "reason": f"Command matches blocked pattern: {pattern.pattern}",
                    "is_readonly": False,
                    "requires_approval": True,
                    "risk_level": "critical",
                }
        is_readonly = any(
            stripped.startswith(a) if " " in a else stripped.split()[0] == a
            for a in READONLY_ALLOWLIST
        ) if stripped else False
        if is_readonly:
            return {"safe": True, "reason": None, "is_readonly": True, "requires_approval": False, "risk_level": "low"}

        risk = self._classify_risk(stripped)
        return {"safe": True, "reason": None, "is_readonly": False, "requires_approval": True, "risk_level": risk}

    def _classify_risk(self, command: str) -> str:
        high = ["sudo", "systemctl restart", "systemctl stop", "apt install", "apt remove",
                "docker rm", "docker rmi", "docker stop", "docker compose down",
                "chmod", "chown", "usermod"]
        medium = ["systemctl enable", "docker restart", "docker exec", "cp ", "mv ",
                  "mkdir", "echo .* >", "sed -i", "crontab"]
        for m in high:
            if re.search(m, command, re.I):
                return "high"
        for m in medium:
            if re.search(m, command, re.I):
                return "medium"
        return "medium"

    def redact_pii(self, text: str) -> str:
        if not text:
            return text
        result = text
        for pattern, replacement in _PII_PATTERNS:
            result = pattern.sub(replacement, result)
        return result

    def wrap_user_content(self, content: str) -> str:
        return f"<user_message>\n{content}\n</user_message>"

    def wrap_tool_output(self, tool_name: str, output: str) -> str:
        truncated = output[:4096] + "..." if len(output) > 4096 else output
        return f'<tool_result name="{tool_name}">\n{truncated}\n</tool_result>'

    def sanitize_command(self, command: str) -> str:
        sanitized = command.replace("\x00", "")
        sanitized = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", sanitized)
        return sanitized.strip()

    def quote_args(self, *args: str) -> List[str]:
        return [shlex.quote(a) for a in args]
