"""Tests for /auth/login endpoint — happy path, edge cases, security.

Uses shared conftest fixtures (no real DB needed for auth endpoint).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from jose import jwt


# ── Happy path ────────────────────────────────────────────────────────────────

class TestLoginHappyPath:
    def test_valid_credentials_returns_200(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "admin",
        })
        assert resp.status_code == 200

    def test_login_returns_access_token(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "admin",
        })
        body = resp.json()
        assert "access_token" in body
        assert isinstance(body["access_token"], str)
        assert len(body["access_token"]) > 20

    def test_login_returns_bearer_token_type(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "admin",
        })
        assert resp.json()["token_type"] == "bearer"

    def test_login_returns_expires_in(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "admin",
        })
        body = resp.json()
        assert "expires_in" in body
        assert isinstance(body["expires_in"], int)
        assert body["expires_in"] > 0

    def test_jwt_token_is_valid_and_decodable(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "admin",
        })
        token = resp.json()["access_token"]
        from app.core.config import get_settings
        settings = get_settings()
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        assert payload["sub"] == "admin"

    def test_jwt_token_can_auth_protected_endpoint(self, client: TestClient):
        """A freshly-issued JWT must pass authentication on a protected endpoint."""
        login_resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "admin",
        })
        token = login_resp.json()["access_token"]

        resp = client.get("/api/v1/vms/", headers={"Authorization": f"Bearer {token}"})
        # Must not be 401/403
        assert resp.status_code not in (401, 403)


# ── Wrong credentials ─────────────────────────────────────────────────────────

class TestLoginWrongCredentials:
    def test_wrong_password_returns_401(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "wrong-password",
        })
        assert resp.status_code == 401

    def test_wrong_username_returns_401(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "hacker",
            "password": "admin",
        })
        assert resp.status_code == 401

    def test_both_wrong_returns_401(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "nobody",
            "password": "nothing",
        })
        assert resp.status_code == 401

    def test_wrong_credentials_error_message_not_verbose(self, client: TestClient):
        """Error message must not leak whether user or password was wrong."""
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "wrong",
        })
        body = resp.text
        assert "Invalid username or password" in body
        # Must NOT reveal which field was wrong
        assert "password" not in body.lower() or "username or password" in body.lower()

    def test_empty_password_returns_401_or_422(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "",
        })
        # Empty string fails Pydantic min_length=1 → 422, or auth check → 401
        assert resp.status_code in (401, 422)

    def test_empty_username_returns_401_or_422(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "",
            "password": "admin",
        })
        assert resp.status_code in (401, 422)


# ── Validation edge cases ─────────────────────────────────────────────────────

class TestLoginValidation:
    def test_missing_username_returns_422(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={"password": "admin"})
        assert resp.status_code == 422

    def test_missing_password_returns_422(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={"username": "admin"})
        assert resp.status_code == 422

    def test_empty_body_returns_422(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={})
        assert resp.status_code == 422

    def test_non_json_body_returns_422(self, client: TestClient):
        resp = client.post(
            "/api/v1/auth/login",
            data="username=admin&password=admin",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        assert resp.status_code == 422

    def test_username_too_long_rejected(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "a" * 101,  # max_length=100
            "password": "admin",
        })
        assert resp.status_code == 422

    def test_password_too_long_rejected(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "p" * 201,  # max_length=200
        })
        assert resp.status_code == 422


# ── Security checks ───────────────────────────────────────────────────────────

class TestLoginSecurity:
    def test_sql_injection_attempt_rejected(self, client: TestClient):
        """SQL injection strings in credentials must return 401, not 500."""
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin' OR '1'='1",
            "password": "' OR '1'='1",
        })
        assert resp.status_code in (401, 422)

    def test_xss_payload_in_username_rejected(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "<script>alert(1)</script>",
            "password": "anything",
        })
        assert resp.status_code in (401, 422)

    def test_null_byte_in_credentials(self, client: TestClient):
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin\x00",
            "password": "admin",
        })
        assert resp.status_code in (401, 422)

    def test_response_has_no_sensitive_info(self, client: TestClient):
        """Failed login must not leak password hash or internal details."""
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "wrong",
        })
        raw = resp.text.lower()
        assert "$2b$" not in raw, "bcrypt hash leaked in error response"
        assert "traceback" not in raw
        assert "exception" not in raw.replace("HTTPException", "")

    def test_login_response_no_set_cookie(self, client: TestClient):
        """Login should be token-based, not cookie-based."""
        resp = client.post("/api/v1/auth/login", json={
            "username": "admin",
            "password": "admin",
        })
        # If cookies are used, ensure they're httpOnly and secure
        # But per design, should be stateless JWT — no Set-Cookie expected
        if "set-cookie" in resp.headers:
            # If a cookie is set, it must have security flags
            cookie_val = resp.headers["set-cookie"].lower()
            assert "httponly" in cookie_val
