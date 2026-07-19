"""
Rate-limiting middleware using a simple in-memory sliding window counter.
Limits are per client IP. Defaults to 120 requests/minute for general endpoints
and 10 requests/minute for expensive endpoints (chat, image generation).

X-Forwarded-For handling: only the rightmost ``TRUSTED_PROXY_COUNT`` hops are
stripped (matching the number of reverse-proxy hops in front of the app).
This prevents clients from spoofing their IP by injecting arbitrary values at
the left of the X-Forwarded-For chain.
"""

import os
import time
from collections import defaultdict
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

# Paths that get a tighter rate limit
_EXPENSIVE_PREFIXES = ("/api/v1/chat", "/api/v1/images/generate")

# Default: 120 req/min; Expensive: 20 req/min
DEFAULT_LIMIT = 120
EXPENSIVE_LIMIT = 20
WINDOW_SECONDS = 60

# How many trusted reverse-proxy hops sit in front of this service.
# Set TRUSTED_PROXY_COUNT=1 when behind a single nginx; 2 if behind nginx + load balancer.
# Defaults to 1 (the nginx in docker-compose).
_TRUSTED_PROXY_COUNT: int = int(os.environ.get("TRUSTED_PROXY_COUNT", "1"))


class _SlidingWindow:
    """Thread-safe sliding-window counter (single-process only)."""

    __slots__ = ("_timestamps",)

    def __init__(self) -> None:
        self._timestamps: list[float] = []

    def hit(self, now: float, window: float = WINDOW_SECONDS) -> int:
        """Record a hit and return the count of hits within the window."""
        cutoff = now - window
        # Prune old entries
        self._timestamps = [t for t in self._timestamps if t > cutoff]
        self._timestamps.append(now)
        return len(self._timestamps)


# ip -> path_category -> window
_buckets: dict[str, dict[str, _SlidingWindow]] = defaultdict(
    lambda: defaultdict(_SlidingWindow)
)


def _client_ip(request: Request) -> str:
    """Extract the real client IP honoring a fixed number of trusted proxy hops.

    Rather than blindly trusting the leftmost value of X-Forwarded-For
    (which any client can forge), we take the Nth-from-right value where
    N equals TRUSTED_PROXY_COUNT. This matches the number of genuine proxy
    hops that prepend to the header and is immune to client-side spoofing.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded and _TRUSTED_PROXY_COUNT > 0:
        # X-Forwarded-For: client, proxy1, proxy2
        # With 1 trusted proxy, the rightmost entry is the proxy and the
        # entry just before it is the real client IP.
        hops = [h.strip() for h in forwarded.split(",")]
        # The real client is at index -(TRUSTED_PROXY_COUNT + 1), clamped to 0.
        idx = max(0, len(hops) - _TRUSTED_PROXY_COUNT - 1)
        candidate = hops[idx]
        if candidate:
            return candidate
    return request.client.host if request.client else "unknown"


def _is_expensive(path: str) -> bool:
    return any(path.startswith(p) for p in _EXPENSIVE_PREFIXES)


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Skip health endpoint and entire limiter under automated tests
        if request.url.path in ("/api/v1/health", "/health"):
            return await call_next(request)
        if os.environ.get("TESTING") == "1":
            response = await call_next(request)
            response.headers["X-RateLimit-Limit"] = "unlimited"
            response.headers["X-RateLimit-Remaining"] = "unlimited"
            return response

        ip = _client_ip(request)
        expensive = _is_expensive(request.url.path)
        category = "expensive" if expensive else "default"
        limit = EXPENSIVE_LIMIT if expensive else DEFAULT_LIMIT

        now = time.monotonic()
        count = _buckets[ip][category].hit(now)

        if count > limit:
            retry_after = WINDOW_SECONDS
            return JSONResponse(
                status_code=429,
                content={
                    "detail": f"Rate limit exceeded. Max {limit} requests per {WINDOW_SECONDS}s.",
                    "retry_after": retry_after,
                },
                headers={"Retry-After": str(retry_after)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(max(0, limit - count))
        return response
