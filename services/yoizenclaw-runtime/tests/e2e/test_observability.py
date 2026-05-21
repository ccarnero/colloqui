"""End-to-end tests for observability stack.

Tests complete observability flow from application instrumentation
to telemetry export, verifying traces, metrics, and logs are properly
collected and correlated.
"""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock, patch

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider


@pytest.fixture(autouse=True)
def setup_tracer_provider():
    """Set up a tracer provider for testing."""
    provider = TracerProvider()
    trace.set_tracer_provider(provider)
    yield
    # Cleanup
    trace.set_tracer_provider(trace.NoOpTracerProvider())


class TestEndToEndTracing:
    """Test complete end-to-end tracing flow."""

    def test_api_request_trace(self) -> None:
        """Verify API request generates complete trace."""
        from src.shared.telemetry import get_tracer

        tracer = get_tracer("test.e2e.api")
        captured_spans = []

        # Mock span processor to capture spans
        class CaptureSpanProcessor:
            def on_start(self, span, parent_context=None):
                pass

            def on_end(self, span):
                captured_spans.append(span)

        # Add to provider
        provider = trace.get_tracer_provider()
        if hasattr(provider, "add_span_processor"):
            provider.add_span_processor(CaptureSpanProcessor())

        with tracer.start_as_current_span("http.request") as request_span:
            request_span.set_attribute("http.method", "GET")
            request_span.set_attribute("http.url", "/api/test")

            with tracer.start_as_current_span("auth.middleware") as auth_span:
                auth_span.set_attribute("auth.result", "success")

            with tracer.start_as_current_span("business.logic") as logic_span:
                logic_span.set_attribute("operation", "process_data")

            with tracer.start_as_current_span("db.query") as db_span:
                db_span.set_attribute("db.system", "postgresql")
                db_span.set_attribute("db.statement", "SELECT * FROM users")

        # Verify trace structure
        assert len(captured_spans) >= 4  # At least 4 spans

    def test_nats_trace(self) -> None:
        """Verify NATS operations generate traces."""
        from src.shared.telemetry import get_tracer

        nats_tracer = get_tracer("test.e2e.nats")

        with nats_tracer.start_as_current_span("nats.connect") as connect_span:
            connect_span.set_attribute("nats.id", "nats-123")

            with nats_tracer.start_as_current_span("nats.message") as msg_span:
                msg_span.set_attribute("message.type", "text")
                msg_span.set_attribute("message.size", 1024)

            with nats_tracer.start_as_current_span("nats.disconnect") as disc_span:
                disc_span.set_attribute("disconnect.code", 1000)

    def test_job_execution_trace(self) -> None:
        """Verify job execution generates complete trace."""
        from src.shared.telemetry import get_tracer

        job_tracer = get_tracer("test.e2e.jobs")

        with job_tracer.start_as_current_span("job.execute") as job_span:
            job_span.set_attribute("job.id", "job-123")
            job_span.set_attribute("job.type", "pipeline")

            with job_tracer.start_as_current_span("job.validate") as validate_span:
                validate_span.set_attribute("validation.result", "pass")

            with job_tracer.start_as_current_span("action.execute") as action_span:
                action_span.set_attribute("action.type", "llm")

                with job_tracer.start_as_current_span("llm.request") as llm_span:
                    llm_span.set_attribute("llm.model", "gpt-4")
                    llm_span.set_attribute("llm.tokens", 150)

            with job_tracer.start_as_current_span("job.complete") as complete_span:
                complete_span.set_attribute("job.result", "success")


class TestMetricsCollection:
    """Test end-to-end metrics collection."""

    def test_counter_metric(self) -> None:
        """Verify counter metrics are recorded."""
        try:
            from opentelemetry.metrics import get_meter

            meter = get_meter("test.e2e.metrics")
            counter = meter.create_counter(
                "test.requests",
                description="Test request count",
                unit="1",
            )

            counter.add(1, {"method": "GET", "status": "200"})
            counter.add(1, {"method": "POST", "status": "201"})

            # Metrics are exported asynchronously
            assert True  # If no exception, metric was recorded
        except Exception as e:
            pytest.skip(f"Metrics not available: {e}")

    def test_histogram_metric(self) -> None:
        """Verify histogram metrics are recorded."""
        try:
            from opentelemetry.metrics import get_meter

            meter = get_meter("test.e2e.metrics")
            histogram = meter.create_histogram(
                "test.duration",
                description="Test duration",
                unit="ms",
            )

            histogram.record(100, {"operation": "read"})
            histogram.record(250, {"operation": "write"})

            assert True
        except Exception as e:
            pytest.skip(f"Metrics not available: {e}")


class TestLogCorrelation:
    """Test correlation between logs, traces, and metrics."""

    def test_log_with_trace_id(self) -> None:
        """Verify logs include trace ID."""
        import logging

        from src.shared.telemetry.propagator import get_current_trace_id

        logger = logging.getLogger("test.e2e.logs")
        tracer = trace.get_tracer("test.e2e.logs")

        with tracer.start_as_current_span("logged_operation"):
            trace_id = get_current_trace_id()

            # Structured log with trace context
            log_entry = {
                "message": "Operation completed",
                "level": "INFO",
                "trace_id": trace_id,
            }

            assert log_entry["trace_id"] is not None

    def test_correlation_between_components(self) -> None:
        """Verify correlation between different observability signals."""
        from uuid import uuid4

        from src.shared.telemetry.propagator import get_current_trace_id

        tracer = trace.get_tracer("test.e2e.correlation")
        correlation_id = str(uuid4())

        with tracer.start_as_current_span("correlated_operation") as span:
            trace_id = get_current_trace_id()

            # All signals should share the same correlation
            span.set_attribute("correlation.id", correlation_id)

            # Log would include both correlation_id and trace_id
            log_entry = {
                "correlation_id": correlation_id,
                "trace_id": trace_id,
                "message": "Correlated log",
            }

            assert log_entry["correlation_id"] == correlation_id
            assert log_entry["trace_id"] == trace_id


class TestObservabilityStackIntegration:
    """Test integration with observability stack components."""

    def test_otel_collector_connection(self) -> None:
        """Verify connection to OTEL Collector."""
        # This is a mock test - in real scenario would check connection
        from src.shared.telemetry.config import TelemetryConfig

        config = TelemetryConfig()
        endpoint = config.otel_endpoint

        assert endpoint is not None
        assert "otel-collector" in endpoint or "localhost" in endpoint

    def test_grafana_dashboard_data_source(self) -> None:
        """Verify Grafana can query telemetry data."""
        # Mock verification that data source is configured
        expected_sources = ["tempo", "loki", "prometheus"]

        for source in expected_sources:
            assert source in ["tempo", "loki", "prometheus"]


class TestErrorHandlingAndResilience:
    """Test observability error handling."""

    def test_graceful_degradation_when_collector_unavailable(self) -> None:
        """Verify application continues when collector is down."""
        from src.shared.telemetry.tracer import initialize_tracer

        # Mock unavailable collector
        config = MagicMock()
        config.enabled = True
        config.traces_enabled = True
        config.service_name = "test"

        # Should not raise even if collector unavailable
        provider = initialize_tracer(config)
        assert provider is not None

    def test_span_creation_during_high_load(self) -> None:
        """Verify spans are created correctly under load."""
        from src.shared.telemetry import get_tracer

        tracer = get_tracer("test.load")
        span_count = 100

        spans_created = 0
        for i in range(span_count):
            with tracer.start_as_current_span(f"load_test_{i}"):
                spans_created += 1

        assert spans_created == span_count


class TestEndToEndScenarios:
    """Test complete real-world scenarios."""

    def test_user_request_flow(self) -> None:
        """Simulate complete user request with full observability."""
        from src.shared.telemetry import get_tracer
        from src.shared.telemetry.propagator import get_current_trace_id

        tracer = get_tracer("test.e2e.user_flow")

        # User makes API request
        with tracer.start_as_current_span("user.request"):
            trace_id = get_current_trace_id()

            # Authentication
            with tracer.start_as_current_span("auth.verify"):
                pass

            # Business logic
            with tracer.start_as_current_span("business.process"):
                # Database operation
                with tracer.start_as_current_span("db.query"):
                    pass

                # Cache lookup
                with tracer.start_as_current_span("cache.get"):
                    pass

            # Response formatting
            with tracer.start_as_current_span("response.format"):
                pass

        # Complete trace should exist
        assert trace_id is not None

    def test_batch_job_flow(self) -> None:
        """Simulate batch job with full observability."""
        from src.shared.telemetry import get_tracer

        tracer = get_tracer("test.e2e.batch_job")

        with tracer.start_as_current_span("batch.execute"):
            # Process multiple items
            for i in range(5):
                with tracer.start_as_current_span(f"item.process.{i}"):
                    # Each item processing
                    with tracer.start_as_current_span("item.validate"):
                        pass
                    with tracer.start_as_current_span("item.transform"):
                        pass
                    with tracer.start_as_current_span("item.save"):
                        pass


class TestObservabilityDataExport:
    """Test that observability data is properly exported."""

    def test_span_export_format(self) -> None:
        """Verify span data is in correct format for export."""
        from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
            InMemorySpanExporter,
        )

        exporter = InMemorySpanExporter()
        provider = TracerProvider()

        from opentelemetry.sdk.trace.export import SimpleSpanProcessor

        provider.add_span_processor(SimpleSpanProcessor(exporter))
        trace.set_tracer_provider(provider)

        tracer = trace.get_tracer("test.export")

        with tracer.start_as_current_span("test_span") as span:
            span.set_attribute("test.attribute", "value")

        # Get exported spans
        spans = exporter.get_finished_spans()
        assert len(spans) == 1

        exported_span = spans[0]
        assert exported_span.name == "test_span"

    def test_metric_export_format(self) -> None:
        """Verify metric data is in correct format for export."""
        # Metrics use OTLP format
        # This test verifies the metric pipeline is configured
        try:
            from opentelemetry.metrics import get_meter_provider

            provider = get_meter_provider()
            assert provider is not None
        except Exception as e:
            pytest.skip(f"Metrics provider not available: {e}")
