"""Tests for Runbook CRUD + execute endpoints.

All tests use the shared conftest fixtures (in-memory SQLite, mocked externals).
The runbook store is in-memory so tests are fully isolated.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


# ── Module-level reset of in-memory store ────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_runbook_store():
    """Reset in-memory runbook dict between tests to prevent state leak."""
    from app.api.v1 import runbooks as rb_module
    rb_module._runbooks.clear()
    rb_module._next_id = 1
    yield
    rb_module._runbooks.clear()
    rb_module._next_id = 1


# ── Auth guards ──────────────────────────────────────────────────────────────

class TestRunbookAuth:
    def test_list_requires_auth(self, client: TestClient):
        assert client.get("/api/v1/runbooks/").status_code in (401, 403)

    def test_create_requires_auth(self, client: TestClient):
        assert client.post("/api/v1/runbooks/", json={}).status_code in (401, 403)

    def test_delete_requires_auth(self, client: TestClient):
        assert client.delete("/api/v1/runbooks/1").status_code in (401, 403)

    def test_execute_requires_auth(self, client: TestClient):
        assert client.post("/api/v1/runbooks/1/execute").status_code in (401, 403)


# ── Happy-path CRUD ──────────────────────────────────────────────────────────

class TestRunbookCRUD:
    _payload = {
        "name": "Deploy App",
        "description": "Steps to deploy the app",
        "steps": [
            {"command": "git pull", "description": "Pull latest"},
            {"command": "systemctl restart app", "description": "Restart service"},
        ],
    }

    def test_list_empty_initially(self, authed):
        resp = authed.get("/api/v1/runbooks/")
        assert resp.status_code == 200
        assert resp.json() == []

    def test_create_runbook(self, authed):
        resp = authed.post("/api/v1/runbooks/", json=self._payload)
        assert resp.status_code in (200, 201)
        body = resp.json()
        assert body["name"] == "Deploy App"
        assert body["description"] == "Steps to deploy the app"
        assert len(body["steps"]) == 2
        assert "id" in body
        assert "created_at" in body

    def test_create_runbook_auto_increments_id(self, authed):
        r1 = authed.post("/api/v1/runbooks/", json={**self._payload, "name": "RB1"})
        r2 = authed.post("/api/v1/runbooks/", json={**self._payload, "name": "RB2"})
        assert r1.json()["id"] != r2.json()["id"]

    def test_create_runbook_appears_in_list(self, authed):
        authed.post("/api/v1/runbooks/", json=self._payload)
        resp = authed.get("/api/v1/runbooks/")
        assert len(resp.json()) == 1
        assert resp.json()[0]["name"] == "Deploy App"

    def test_create_multiple_runbooks_all_listed(self, authed):
        authed.post("/api/v1/runbooks/", json={**self._payload, "name": "A"})
        authed.post("/api/v1/runbooks/", json={**self._payload, "name": "B"})
        authed.post("/api/v1/runbooks/", json={**self._payload, "name": "C"})
        resp = authed.get("/api/v1/runbooks/")
        assert len(resp.json()) == 3

    def test_delete_runbook(self, authed):
        rb_id = authed.post("/api/v1/runbooks/", json=self._payload).json()["id"]
        del_resp = authed.delete(f"/api/v1/runbooks/{rb_id}")
        assert del_resp.status_code == 200
        # List should now be empty
        assert authed.get("/api/v1/runbooks/").json() == []

    def test_delete_nonexistent_runbook_returns_404(self, authed):
        resp = authed.delete("/api/v1/runbooks/999999")
        assert resp.status_code == 404

    def test_delete_only_removes_target(self, authed):
        id1 = authed.post("/api/v1/runbooks/", json={**self._payload, "name": "Keep"}).json()["id"]
        id2 = authed.post("/api/v1/runbooks/", json={**self._payload, "name": "Remove"}).json()["id"]
        authed.delete(f"/api/v1/runbooks/{id2}")
        remaining = authed.get("/api/v1/runbooks/").json()
        assert len(remaining) == 1
        assert remaining[0]["id"] == id1


# ── Validation edge cases ────────────────────────────────────────────────────

class TestRunbookValidation:
    def test_create_requires_name(self, authed):
        resp = authed.post("/api/v1/runbooks/", json={"steps": []})
        assert resp.status_code == 422

    def test_create_empty_steps_ok(self, authed):
        """A runbook with no steps is valid."""
        resp = authed.post("/api/v1/runbooks/", json={"name": "Empty Runbook", "steps": []})
        assert resp.status_code in (200, 201)
        assert resp.json()["steps"] == []

    def test_create_runbook_no_description_defaults_empty(self, authed):
        resp = authed.post("/api/v1/runbooks/", json={"name": "No Desc"})
        assert resp.status_code in (200, 201)
        assert resp.json()["description"] == ""

    def test_create_runbook_step_no_description_defaults_empty(self, authed):
        resp = authed.post("/api/v1/runbooks/", json={
            "name": "Test",
            "steps": [{"command": "ls"}],
        })
        assert resp.status_code in (200, 201)
        assert resp.json()["steps"][0]["description"] == ""

    def test_step_missing_command_returns_422(self, authed):
        resp = authed.post("/api/v1/runbooks/", json={
            "name": "Bad Step",
            "steps": [{"description": "No command here"}],
        })
        assert resp.status_code == 422


# ── Execute endpoint ──────────────────────────────────────────────────────────

class TestRunbookExecute:
    def test_execute_nonexistent_runbook_returns_404(self, authed):
        resp = authed.post("/api/v1/runbooks/999999/execute")
        assert resp.status_code == 404

    def test_execute_without_vm_id(self, authed):
        """Execute without a VM ID — backend should return 4xx (no VM) or accept it."""
        rb_id = authed.post("/api/v1/runbooks/", json={
            "name": "Test Run",
            "steps": [{"command": "echo hello"}],
        }).json()["id"]
        resp = authed.post(f"/api/v1/runbooks/{rb_id}/execute")
        # Acceptable: 400 (no VM), 404 (VM not found), 200 (queued), 500 (SSH not available)
        assert resp.status_code in (200, 400, 404, 422, 500)
        # Must never be an auth error
        assert resp.status_code not in (401, 403)
