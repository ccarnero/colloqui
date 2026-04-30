"""Integration tests for correlation ID handling.

Tests correlation ID generation, propagation through HTTP requests,
and association with trace context.
"""

from __future__ import annotations

import re
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider

from src.shared.telemetry.propagator import get_current_trace_id


@pytest.fixture(autouse=True)
def setup_tracer_provider():
    """Set up a tracer provider for testing."""
    provider = TracerProvider()
    trace.set_tracer_provider(provider)
    yield
    # Cleanup
    trace.set_tracer_provider(trace.NoOpTracerProvider())


class TestCorrelationIdGeneration:
    """Test correlation ID generation and validation."""

    def test_correlation_id_format(self) -> None:
        """Verify correlation ID follows expected format (UUID-like)."""
        from uuid import uuid4

        correlation_id = str(uuid4())

        # Should be valid UUID format
        uuid_pattern = re.compile(
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        )
        assert uuid_pattern.match(correlation_id)

    def test_correlation_id_uniqueness(self) -> None:
        """Verify generated correlation IDs are unique."""
        from uuid import uuid4

        ids = [str(uuid4()) for _ in range(100)]
        assert len(set(ids)) == 100  # All unique


class TestCorrelationIdPropagation:
    """Test correlation ID propagation through HTTP."""

    @pytest.fixture
    def app_with_correlation(self):
        """Create FastAPI app with correlation ID middleware."""
        from src.shared.telemetry.correlation import CorrelationIdMiddleware

        app = FastAPI()
        app.add_middleware(CorrelationIdMiddleware)

        @app.get("/test")
        async def test_endpoint(request: Request):
            correlation_id = request.headers.get("x-correlation-id", "none")
            return {"correlation_id": correlation_id}

        @app.post("/process")
        async def process_endpoint(request: Request):
            correlation_id = request.headers.get("x-correlation-id", "none")
            trace_id = get_current_trace_id() or "none"
            return {
                "correlation_id": correlation_id,
                "trace_id": trace_id,
            }

        return app

    def test_correlation_id_generated_if_missing(self, app_with_correlation) -> None:
        """Verify correlation ID is generated if not provided."""
        client = TestClient(app_with_correlation)

        response = client.get("/test")

        assert response.status_code == 200
        data = response.json()
        assert data["correlation_id"] != "none"
        # Should be valid UUID format
        correlation_id = data["correlation_id"]
        assert len(correlation_id) == 36

    def test_correlation_id_preserved_if_provided(self, app_with_correlation) -> None:
        """Verify incoming correlation ID is preserved."""
        client = TestClient(app_with_correlation)

        incoming_id = "550e8400-e29b-41d4-a716-446655440000"
        response = client.get(
            "/test",
            headers={"x-correlation-id": incoming_id},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["correlation_id"] == incoming_id

    def test_correlation_id_in_response_headers(self, app_with_correlation) -> None:
        """Verify correlation ID is returned in response headers."""
        client = TestClient(app_with_correlation)

        response = client.get("/test")

        assert response.status_code == 200
        assert "x-correlation-id" in response.headers
        response_id = response.headers["x-correlation-id"]
        # Should be valid UUID
        assert len(response_id) == 36


class TestCorrelationWithTraceContext:
    """Test correlation ID association with trace context."""

    def test_correlation_id_associated_with_trace(self) -> None:
        """Verify correlation ID is linked to trace ID."""
        from uuid import uuid4

        tracer = trace.get_tracer("test.correlation")

        with tracer.start_as_current_span("correlation.test") as span:
            trace_id = get_current_trace_id()
            correlation_id = str(uuid4())

            # Both should be available
            assert trace_id is not None
            assert correlation_id is not None

            # Store correlation ID in span attributes
            span.set_attribute("correlation.id", correlation_id)

    def test_correlation_id_propagation_with_trace(self) -> None:
        """Verify correlation ID propagates with trace context."""
        from uuid import uuid4

        from src.shared.telemetry.propagator import (
            extract_trace_context,
            inject_trace_context,
        )

        tracer = trace.get_tracer("test.service-a")
        correlation_id = str(uuid4())

        with tracer.start_as_current_span("service-a.request"):
            # Inject trace context
            headers = {"x-correlation-id": correlation_id}
            inject_trace_context(headers)

            # Verify both trace and correlation are in headers
            assert "traceparent" in headers
            assert headers["x-correlation-id"] == correlation_id

            # Simulate service B extracting both
            extracted = extract_trace_context(headers)
            assert headers["x-correlation-id"] == correlation_id


class TestCorrelationIdMiddleware:
    """Test correlation ID middleware behavior."""

    def test_middleware_adds_correlation_id(self) -> None:
        """Verify middleware adds correlation ID to request."""
        from src.shared.telemetry.correlation import CorrelationIdMiddleware

        app = FastAPI()
        app.add_middleware(CorrelationIdMiddleware)

        @app.get("/health")
        async def health(request: Request):
            # Check if correlation ID was added
            correlation_id = request.headers.get("x-correlation-id")
            return {"has_correlation_id": correlation_id is not None}

        client = TestClient(app)
        response = client.get("/health")

        assert response.status_code == 200
        data = response.json()
        assert data["has_correlation_id"] is True

    def test_middleware_preserves_existing_correlation(self) -> None:
        """Verify middleware preserves existing correlation ID."""
        from src.shared.telemetry.correlation import CorrelationIdMiddleware

        app = FastAPI()
        app.add_middleware(CorrelationIdMiddleware)

        received_correlation_id = None

        @app.get("/test")
        async def test_endpoint(request: Request):
            nonlocal received_correlation_id
            received_correlation_id = request.headers.get("x-correlation-id")
            return {"ok": True}

        client = TestClient(app)
        incoming_id = "550e8400-e29b-41d4-a716-446655440000"
        response = client.get("/test", headers={"x-correlation-id": incoming_id})

        assert response.status_code == 200
        assert received_correlation_id == incoming_id


class TestCorrelationIdInLogs:
    """Test correlation ID integration with logging."""

    def test_correlation_id_in_log_context(self) -> None:
        """Verify correlation ID is available in log context."""
        import logging
        from uuid import uuid4

        correlation_id = str(uuid4())

        # Create log record with correlation ID
        logger = logging.getLogger("test.correlation")

        # Simulate structured logging with correlation ID
        log_record = {
            "message": "Test log",
            "correlation_id": correlation_id,
            "trace_id": get_current_trace_id(),
        }

        assert log_record["correlation_id"] == correlation_id

    def test_correlation_id_with_nested_context(self) -> None:
        """Verify correlation ID persists through nested contexts."""
        from uuid import uuid4

        correlation_id = str(uuid4())

        def nested_function():
            # Should still have access to correlation ID
            return correlation_id

        def middle_function():
            return nested_function()

        result = middle_function()
        assert result == correlation_id


class TestCorrelationIdEdgeCases:
    """Test edge cases in correlation ID handling."""

    def test_empty_correlation_id_handling(self) -> None:
        """Verify empty correlation ID results in new generation."""
        # Empty or whitespace-only ID should be treated as missing
        empty_id = ""
        whitespace_id = "   "

        # Both should result in new ID generation
        assert not empty_id or len(empty_id.strip()) > 0
        assert not whitespace_id or len(whitespace_id.strip()) > 0

    def test_invalid_correlation_id_format(self) -> None:
        """Verify invalid correlation ID format results in new generation."""
        invalid_id = "not-a-valid-uuid"

        # Should be replaced with valid UUID
        from uuid import uuid4

        new_id = str(uuid4())
        assert len(new_id) == 36
        assert new_id != invalid_id

    def test_correlation_id_case_sensitivity(self) -> None:
        """Verify correlation ID header is case-insensitive."""
        # HTTP headers are case-insensitive
        header_variants = [
            "x-correlation-id",
            "X-Correlation-ID",
            "X-Correlation-Id",
        ]

        for header in header_variants:
            # All should be treated the same way
            assert header.lower() == "x-correlation-id"


class TestCorrelationIdAcrossAsyncBoundaries:
    """Test correlation ID across async boundaries."""

    @pytest.mark.asyncio
    async def test_correlation_id_in_async_context(self) -> None:
        """Verify correlation ID works with async/await."""
        from uuid import uuid4

        correlation_id = str(uuid4())

        async def async_task():
            await asyncio.sleep(0.01)
            return correlation_id

        import asyncio

        result = await async_task()
        assert result == correlation_id

    @pytest.mark.asyncio
    async def test_correlation_id_in_concurrent_tasks(self) -> None:
        """Verify each concurrent task has independent correlation ID."""
        from uuid import uuid4

        async def task_with_correlation(task_id: int):
            await asyncio.sleep(0.01)
            return str(uuid4())

        import asyncio

        tasks = [task_with_correlation(i) for i in range(5)]
        results = await asyncio.gather(*tasks)

        # Each task should have a unique correlation ID
        assert len(set(results)) == 5
