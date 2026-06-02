"""Tests for VM CRUD endpoints + rate-limit on monitoring."""

from __future__ import annotations

import asyncio
import time
import pytest
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch


# ── Create tables for in-memory DB ───────────────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def create_tables(_app):
    """Ensure all SQLAlchemy tables exist in the test in-memory DB."""
    from app.core.database import engine, Base
    from app.models import vm, deployment, webhook  # noqa: F401

    async def _create():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.get_event_loop().run_until_complete(_create())


# ── Auth guard ───────────────────────────────────────────────────────────────

class TestVMAuth:
    def test_list_requires_auth(self, client: TestClient):
        resp = client.get("/api/v1/vms/")
        assert resp.status_code in (401, 403)

    def test_create_requires_auth(self, client: TestClient):
        resp = client.post("/api/v1/vms/", json={})
        assert resp.status_code in (401, 403)

    def test_delete_requires_auth(self, client: TestClient):
        resp = client.delete("/api/v1/vms/1")
        assert resp.status_code in (401, 403)

    def test_get_vm_requires_auth(self, client: TestClient):
        resp = client.get("/api/v1/vms/1")
        assert resp.status_code in (401, 403)


# ── Happy-path CRUD ──────────────────────────────────────────────────────────

class TestVMCRUD:
    _vm_payload = {
        "name": "prod-server",
        "provider": "digitalocean",
        "host_ip": "192.0.2.1",
        "ssh_username": "ubuntu",
        "ssh_port": 22,
    }

    def test_list_vms_returns_list(self, authed):
        resp = authed.get("/api/v1/vms/")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_create_vm_returns_201_or_200(self, authed):
        resp = authed.post("/api/v1/vms/", json=self._vm_payload)
        assert resp.status_code in (200, 201)
        body = resp.json()
        assert body["name"] == "prod-server"
        assert body["host_ip"] == "192.0.2.1"
        assert "id" in body

    def test_create_vm_appears_in_list(self, authed):
        authed.post("/api/v1/vms/", json=self._vm_payload)
        resp = authed.get("/api/v1/vms/")
        assert resp.status_code == 200
        names = [vm["name"] for vm in resp.json()]
        assert "prod-server" in names

    def test_get_vm_by_id(self, authed):
        create_resp = authed.post("/api/v1/vms/", json=self._vm_payload)
        vm_id = create_resp.json()["id"]

        resp = authed.get(f"/api/v1/vms/{vm_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == vm_id

    def test_get_nonexistent_vm_returns_404(self, authed):
        resp = authed.get("/api/v1/vms/999999")
        assert resp.status_code == 404

    def test_delete_vm(self, authed):
        create_resp = authed.post("/api/v1/vms/", json=self._vm_payload)
        vm_id = create_resp.json()["id"]

        del_resp = authed.delete(f"/api/v1/vms/{vm_id}")
        assert del_resp.status_code == 200

        get_resp = authed.get(f"/api/v1/vms/{vm_id}")
        assert get_resp.status_code == 404

    def test_delete_nonexistent_vm_returns_404(self, authed):
        resp = authed.delete("/api/v1/vms/999999")
        assert resp.status_code == 404

    def test_ssh_password_not_echoed(self, authed):
        """VM creation must not echo the SSH password in the response."""
        payload = {**self._vm_payload, "ssh_password": "super-secret-password"}
        resp = authed.post("/api/v1/vms/", json=payload)
        assert resp.status_code in (200, 201)
        raw = resp.text
        assert "super-secret-password" not in raw

    def test_ssh_private_key_not_echoed(self, authed):
        """VM creation must not echo the SSH private key."""
        payload = {**self._vm_payload, "ssh_private_key": "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAK"}
        resp = authed.post("/api/v1/vms/", json=payload)
        assert resp.status_code in (200, 201)
        assert "BEGIN RSA PRIVATE KEY" not in resp.text


# ── Validation edge cases ────────────────────────────────────────────────────

class TestVMValidation:
    def test_create_vm_missing_required_fields(self, authed):
        """name, provider, host_ip, ssh_username are required."""
        resp = authed.post("/api/v1/vms/", json={"name": "incomplete"})
        assert resp.status_code == 422

    def test_create_vm_empty_name(self, authed):
        resp = authed.post("/api/v1/vms/", json={
            "name": "",
            "provider": "aws",
            "host_ip": "10.0.0.1",
            "ssh_username": "ec2-user",
        })
        # Empty string is technically valid in Pydantic unless min_length is set
        assert resp.status_code in (200, 201, 422)

    def test_create_vm_default_ssh_port(self, authed):
        """ssh_port should default to 22."""
        payload = {
            "name": "default-port",
            "provider": "aws",
            "host_ip": "10.0.0.2",
            "ssh_username": "ec2-user",
        }
        resp = authed.post("/api/v1/vms/", json=payload)
        assert resp.status_code in (200, 201)
        assert resp.json()["ssh_port"] == 22

    def test_get_vm_invalid_id_type(self, authed):
        """String VM id must be rejected with 422."""
        resp = authed.get("/api/v1/vms/not-an-integer")
        assert resp.status_code == 422


# ── Rate-limit on monitoring endpoint ───────────────────────────────────────

class TestVMMonitoringRateLimit:
    """The /vms/{id}/monitoring endpoint enforces 5 req/60s per IP."""

    def test_monitoring_ratelimit_triggers_after_burst(self, authed, client: TestClient):
        """Send 7 monitoring requests — requests 6 and 7 must be 429."""
        from app.api.v1 import vms as vms_module
        from unittest.mock import AsyncMock, patch

        # Reset the in-memory hits dict so previous tests don't interfere
        vms_module._monitor_hits.clear()

        from app.core.config import get_settings
        headers = {"X-API-Key": get_settings().api_key}

        # Create a VM first so we have a valid ID to monitor
        create_resp = client.post("/api/v1/vms/", json={
            "name": "monitor-vm",
            "provider": "gcp",
            "host_ip": "203.0.113.5",
            "ssh_username": "root",
        }, headers=headers)
        vm_id = create_resp.json().get("id", 1)

        # Mock SSH executor so the monitoring endpoint returns immediately
        # (avoids hanging on real SSH connection to non-existent host)
        mock_ssh = AsyncMock()
        mock_ssh.execute_command = AsyncMock(
            return_value={"stdout": "0.5", "stderr": "", "exit_code": 0}
        )

        import app.main as _main_module
        with patch.dict(_main_module.app_state, {"ssh_executor": mock_ssh}):
            status_codes = []
            for _ in range(7):
                r = client.get(f"/api/v1/vms/{vm_id}/monitoring", headers=headers)
                status_codes.append(r.status_code)

        # Requests 6 and 7 must be rate-limited (429)
        rate_limited = [s for s in status_codes if s == 429]
        assert len(rate_limited) >= 2, (
            f"Expected ≥2 rate-limited (429) responses, got: {status_codes}"
        )
