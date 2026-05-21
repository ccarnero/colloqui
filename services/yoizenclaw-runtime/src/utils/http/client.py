"""HTTP client with OpenTelemetry instrumentation.

Provides an instrumented HTTP client that automatically:
- Injects trace context into outgoing request headers
- Creates spans for HTTP requests
- Records metrics for HTTP calls
"""

from __future__ import annotations

import logging
import time
from typing import Any, AsyncIterator
from contextlib import asynccontextmanager

import httpx
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from opentelemetry.semconv.trace import SpanAttributes

from src.utils.telemetry.propagator import inject_into_headers
from src.utils.telemetry.metrics import record_http_request, record_http_duration

logger = logging.getLogger(__name__)


class InstrumentedAsyncClient:
    """Async HTTP client with OpenTelemetry instrumentation.
    
    Automatically creates spans for each request and injects trace context
    into outgoing headers for distributed tracing.
    
    Example:
        >>> async with InstrumentedAsyncClient() as client:
        ...     response = await client.get("https://api.example.com/data")
    """

    def __init__(self, **kwargs: Any) -> None:
        """Initialize the instrumented HTTP client.
        
        Args:
            **kwargs: Additional arguments passed to httpx.AsyncClient.
        """
        self._client = httpx.AsyncClient(**kwargs)
        self._tracer = trace.get_tracer(__name__)

    async def request(
        self,
        method: str,
        url: str,
        **kwargs: Any,
    ) -> httpx.Response:
        """Make an HTTP request with instrumentation.
        
        Args:
            method: HTTP method (GET, POST, etc.).
            url: Request URL.
            **kwargs: Additional request arguments.
            
        Returns:
            HTTP response.
        """
        # Inject trace context into headers
        headers = dict(kwargs.get("headers", {}))
        inject_into_headers(headers)
        kwargs["headers"] = headers

        span_name = f"HTTP {method}"
        start_time = time.perf_counter()

        with self._tracer.start_as_current_span(span_name) as span:
            span.set_attribute(SpanAttributes.HTTP_METHOD, method)
            span.set_attribute(SpanAttributes.HTTP_URL, url)
            
            try:
                response = await self._client.request(method, url, **kwargs)
                
                duration = time.perf_counter() - start_time
                status_code = response.status_code
                
                # Set span attributes
                span.set_attribute(SpanAttributes.HTTP_STATUS_CODE, status_code)
                span.set_attribute("http.response_content_length", len(response.content))
                
                # Set span status
                if status_code < 400:
                    span.set_status(Status(StatusCode.OK))
                elif status_code < 500:
                    span.set_status(Status(StatusCode.UNSET))
                else:
                    span.set_status(
                        Status(StatusCode.ERROR, f"HTTP {status_code}"),
                    )
                
                # Record metrics
                record_http_request(method, url, status_code)
                record_http_duration(duration, method, url)
                span.set_attribute("http.request.duration_ms", duration * 1000)
                
                return response
                
            except Exception as e:
                duration = time.perf_counter() - start_time
                span.record_exception(e)
                span.set_status(Status(StatusCode.ERROR, str(e)))
                record_http_duration(duration, method, url)
                raise

    async def get(self, url: str, **kwargs: Any) -> httpx.Response:
        """Make a GET request."""
        return await self.request("GET", url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> httpx.Response:
        """Make a POST request."""
        return await self.request("POST", url, **kwargs)

    async def put(self, url: str, **kwargs: Any) -> httpx.Response:
        """Make a PUT request."""
        return await self.request("PUT", url, **kwargs)

    async def patch(self, url: str, **kwargs: Any) -> httpx.Response:
        """Make a PATCH request."""
        return await self.request("PATCH", url, **kwargs)

    async def delete(self, url: str, **kwargs: Any) -> httpx.Response:
        """Make a DELETE request."""
        return await self.request("DELETE", url, **kwargs)

    async def head(self, url: str, **kwargs: Any) -> httpx.Response:
        """Make a HEAD request."""
        return await self.request("HEAD", url, **kwargs)

    async def options(self, url: str, **kwargs: Any) -> httpx.Response:
        """Make an OPTIONS request."""
        return await self.request("OPTIONS", url, **kwargs)

    async def __aenter__(self) -> "InstrumentedAsyncClient":
        """Async context manager entry."""
        return self

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        """Async context manager exit."""
        await self._client.aclose()


@asynccontextmanager
async def instrumented_http_client(**kwargs: Any) -> AsyncIterator[InstrumentedAsyncClient]:
    """Context manager for instrumented HTTP client.
    
    Args:
        **kwargs: Arguments passed to InstrumentedAsyncClient.
        
    Yields:
        InstrumentedAsyncClient instance.
        
    Example:
        >>> async with instrumented_http_client() as client:
        ...     response = await client.get("https://api.example.com")
    """
    client = InstrumentedAsyncClient(**kwargs)
    try:
        yield client
    finally:
        await client._client.aclose()


async def make_instrumented_request(
    method: str,
    url: str,
    **kwargs: Any,
) -> httpx.Response:
    """Make a single instrumented HTTP request.
    
    Convenience function for one-off requests. Creates a temporary client
    that is closed after the request.
    
    Args:
        method: HTTP method.
        url: Request URL.
        **kwargs: Additional request arguments.
        
    Returns:
        HTTP response.
    """
    async with instrumented_http_client() as client:
        return await client.request(method, url, **kwargs)
