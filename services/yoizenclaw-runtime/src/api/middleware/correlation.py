"""Correlation ID middleware for request tracing.

Provides middleware that extracts or generates correlation IDs for request
tracing across services. The correlation ID is injected into the request state
and included in response headers.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from src.utils.telemetry.propagator import (
    get_current_trace_id,
    inject_into_headers,
)

logger = logging.getLogger(__name__)

# Header names
CORRELATION_ID_HEADER = "X-Correlation-Id"
REQUEST_ID_HEADER = "X-Request-Id"
TRACEPARENT_HEADER = "traceparent"


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Middleware to manage correlation IDs across requests.
    
    Automatically:
    - Extracts correlation ID from incoming request headers
    - Generates a new correlation ID if not present
    - Stores correlation ID in request state for access by handlers
    - Adds correlation ID to response headers
    - Injects trace context into response headers
    
    The correlation ID enables tracing a request across multiple services
    and correlating logs, traces, and metrics.
    """

    def __init__(
        self,
        app: ASGIApp,
        header_name: str = CORRELATION_ID_HEADER,
        generate_if_missing: bool = True,
    ) -> None:
        """Initialize the middleware.
        
        Args:
            app: The ASGI application.
            header_name: Header name for correlation ID.
            generate_if_missing: Whether to generate ID if not present.
        """
        super().__init__(app)
        self._header_name = header_name
        self._generate_if_missing = generate_if_missing

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process the request with correlation ID management.
        
        Args:
            request: The incoming HTTP request.
            call_next: The next middleware/endpoint to call.
            
        Returns:
            The HTTP response with correlation ID headers.
        """
        # Try to extract correlation ID from request headers
        correlation_id = self._extract_correlation_id(request)
        
        # Generate new ID if missing and enabled
        if correlation_id is None and self._generate_if_missing:
            correlation_id = self._generate_correlation_id()
            logger.debug(f"Generated new correlation ID: {correlation_id}")
        
        # Also try to get trace ID from OTEL context
        trace_id = get_current_trace_id()
        
        # Store in request state for access by handlers
        request.state.correlation_id = correlation_id
        request.state.trace_id = trace_id
        
        # Log the correlation context
        if correlation_id:
            logger.debug(
                "Request correlation context",
                extra={
                    "correlation_id": correlation_id,
                    "trace_id": trace_id,
                    "method": request.method,
                    "path": request.url.path,
                },
            )
        
        # Process the request
        response = await call_next(request)
        
        # Add correlation ID to response headers
        if correlation_id:
            response.headers[self._header_name] = correlation_id
        
        # Also add trace context to response if available
        if trace_id:
            response.headers["X-Trace-Id"] = trace_id

        # Inject full trace context (traceparent header)
        trace_headers: dict[str, str] = {}
        inject_into_headers(trace_headers)
        for key, value in trace_headers.items():
            if value:
                response.headers[key] = value

        return response

    def _extract_correlation_id(self, request: Request) -> str | None:
        """Extract correlation ID from request headers.
        
        Args:
            request: HTTP request.
            
        Returns:
            Correlation ID if found, None otherwise.
        """
        # Check primary header
        correlation_id = request.headers.get(self._header_name)
        if correlation_id:
            return correlation_id
        
        # Check alternative headers
        for header in [REQUEST_ID_HEADER, "X-Request-ID", "X-Correlation-ID"]:
            correlation_id = request.headers.get(header)
            if correlation_id:
                return correlation_id
        
        # Try to extract from traceparent as fallback
        traceparent = request.headers.get(TRACEPARENT_HEADER)
        if traceparent:
            # Extract trace ID from traceparent (format: 00-<trace_id>-<span_id>-<flags>)
            parts = traceparent.split("-")
            if len(parts) >= 2:
                return parts[1]
        
        return None

    @staticmethod
    def _generate_correlation_id() -> str:
        """Generate a new correlation ID.
        
        Returns:
            UUID string as correlation ID.
        """
        return str(uuid.uuid4())


def get_correlation_id(request: Request) -> str | None:
    """Get the correlation ID from a request.
    
    Args:
        request: HTTP request.
        
    Returns:
        Correlation ID if available, None otherwise.
        
    Example:
        >>> @app.get("/example")
        ... async def example(request: Request):
        ...     correlation_id = get_correlation_id(request)
        ...     return {"correlation_id": correlation_id}
    """
    return getattr(request.state, "correlation_id", None)


def get_trace_id_from_request(request: Request) -> str | None:
    """Get the trace ID from a request.
    
    Args:
        request: HTTP request.
        
    Returns:
        Trace ID if available, None otherwise.
    """
    return getattr(request.state, "trace_id", None)


def add_correlation_context_to_logs(
    request: Request,
    log_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Add correlation context to log extras.
    
    Args:
        request: HTTP request.
        log_extra: Existing log extras dictionary.
        
    Returns:
        Log extras with correlation context added.
    """
    extra = dict(log_extra) if log_extra else {}
    
    correlation_id = get_correlation_id(request)
    if correlation_id:
        extra["correlation_id"] = correlation_id
    
    trace_id = get_trace_id_from_request(request)
    if trace_id:
        extra["trace_id"] = trace_id
    
    return extra


def add_correlation_middleware(app: ASGIApp, **kwargs: Any) -> None:
    """Add correlation ID middleware to a FastAPI application.
    
    This should be called early in the middleware stack.
    
    Args:
        app: The FastAPI application instance.
        **kwargs: Additional arguments for CorrelationIdMiddleware.
    """
    app.add_middleware(CorrelationIdMiddleware, **kwargs)
    logger.info("Correlation ID middleware added to FastAPI app")
