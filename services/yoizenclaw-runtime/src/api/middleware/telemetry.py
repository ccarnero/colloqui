"""FastAPI middleware for OpenTelemetry integration.

Provides middleware that automatically creates spans for HTTP requests
and extracts W3C Trace Context from incoming requests.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from opentelemetry.semconv.trace import SpanAttributes

from src.utils.telemetry.propagator import extract_trace_context
from src.utils.telemetry.sanitizer import sanitize_headers

logger = logging.getLogger(__name__)


class TelemetryMiddleware(BaseHTTPMiddleware):
    """Middleware to create spans for HTTP requests with trace context extraction.
    
    Automatically:
    - Extracts W3C Trace Context from incoming request headers
    - Creates a span for the HTTP request
    - Records request/response attributes
    - Sets error status on 5xx responses
    """

    def __init__(self, app: ASGIApp) -> None:
        """Initialize the middleware.
        
        Args:
            app: The ASGI application.
        """
        super().__init__(app)
        self._tracer = trace.get_tracer(__name__)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process the request with telemetry.
        
        Args:
            request: The incoming HTTP request.
            call_next: The next middleware/endpoint to call.
            
        Returns:
            The HTTP response.
        """
        # Extract trace context from incoming headers
        headers = dict(request.headers)
        context = extract_trace_context(headers)

        # Create span name
        span_name = f"{request.method} {request.url.path}"

        with self._tracer.start_as_current_span(
            span_name,
            context=context,
            kind=trace.SpanKind.SERVER,
        ) as span:
            # Set span attributes
            span.set_attribute(SpanAttributes.HTTP_METHOD, request.method)
            span.set_attribute(SpanAttributes.HTTP_URL, str(request.url))
            span.set_attribute(SpanAttributes.HTTP_ROUTE, request.url.path)
            span.set_attribute(SpanAttributes.HTTP_TARGET, request.url.path)
            span.set_attribute(SpanAttributes.HTTP_SCHEME, request.url.scheme)
            span.set_attribute(SpanAttributes.HTTP_HOST, request.url.hostname)
            
            # Client info
            if request.client:
                span.set_attribute(
                    SpanAttributes.HTTP_CLIENT_IP,
                    request.client.host,
                )

            # Sanitized headers
            safe_headers = sanitize_headers(headers)
            for header_name, header_value in safe_headers.items():
                if header_value:
                    span.set_attribute(
                        f"http.request.header.{header_name}",
                        header_value,
                    )

            # Store request start time
            start_time = time.perf_counter()

            try:
                response = await call_next(request)
                
                # Record response info
                status_code = response.status_code
                span.set_attribute(SpanAttributes.HTTP_STATUS_CODE, status_code)
                
                # Set span status based on response
                if status_code < 400:
                    span.set_status(Status(StatusCode.OK))
                elif status_code < 500:
                    span.set_status(Status(StatusCode.UNSET))
                else:
                    span.set_status(
                        Status(StatusCode.ERROR, f"HTTP {status_code}"),
                    )

                # Response headers
                for header_name, header_value in response.headers.items():
                    span.set_attribute(
                        f"http.response.header.{header_name}",
                        header_value,
                    )

                return response

            except Exception as e:
                span.set_status(Status(StatusCode.ERROR, str(e)))
                span.record_exception(e)
                raise
            finally:
                # Record duration
                duration = time.perf_counter() - start_time
                span.set_attribute("http.request.duration_ms", duration * 1000)


def add_telemetry_middleware(app: Any) -> None:
    """Add telemetry middleware to a FastAPI application.
    
    This should be called after OTEL tracer initialization.
    
    Args:
        app: The FastAPI application instance.
    """
    app.add_middleware(TelemetryMiddleware)
    logger.info("Telemetry middleware added to FastAPI app")
