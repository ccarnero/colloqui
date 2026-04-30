"""API Key authentication middleware for FastAPI."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from src.utils.config.settings import bootstrap_settings


class ApiKeyAuthMiddleware(BaseHTTPMiddleware):
    """Middleware that validates API key from X-API-Key header."""

    EXEMPT_PATHS = frozenset(
        [
            "/health",
            "/metrics",
            "/docs",
            "/logs",
            "/logs/access",
            "/memories",
            "/openapi.json",
            "/redoc",
        ]
    )

    def __init__(self, app, api_key: str | None = None):
        super().__init__(app)
        self.api_key = api_key or bootstrap_settings.RUNTIME_API_KEY

    async def dispatch(self, request: Request, call_next):
        if self._is_exempt(request):
            return await call_next(request)

        if not self.api_key:
            return await call_next(request)

        provided_key = request.headers.get("X-API-Key", "")
        if not provided_key:
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing X-API-Key header"},
            )

        if not self._validate_key(provided_key):
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid API key"},
            )

        return await call_next(request)

    def _is_exempt(self, request: Request) -> bool:
        path = request.url.path
        if path in self.EXEMPT_PATHS:
            return True
        if path.startswith("/memories"):
            return True
        if path.startswith("/ai/assist/stream"):
            return True
        return False

    def _validate_key(self, provided_key: str) -> bool:
        import hmac

        return hmac.compare_digest(provided_key, self.api_key)
