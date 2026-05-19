"""Body size limit middleware — reject oversized request bodies before parsing.

Prevents OOM attacks from clients sending multi-GB payloads.  The limit is
configurable via the ``MAX_REQUEST_BODY_MB`` environment variable (default 50 MB).
Upload endpoints that legitimately accept large files should be excluded from
the limit via ``_EXEMPT_PREFIXES``.
"""

from __future__ import annotations

import os

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# Endpoints that handle their own streaming/multipart uploads — exempt from
# the global limit (they apply their own per-field limits).
_EXEMPT_PREFIXES = ("/api/v1/attachments", "/api/v1/knowledge/upload", "/api/v1/rag/ingest")

_MAX_BYTES: int = int(os.environ.get("MAX_REQUEST_BODY_MB", "50")) * 1024 * 1024


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests whose Content-Length exceeds the configured limit."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        # Skip exempt upload endpoints
        path = request.url.path
        if any(path.startswith(p) for p in _EXEMPT_PREFIXES):
            return await call_next(request)

        content_length = request.headers.get("content-length")
        if content_length:
            try:
                if int(content_length) > _MAX_BYTES:
                    return JSONResponse(
                        {"detail": f"Request body too large. Maximum size is {_MAX_BYTES // (1024*1024)} MB."},
                        status_code=413,
                    )
            except ValueError:
                pass  # malformed header — let the body parser handle it

        return await call_next(request)
