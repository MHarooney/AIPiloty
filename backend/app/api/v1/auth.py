"""Authentication endpoints — lightweight single-user JWT login."""

from __future__ import annotations

from pydantic import BaseModel, Field
from fastapi import APIRouter, HTTPException, status
from passlib.context import CryptContext

from ...core.auth import create_access_token
from ...core.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")

# In-memory admin credentials — set via env or defaults for dev.
# Password is hashed on first boot if provided as plaintext via ADMIN_PASSWORD env.
_admin_username: str = "admin"
_admin_password_hash: str | None = None


def _get_admin_hash() -> str:
    global _admin_password_hash
    if _admin_password_hash is None:
        import os
        raw = os.getenv("ADMIN_PASSWORD", "admin")
        _admin_password_hash = _pwd.hash(raw)
    return _admin_password_hash


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=200)


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


@router.post("/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    """Authenticate with username/password and receive a JWT."""
    settings = get_settings()

    if body.username != _admin_username or not _pwd.verify(body.password, _get_admin_hash()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    token = create_access_token(subject=body.username)
    return LoginResponse(
        access_token=token,
        token_type="bearer",
        expires_in=settings.jwt_expire_minutes * 60,
    )


@router.get("/me")
async def me():
    """Public endpoint to check if auth is configured."""
    return {"auth_enabled": True, "username": _admin_username}
