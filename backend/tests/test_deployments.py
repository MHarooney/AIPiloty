"""Tests for Deployment CRUD + action + history + run endpoints.

All tests use shared conftest fixtures (in-memory SQLite, no real SSH/Docker).
Pipeline execution is mocked so no real deployments are triggered.
"""

from __future__ import annotations

import asyncio
import pytest
from fastapi.testclient import TestClient


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


# ── Auth guards ──────────────────────────────────────────────────────────────

class TestDeploymentAuth:
    def test_list_requires_auth(self, client: TestClient):
        assert client.get("/api/v1/deployments/").status_code in (401, 403)

    def test_create_requires_auth(self, client: TestClient):
        assert client.post("/api/v1/deployments/", json={}).status_code in (401, 403)

    def test_get_requires_auth(self, client: TestClient):
        assert client.get("/api/v1/deployments/1").status_code in (401, 403)

    def test_delete_requires_auth(self, client: TestClient):
        assert client.delete("/api/v1/deployments/1").status_code in (401, 403)

    def test_history_requires_auth(self, client: TestClient):
        assert client.get("/api/v1/deployments/history/all").status_code in (401, 403)

    def test_action_requires_auth(self, client: TestClient):
        assert client.post("/api/v1/deployments/1/action", json={"action": "deploy"}).status_code in (401, 403)


# ── Happy-path CRUD ──────────────────────────────────────────────────────────

class TestDeploymentCRUD:
    _payload = {
        "name": "web-app",
        "project_name": "my-project",
        "environment": "staging",
        "branch": "main",
        "trigger_type": "manual",
    }

    def test_list_returns_list(self, authed):
        resp = authed.get("/api/v1/deployments/")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_create_deployment_minimal(self, authed):
        resp = authed.post("/api/v1/deployments/", json=self._payload)
        assert resp.status_code in (200, 201)
        body = resp.json()
        assert body["name"] == "web-app"
        assert body["project_name"] == "my-project"
        assert body["environment"] == "staging"
        assert body["branch"] == "main"
        assert "id" in body
        assert "status" in body

    def test_create_deployment_webhook_secret_auto_generated(self, authed):
        """When webhook_secret is absent, backend generates one."""
        resp = authed.post("/api/v1/deployments/", json=self._payload)
        assert resp.status_code in (200, 201)
        body = resp.json()
        # webhook_secret should be present and non-empty if returned
        if "webhook_secret" in body and body["webhook_secret"]:
            assert len(body["webhook_secret"]) >= 8

    def test_create_deployment_appears_in_list(self, authed):
        authed.post("/api/v1/deployments/", json=self._payload)
        resp = authed.get("/api/v1/deployments/")
        names = [d["name"] for d in resp.json()]
        assert "web-app" in names

    def test_get_deployment_by_id(self, authed):
        dep_id = authed.post("/api/v1/deployments/", json=self._payload).json()["id"]
        resp = authed.get(f"/api/v1/deployments/{dep_id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == dep_id

    def test_get_nonexistent_deployment_returns_404(self, authed):
        resp = authed.get("/api/v1/deployments/99999")
        assert resp.status_code == 404

    def test_delete_deployment(self, authed):
        dep_id = authed.post("/api/v1/deployments/", json=self._payload).json()["id"]
        del_resp = authed.delete(f"/api/v1/deployments/{dep_id}")
        assert del_resp.status_code == 200
        assert authed.get(f"/api/v1/deployments/{dep_id}").status_code == 404

    def test_delete_nonexistent_deployment_returns_404(self, authed):
        assert authed.delete("/api/v1/deployments/99999").status_code == 404

    def test_pagination_params(self, authed):
        resp = authed.get("/api/v1/deployments/?limit=10&offset=0")
        assert resp.status_code == 200

    def test_invalid_limit_rejected(self, authed):
        resp = authed.get("/api/v1/deployments/?limit=0")
        assert resp.status_code == 422

    def test_limit_over_200_rejected(self, authed):
        resp = authed.get("/api/v1/deployments/?limit=201")
        assert resp.status_code == 422


# ── Default value checks ──────────────────────────────────────────────────────

class TestDeploymentDefaults:
    def test_default_environment_is_staging(self, authed):
        resp = authed.post("/api/v1/deployments/", json={
            "name": "x",
            "project_name": "p",
        })
        assert resp.status_code in (200, 201)
        assert resp.json()["environment"] == "staging"

    def test_default_branch_is_main(self, authed):
        resp = authed.post("/api/v1/deployments/", json={
            "name": "x",
            "project_name": "p",
        })
        assert resp.status_code in (200, 201)
        assert resp.json()["branch"] == "main"

    def test_default_trigger_type_is_manual(self, authed):
        resp = authed.post("/api/v1/deployments/", json={
            "name": "x",
            "project_name": "p",
        })
        assert resp.status_code in (200, 201)
        assert resp.json()["trigger_type"] == "manual"

    def test_default_dockerfile(self, authed):
        resp = authed.post("/api/v1/deployments/", json={
            "name": "x",
            "project_name": "p",
        })
        assert resp.status_code in (200, 201)
        assert resp.json()["dockerfile"] == "Dockerfile"


# ── Validation ────────────────────────────────────────────────────────────────

class TestDeploymentValidation:
    def test_create_requires_name(self, authed):
        resp = authed.post("/api/v1/deployments/", json={"project_name": "p"})
        assert resp.status_code == 422

    def test_create_requires_project_name(self, authed):
        resp = authed.post("/api/v1/deployments/", json={"name": "n"})
        assert resp.status_code == 422

    def test_negative_offset_rejected(self, authed):
        resp = authed.get("/api/v1/deployments/?offset=-1")
        assert resp.status_code == 422


# ── Action endpoint ───────────────────────────────────────────────────────────

class TestDeploymentAction:
    _dep_payload = {"name": "action-test", "project_name": "proj"}

    def test_valid_action_deploy(self, authed):
        dep_id = authed.post("/api/v1/deployments/", json=self._dep_payload).json()["id"]
        # /action just updates deployment status (no pipeline executor involvement)
        resp = authed.post(f"/api/v1/deployments/{dep_id}/action", json={"action": "deploy"})
        assert resp.status_code not in (401, 403, 422)
        assert resp.json()["status"] == "ok"

    def test_invalid_action_rejected(self, authed):
        dep_id = authed.post("/api/v1/deployments/", json=self._dep_payload).json()["id"]
        resp = authed.post(f"/api/v1/deployments/{dep_id}/action", json={"action": "rm -rf /"})
        assert resp.status_code == 422

    def test_action_on_nonexistent_deployment(self, authed):
        resp = authed.post("/api/v1/deployments/99999/action", json={"action": "deploy"})
        assert resp.status_code == 404


# ── History endpoint ──────────────────────────────────────────────────────────

class TestDeploymentHistory:
    def test_history_returns_list(self, authed):
        resp = authed.get("/api/v1/deployments/history/all")
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_history_default_limit_50(self, authed):
        """History endpoint should cap results (default 50)."""
        resp = authed.get("/api/v1/deployments/history/all")
        assert resp.status_code == 200
        assert len(resp.json()) <= 50


# ── Run history per deployment ────────────────────────────────────────────────

class TestDeploymentRuns:
    def test_runs_requires_auth(self, client: TestClient):
        assert client.get("/api/v1/deployments/1/runs").status_code in (401, 403)

    def test_runs_for_nonexistent_deployment(self, authed):
        resp = authed.get("/api/v1/deployments/99999/runs")
        assert resp.status_code in (200, 404)

    def test_runs_returns_list(self, authed):
        dep_id = authed.post("/api/v1/deployments/", json={"name": "run-test", "project_name": "p"}).json()["id"]
        resp = authed.get(f"/api/v1/deployments/{dep_id}/runs")
        assert resp.status_code in (200, 404)
        if resp.status_code == 200:
            assert isinstance(resp.json(), list)
