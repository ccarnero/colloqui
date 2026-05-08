"""Unit tests for trace context propagator.

Tests W3C Trace Context injection and extraction,
header manipulation, and context propagation.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import SpanContext, TraceFlags

from src.shared.telemetry.propagator import (
    extract_from_headers,
    extract_trace_context,
    get_current_span_id,
    get_current_trace_flags,
    get_current_trace_id,
    get_traceparent_header,
    inject_into_headers,
    inject_trace_context,
)


@pytest.fixture(autouse=True)
def setup_tracer_provider():
    """Set up a tracer provider for testing."""
    provider = TracerProvider()
    trace.set_tracer_provider(provider)
    yield
    # Cleanup
    trace.set_tracer_provider(trace.NoOpTracerProvider())


class TestTraceContextInjection:
    """Test trace context injection into carriers."""

    def test_trace_context_injection(self) -> None:
        """Verify traceparent is injected into carrier."""
        tracer = trace.get_tracer("test")

        with tracer.start_as_current_span("test_span"):
            carrier = {}
            result = inject_trace_context(carrier)

            assert "traceparent" in result
            # Format: 00-<trace_id>-<span_id>-<flags>
            traceparent = result["traceparent"]
            parts = traceparent.split("-")
            assert len(parts) == 4
            assert parts[0] == "00"  # Version

    def test_inject_into_headers(self) -> None:
        """Verify inject_into_headers alias works."""
        tracer = trace.get_tracer("test")

        with tracer.start_as_current_span("test_span"):
            headers = {}
            result = inject_into_headers(headers)

            assert "traceparent" in result

    def test_injection_preserves_existing_headers(self) -> None:
        """Verify existing headers are preserved during injection."""
        tracer = trace.get_tracer("test")

        with tracer.start_as_current_span("test_span"):
            headers = {"x-custom": "value", "Authorization": "Bearer token"}
            result = inject_trace_context(headers)

            assert result["x-custom"] == "value"
            assert result["Authorization"] == "Bearer token"
            assert "traceparent" in result

    def test_injection_without_active_span(self) -> None:
        """Verify graceful handling when no active span."""
        carrier = {}
        result = inject_trace_context(carrier)

        # Should not raise and should return carrier
        assert result is carrier


class TestTraceContextExtraction:
    """Test trace context extraction from carriers."""

    def test_trace_context_extraction(self) -> None:
        """Verify trace context is extracted from valid headers."""
        # Valid traceparent from W3C spec example
        headers = {
            "traceparent": "00-12345678901234567890123456789012-1234567890123456-01"
        }

        context = extract_trace_context(headers)

        assert context is not None
        # Context should be valid
        span = trace.get_current_span(context)
        assert span is not None

    def test_extract_from_headers(self) -> None:
        """Verify extract_from_headers alias works."""
        headers = {
            "traceparent": "00-12345678901234567890123456789012-1234567890123456-01"
        }

        context = extract_from_headers(headers)

        assert context is not None

    def test_extraction_with_invalid_traceparent(self) -> None:
        """Verify graceful handling of invalid traceparent."""
        headers = {"traceparent": "invalid-format"}

        # Should not raise
        context = extract_trace_context(headers)
        assert context is not None

    def test_extraction_without_traceparent(self) -> None:
        """Verify graceful handling when traceparent is missing."""
        headers = {"x-other": "value"}

        # Should not raise
        context = extract_trace_context(headers)
        assert context is not None


class TestGetTraceparentHeader:
    """Test getting traceparent header value."""

    def test_get_traceparent_header_with_active_span(self) -> None:
        """Verify traceparent header is returned with active span."""
        tracer = trace.get_tracer("test")

        with tracer.start_as_current_span("test_span"):
            result = get_traceparent_header()

            assert result is not None
            assert "traceparent" in result
            # Format: 00-<trace_id>-<span_id>-<flags>
            traceparent = result["traceparent"]
            parts = traceparent.split("-")
            assert len(parts) == 4

    def test_get_traceparent_header_without_active_span(self) -> None:
        """Verify None is returned without active span."""
        result = get_traceparent_header()

        # No active span, should return None
        assert result is None


class TestGetCurrentTraceInfo:
    """Test getting current trace information."""

    def test_get_current_trace_id_with_active_span(self) -> None:
        """Verify trace ID is returned with active span."""
        tracer = trace.get_tracer("test")

        with tracer.start_as_current_span("test_span") as span:
            trace_id = get_current_trace_id()

            assert trace_id is not None
            # Trace ID should be 32 hex characters
            assert len(trace_id) == 32
            # Should match the span's trace ID
            expected_id = format(span.get_span_context().trace_id, "032x")
            assert trace_id == expected_id

    def test_get_current_trace_id_without_active_span(self) -> None:
        """Verify None is returned without active span."""
        trace_id = get_current_trace_id()

        # No active span
        assert trace_id is None

    def test_get_current_span_id_with_active_span(self) -> None:
        """Verify span ID is returned with active span."""
        tracer = trace.get_tracer("test")

        with tracer.start_as_current_span("test_span") as span:
            span_id = get_current_span_id()

            assert span_id is not None
            # Span ID should be 16 hex characters
            assert len(span_id) == 16
            # Should match the span's span ID
            expected_id = format(span.get_span_context().span_id, "016x")
            assert span_id == expected_id

    def test_get_current_span_id_without_active_span(self) -> None:
        """Verify None is returned without active span."""
        span_id = get_current_span_id()

        # No active span
        assert span_id is None

    def test_get_current_trace_flags_with_active_span(self) -> None:
        """Verify trace flags are returned with active span."""
        tracer = trace.get_tracer("test")

        with tracer.start_as_current_span("test_span") as span:
            flags = get_current_trace_flags()

            assert flags is not None
            # Should match the span's trace flags
            assert flags == span.get_span_context().trace_flags

    def test_get_current_trace_flags_without_active_span(self) -> None:
        """Verify None is returned without active span."""
        flags = get_current_trace_flags()

        # No active span
        assert flags is None


class TestPropagationRoundTrip:
    """Test full round-trip propagation scenarios."""

    def test_extract_then_inject_preserves_trace(self) -> None:
        """Verify trace context is preserved through extract/inject cycle."""
        # Start with a valid traceparent
        original_traceparent = "00-12345678901234567890123456789012-1234567890123456-01"
        incoming_headers = {"traceparent": original_traceparent}

        # Extract the context
        context = extract_trace_context(incoming_headers)

        # Set as current context and create a child span
        tracer = trace.get_tracer("test")
        token = otel_context.attach(context)

        try:
            with tracer.start_as_current_span("child_span"):
                # Inject into new headers
                outgoing_headers = {}
                inject_trace_context(outgoing_headers)

                # Should have traceparent (child of original)
                assert "traceparent" in outgoing_headers
                new_traceparent = outgoing_headers["traceparent"]
                # New span should be child of original
                assert new_traceparent != original_traceparent
        finally:
            otel_context.detach(token)

    def test_cross_service_propagation_simulation(self) -> None:
        """Simulate cross-service trace propagation."""
        tracer = trace.get_tracer("service-a")

        # Service A creates a span and propagates to Service B
        with tracer.start_as_current_span("service-a-operation") as span_a:
            # Extract trace context for outgoing request
            headers = {}
            inject_trace_context(headers)

            # Service B receives the request and extracts context
            service_b_context = extract_trace_context(headers)

            # Service B creates a child span
            tracer_b = trace.get_tracer("service-b")
            token = otel_context.attach(service_b_context)

            try:
                with tracer_b.start_as_current_span("service-b-operation") as span_b:
                    # Verify spans are related
                    assert span_a.get_span_context().trace_id == span_b.get_span_context().trace_id
            finally:
                otel_context.detach(token)


class TestErrorHandling:
    """Test error handling in propagator functions."""

    def test_inject_with_exception(self) -> None:
        """Verify graceful handling of injection exceptions."""
        with patch(
            "src.shared.telemetry.propagator._propagator.inject",
            side_effect=Exception("Inject error"),
        ):
            carrier = {"existing": "value"}
            result = inject_trace_context(carrier)

            # Should return carrier even on error
            assert result == carrier

    def test_extract_with_exception(self) -> None:
        """Verify graceful handling of extraction exceptions."""
        with patch(
            "src.shared.telemetry.propagator._propagator.extract",
            side_effect=Exception("Extract error"),
        ):
            headers = {"traceparent": "00-12345678901234567890123456789012-1234567890123456-01"}
            result = extract_trace_context(headers)

            # Should return current context even on error
            assert result is not None

    def test_get_traceparent_with_exception(self) -> None:
        """Verify graceful handling of get_traceparent exceptions."""
        with patch(
            "src.shared.telemetry.propagator.inject_trace_context",
            side_effect=Exception("Inject error"),
        ):
            result = get_traceparent_header()

            # Should return None on error
            assert result is None
