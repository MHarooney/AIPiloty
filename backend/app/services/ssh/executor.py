"""SSH executor using Fabric with TOFU host key verification."""

from __future__ import annotations

import asyncio
import hashlib
import base64
import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

try:
    from fabric import Connection, Config
    FABRIC_AVAILABLE = True
except ImportError:
    FABRIC_AVAILABLE = False

try:
    import paramiko
    PARAMIKO_AVAILABLE = True
except ImportError:
    PARAMIKO_AVAILABLE = False


class HostKeyMismatchError(Exception):
    def __init__(self, host: str, expected: str, actual: str):
        self.host, self.expected, self.actual = host, expected, actual
        super().__init__(f"Host key mismatch for {host}: expected {expected}, got {actual}")


class HostKeyUnknownError(Exception):
    def __init__(self, host: str, fingerprint: str, key_type: str):
        self.host, self.fingerprint, self.key_type = host, fingerprint, key_type
        super().__init__(f"Unknown host key for {host} ({key_type}): {fingerprint}")


def get_remote_host_key_fingerprint(host: str, port: int = 22, timeout: int = 8) -> Dict[str, str]:
    if not PARAMIKO_AVAILABLE:
        raise ImportError("Paramiko is required for host key verification")
    transport = None
    try:
        transport = paramiko.Transport((host, port))
        transport.connect()
        key = transport.get_remote_server_key()
        raw = hashlib.sha256(key.asbytes()).digest()
        fingerprint = "SHA256:" + base64.b64encode(raw).decode().rstrip("=")
        return {"fingerprint": fingerprint, "key_type": key.get_name()}
    finally:
        if transport:
            try:
                transport.close()
            except Exception:
                pass


class SSHExecutor:
    """Execute commands on remote VMs via Fabric with TOFU verification."""

    def __init__(self) -> None:
        self._connections: Dict[str, Connection] = {}

    def _verify_host_key(self, host: str, port: int, stored_fingerprint: Optional[str], allow_unknown: bool = False) -> Optional[str]:
        if not PARAMIKO_AVAILABLE:
            return None
        info = get_remote_host_key_fingerprint(host, port)
        actual_fp = info["fingerprint"]
        if not stored_fingerprint:
            if allow_unknown:
                logger.info("TOFU: accepting host key for %s — %s", host, actual_fp)
                return actual_fp
            raise HostKeyUnknownError(host, actual_fp, info["key_type"])
        if stored_fingerprint != actual_fp:
            raise HostKeyMismatchError(host, stored_fingerprint, actual_fp)
        return actual_fp

    def _get_connection(
        self,
        host: str,
        username: str,
        password: Optional[str] = None,
        private_key: Optional[str] = None,
        port: int = 22,
        stored_fingerprint: Optional[str] = None,
        allow_unknown_host: bool = False,
    ) -> Connection:
        if not FABRIC_AVAILABLE:
            raise ImportError("Fabric is required for SSH operations")

        cache_key = f"{username}@{host}:{port}"
        if cache_key in self._connections:
            conn = self._connections[cache_key]
            if conn.is_connected:
                return conn
            del self._connections[cache_key]

        self._verify_host_key(host, port, stored_fingerprint, allow_unknown=allow_unknown_host)

        connect_kwargs: dict[str, Any] = {}
        if password:
            connect_kwargs["password"] = password
        if private_key:
            import io
            connect_kwargs["pkey"] = paramiko.RSAKey.from_private_key(io.StringIO(private_key))

        config = Config(overrides={"connect_kwargs": connect_kwargs})
        conn = Connection(host=host, user=username, port=port, config=config)
        self._connections[cache_key] = conn
        return conn

    async def execute_command(
        self,
        host: str,
        username: str,
        command: str,
        password: Optional[str] = None,
        private_key: Optional[str] = None,
        port: int = 22,
        stored_fingerprint: Optional[str] = None,
        timeout: int = 30,
        allow_unknown_host: bool = False,
    ) -> Dict[str, Any]:
        """Execute a command on a remote host. Returns structured result."""
        def _run():
            conn = self._get_connection(host, username, password, private_key, port, stored_fingerprint, allow_unknown_host)
            result = conn.run(command, hide=True, warn=True, timeout=timeout)
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "return_code": result.return_code,
                "success": result.ok,
            }

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _run)

    def close_all(self) -> None:
        for conn in self._connections.values():
            try:
                conn.close()
            except Exception:
                pass
        self._connections.clear()
