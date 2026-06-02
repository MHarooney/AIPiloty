"""Tests for Scheduler jobs CRUD + toggle + status endpoints.

All tests use the shared conftest fixtures (in-memory store, no real infra).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _reset_scheduler_store():
    """Reset in-memory job store between tests."""
    from app.api.v1 import scheduler as sched_module
    sched_module._jobs.clear()
    sched_module._next_id = 1
    yield
    sched_module._jobs.clear()
    sched_module._next_id = 1


# ── Auth guards ──────────────────────────────────────────────────────────────

class TestSchedulerAuth:
    def test_list_jobs_requires_auth(self, client: TestClient):
        assert client.get("/api/v1/scheduler/jobs").status_code in (401, 403)

    def test_create_job_requires_auth(self, client: TestClient):
        assert client.post("/api/v1/scheduler/jobs", json={}).status_code in (401, 403)

    def test_delete_job_requires_auth(self, client: TestClient):
        assert client.delete("/api/v1/scheduler/jobs/1").status_code in (401, 403)

    def test_toggle_job_requires_auth(self, client: TestClient):
        assert client.post("/api/v1/scheduler/jobs/1/toggle").status_code in (401, 403)

    def test_status_requires_auth(self, client: TestClient):
        assert client.get("/api/v1/scheduler/status").status_code in (401, 403)


# ── Happy-path CRUD ──────────────────────────────────────────────────────────

class TestSchedulerCRUD:
    _payload = {
        "name": "nightly-backup",
        "command": "pg_dump mydb > backup.sql",
        "cron": "0 2 * * *",
        "enabled": True,
    }

    def test_list_jobs_empty_initially(self, authed):
        resp = authed.get("/api/v1/scheduler/jobs")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_create_job_success(self, authed):
        resp = authed.post("/api/v1/scheduler/jobs", json=self._payload)
        assert resp.status_code in (200, 201)
        body = resp.json()
        assert body["name"] == "nightly-backup"
        assert body["command"] == "pg_dump mydb > backup.sql"
        assert body["cron"] == "0 2 * * *"
        assert body["enabled"] is True
        assert "id" in body
        assert "created_at" in body
        assert body["last_run"] is None

    def test_create_job_appears_in_list(self, authed):
        authed.post("/api/v1/scheduler/jobs", json=self._payload)
        resp = authed.get("/api/v1/scheduler/jobs")
        assert len(resp.json()) == 1

    def test_create_multiple_jobs(self, authed):
        for i in range(3):
            authed.post("/api/v1/scheduler/jobs", json={**self._payload, "name": f"job-{i}"})
        assert len(authed.get("/api/v1/scheduler/jobs").json()) == 3

    def test_ids_auto_increment(self, authed):
        ids = [
            authed.post("/api/v1/scheduler/jobs", json={**self._payload, "name": f"j{i}"}).json()["id"]
            for i in range(3)
        ]
        assert len(set(ids)) == 3  # all unique

    def test_delete_job(self, authed):
        job_id = authed.post("/api/v1/scheduler/jobs", json=self._payload).json()["id"]
        del_resp = authed.delete(f"/api/v1/scheduler/jobs/{job_id}")
        assert del_resp.status_code == 200
        assert authed.get("/api/v1/scheduler/jobs").json() == []

    def test_delete_nonexistent_job_returns_404(self, authed):
        resp = authed.delete("/api/v1/scheduler/jobs/99999")
        assert resp.status_code == 404

    def test_delete_only_removes_target(self, authed):
        id_keep = authed.post("/api/v1/scheduler/jobs", json={**self._payload, "name": "keep"}).json()["id"]
        id_del = authed.post("/api/v1/scheduler/jobs", json={**self._payload, "name": "del"}).json()["id"]
        authed.delete(f"/api/v1/scheduler/jobs/{id_del}")
        jobs = authed.get("/api/v1/scheduler/jobs").json()
        assert len(jobs) == 1
        assert jobs[0]["id"] == id_keep


# ── Toggle ────────────────────────────────────────────────────────────────────

class TestSchedulerToggle:
    _payload = {
        "name": "toggle-test",
        "command": "echo test",
        "cron": "* * * * *",
        "enabled": True,
    }

    def test_toggle_disables_enabled_job(self, authed):
        job_id = authed.post("/api/v1/scheduler/jobs", json=self._payload).json()["id"]
        resp = authed.post(f"/api/v1/scheduler/jobs/{job_id}/toggle")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is False

    def test_toggle_enables_disabled_job(self, authed):
        job_id = authed.post("/api/v1/scheduler/jobs", json={**self._payload, "enabled": False}).json()["id"]
        resp = authed.post(f"/api/v1/scheduler/jobs/{job_id}/toggle")
        assert resp.status_code == 200
        assert resp.json()["enabled"] is True

    def test_double_toggle_restores_original(self, authed):
        job_id = authed.post("/api/v1/scheduler/jobs", json=self._payload).json()["id"]
        authed.post(f"/api/v1/scheduler/jobs/{job_id}/toggle")
        resp = authed.post(f"/api/v1/scheduler/jobs/{job_id}/toggle")
        assert resp.json()["enabled"] is True

    def test_toggle_nonexistent_job_returns_404(self, authed):
        resp = authed.post("/api/v1/scheduler/jobs/99999/toggle")
        assert resp.status_code == 404


# ── Validation ────────────────────────────────────────────────────────────────

class TestSchedulerValidation:
    def test_create_requires_name(self, authed):
        resp = authed.post("/api/v1/scheduler/jobs", json={"command": "echo hi"})
        assert resp.status_code == 422

    def test_create_requires_command(self, authed):
        resp = authed.post("/api/v1/scheduler/jobs", json={"name": "no-cmd"})
        assert resp.status_code == 422

    def test_create_default_cron(self, authed):
        """cron defaults to hourly if omitted."""
        resp = authed.post("/api/v1/scheduler/jobs", json={"name": "x", "command": "ls"})
        assert resp.status_code in (200, 201)
        assert resp.json()["cron"] == "0 * * * *"

    def test_create_default_enabled_true(self, authed):
        resp = authed.post("/api/v1/scheduler/jobs", json={"name": "x", "command": "ls"})
        assert resp.status_code in (200, 201)
        assert resp.json()["enabled"] is True


# ── Status endpoint ───────────────────────────────────────────────────────────

class TestSchedulerStatus:
    def test_status_returns_200(self, authed):
        resp = authed.get("/api/v1/scheduler/status")
        assert resp.status_code == 200

    def test_status_is_json(self, authed):
        resp = authed.get("/api/v1/scheduler/status")
        assert resp.headers["content-type"].startswith("application/json")
