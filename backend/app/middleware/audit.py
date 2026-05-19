"""Audit middleware — logs key API mutations to the audit_logs table."""

from __future__ import annotations

import json
import logging
import time
from typing import Optional, Set

from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from ..core.database import async_session_factory
from ..models.audit_log import AuditLog

logger = logging.getLogger(__name__)

# Methods to audit (mutations only)
_AUDIT_METHODS: Set[str] = {"POST", "PUT", "PATCH", "DELETE"}

# Paths to skip (noisy / health)
_SKIP_PREFIXES = (
    "/api/v1/health",
    "/api/v1/metrics",
    "/api/v1/logs",
    "/api/v1/audit-log",
    "/docs",
    "/openapi.json",
)


def _extract_verified_identity(request: Request) -> str:
    """Derive the caller identity from verified auth credentials only.

    Reads the same auth headers as ``require_auth`` so the identity in the
    audit log is always cryptographically verified — never from the
    spoofable ``X-User`` header.
    """
    from ..core.config import get_settings
    settings = get_settings()

    # 1. API-Key header
    api_key: Optional[str] = request.headers.get("x-api-key")
    if api_key and api_key == settings.api_key:
        return "api_key_user"

    # 2. JWT Bearer token
    auth_header: Optional[str] = request.headers.get("authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header[7:]
        try:
            payload = jwt.decode(
                token,
                settings.jwt_secret,
                algorithms=[settings.jwt_algorithm],
            )
            sub: Optional[str] = payload.get("sub")
            if sub:
                return sub
        except JWTError:
            pass

    return "unauthenticated"


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.method not in _AUDIT_METHODS:
            return await call_next(request)

        path = request.url.path
        if any(path.startswith(p) for p in _SKIP_PREFIXES):
            return await call_next(request)

        start = time.time()
        response = await call_next(request)
        duration_ms = round((time.time() - start) * 1000)

        # Fire-and-forget audit write
        try:
            user = _extract_verified_identity(request)
            ip = request.client.host if request.client else "unknown"

            entry = AuditLog(
                action=f"{request.method} {path}",
                user=user,
                resource=path,
                details=json.dumps({
                    "status_code": response.status_code,
                    "duration_ms": duration_ms,
                    "query": str(request.query_params) if request.query_params else None,
                }),
                ip_address=ip,
            )

            async with async_session_factory() as session:
                session.add(entry)
                await session.commit()
        except Exception as exc:
            logger.warning("Audit log write failed: %s", exc)

        return response
