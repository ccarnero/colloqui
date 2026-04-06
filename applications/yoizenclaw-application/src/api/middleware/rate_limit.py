"""Rate limiting middleware for FastAPI."""

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


@dataclass
class RateLimitConfig:
    """Configuration for a rate limit."""

    requests_per_minute: int


class InMemoryRateLimiter:
    """Simple in-memory rate limiter using sliding window."""

    def __init__(self):
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def is_allowed(self, key: str, rpm: int) -> bool:
        now = time.time()
        window_start = now - 60

        async with self._lock:
            self._windows[key] = [
                ts for ts in self._windows[key] if ts > window_start
            ]

            if len(self._windows[key]) >= rpm:
                return False

            self._windows[key].append(now)
            return True


RATE_LIMITS = {
    "/ai/assist/stream": RateLimitConfig(requests_per_minute=5),
}


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Middleware that enforces rate limits on specific endpoints."""

    def __init__(self, app):
        super().__init__(app)
        self.limiter = InMemoryRateLimiter()

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        method = request.method

        limit_config = self._get_limit_config(path, method)
        if limit_config is None:
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        rate_key = f"{client_ip}:{method}:{path}"

        allowed = await self.limiter.is_allowed(
            rate_key, limit_config.requests_per_minute
        )

        if not allowed:
            return JSONResponse(
                status_code=429,
                content={
                    "detail": f"Rate limit exceeded. Max {limit_config.requests_per_minute} requests per minute.",
                    "retry_after": 60,
                },
            )

        return await call_next(request)

    def _get_limit_config(self, path: str, method: str) -> RateLimitConfig | None:
        if path.startswith("/ai/assist/stream"):
            return RATE_LIMITS.get("/ai/assist/stream")
        return None
