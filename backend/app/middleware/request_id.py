"""Request-ID middleware — attaches a unique trace ID to every request and response.

Every inbound request receives a UUID4 ``X-Request-ID`` header.  If the client
already supplies one (forwarded from a load-balancer or browser), that value is
preserved as long as it is a valid UUID4 (to prevent header injection attacks).
The ID is echoed back in the response and stored as a ``logging.LogRecord``
extra so every log line emitted during a request automatically includes it.
"""

from __future__ import annotations

import logging
import re
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

# Context variable so other parts of the app can read the current request ID
# without threading it through function arguments.
request_id_ctx: ContextVar[str] = ContextVar("request_id", default="")

logger = logging.getLogger(__name__)


def _new_request_id() -> str:
    return str(uuid.uuid4())


def _is_valid_request_id(value: str) -> bool:
    return bool(_UUID4_RE.match(value))


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Attach a UUID4 X-Request-ID to every request and response."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        incoming = request.headers.get("x-request-id", "")
        # Accept client-supplied ID only if it is a valid UUID4 (prevents injection)
        req_id = incoming if _is_valid_request_id(incoming) else _new_request_id()

        # Make it available to the entire async call chain
        token = request_id_ctx.set(req_id)
        try:
            response = await call_next(request)
        finally:
            request_id_ctx.reset(token)

        response.headers["X-Request-ID"] = req_id
        return response
