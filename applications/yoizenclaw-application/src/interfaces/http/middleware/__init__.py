"""HTTP middleware for YoizenClaw.

Provides middleware for authentication, rate limiting, telemetry,
and correlation ID management.
"""

from src.interfaces.http.middleware.auth import ApiKeyAuthMiddleware
from src.interfaces.http.middleware.rate_limit import RateLimitMiddleware
from src.interfaces.http.middleware.telemetry import (
    TelemetryMiddleware,
    add_telemetry_middleware,
)
from src.interfaces.http.middleware.correlation import (
    CorrelationIdMiddleware,
    add_correlation_middleware,
    get_correlation_id,
    get_trace_id_from_request,
    add_correlation_context_to_logs,
)

__all__ = [
    # Auth
    "ApiKeyAuthMiddleware",
    # Rate Limiting
    "RateLimitMiddleware",
    # Telemetry
    "TelemetryMiddleware",
    "add_telemetry_middleware",
    # Correlation
    "CorrelationIdMiddleware",
    "add_correlation_middleware",
    "get_correlation_id",
    "get_trace_id_from_request",
    "add_correlation_context_to_logs",
]
