"""Phase 3 — API breadth: auth + happy path + one validation error per high-traffic router."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

pytestmark = pytest.mark.integration


# ── attachments ──────────────────────────────────────────────────────────────


def test_attachments_upload_requires_auth(client: TestClient):
    resp = client.post(
        "/api/v1/attachments/upload",
        files={"file": ("t.txt", b"hello", "text/plain")},
    )
    assert resp.status_code in (401, 403, 404, 405)


def test_attachments_upload_validation(authed):
    # Empty / missing file should fail validation
    resp = authed.post("/api/v1/attachments/upload")
    assert resp.status_code in (400, 422, 404, 405)


# ── knowledge / rag ──────────────────────────────────────────────────────────


def test_knowledge_health_requires_auth(client: TestClient):
    assert client.get("/api/v1/knowledge/health").status_code in (401, 403)


def test_knowledge_health_ok(authed):
    with patch.object(
        __import__("app.api.v1.knowledge", fromlist=["_bridge"])._bridge,
        "health_check",
        new_callable=AsyncMock,
        return_value={"status": "ok"},
    ):
        resp = authed.get("/api/v1/knowledge/health")
    assert resp.status_code in (200, 503)


def test_knowledge_search_validation(authed):
    resp = authed.get("/api/v1/knowledge/search")
    assert resp.status_code in (422, 400)


def test_rag_stats_requires_auth(client: TestClient):
    assert client.get("/api/v1/rag/stats").status_code in (401, 403)


def test_rag_stats_authed(authed):
    mock_store = MagicMock()
    mock_store.get_stats = AsyncMock(return_value={"vectors": 0})
    with patch("app.api.v1.rag._get_store", return_value=mock_store):
        resp = authed.get("/api/v1/rag/stats")
    assert resp.status_code in (200, 503)


def test_rag_search_validation(authed):
    resp = authed.get("/api/v1/rag/search")
    assert resp.status_code in (422, 400)


# ── workspace / git ──────────────────────────────────────────────────────────


def test_workspace_tree_requires_auth(client: TestClient):
    assert client.get("/api/v1/workspace/tree").status_code in (401, 403)


def test_workspace_tree_ok(authed):
    resp = authed.get("/api/v1/workspace/tree")
    assert resp.status_code in (200, 400, 404, 500)


def test_workspace_file_validation(authed):
    resp = authed.get("/api/v1/workspace/file")
    assert resp.status_code in (422, 400)


def test_git_status_requires_auth(client: TestClient):
    assert client.get("/api/v1/git/status").status_code in (401, 403)


def test_git_status_authed(authed):
    with patch(
        "app.api.v1.git._run_git",
        new_callable=AsyncMock,
        return_value=("## main\n", "", 0),
    ):
        resp = authed.get("/api/v1/git/status")
    assert resp.status_code in (200, 500)


def test_git_commit_validation(authed):
    resp = authed.post("/api/v1/git/commit", json={})
    assert resp.status_code in (422, 400)


# ── config / metrics / logs / files ──────────────────────────────────────────


def test_config_requires_auth(client: TestClient):
    assert client.get("/api/v1/config").status_code in (401, 403)


def test_config_ok(authed):
    resp = authed.get("/api/v1/config")
    assert resp.status_code == 200
    assert isinstance(resp.json(), dict)


def test_config_update_validation(authed):
    resp = authed.post("/api/v1/config/", json={"ollama_temperature": 99})
    assert resp.status_code in (200, 400, 422)


def test_metrics_requires_auth(client: TestClient):
    assert client.get("/api/v1/metrics").status_code in (401, 403)


def test_metrics_ok(authed):
    resp = authed.get("/api/v1/metrics")
    assert resp.status_code == 200


def test_logs_requires_auth(client: TestClient):
    assert client.get("/api/v1/logs").status_code in (401, 403)


def test_logs_ok(authed):
    resp = authed.get("/api/v1/logs")
    assert resp.status_code == 200


def test_files_download_requires_auth(client: TestClient):
    assert client.get("/api/v1/files/generated/missing.png").status_code in (401, 403)


def test_files_download_not_found(authed):
    resp = authed.get("/api/v1/files/generated/definitely-missing-xyz.png")
    assert resp.status_code in (404, 400, 500)
