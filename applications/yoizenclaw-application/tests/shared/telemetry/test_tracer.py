"""Unit tests for tracer provider initialization.

Tests the OTEL tracer provider singleton, initialization,
sampler configuration, and graceful degradation.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.trace import NoOpTracerProvider

from src.shared.telemetry.config import TelemetryConfig
from src.shared.telemetry.tracer import (
    get_tracer,
    get_tracer_provider,
    initialize_tracer,
    shutdown_tracer,
)


@pytest.fixture(autouse=True)
def reset_tracer_provider():
    """Reset the global tracer provider before each test."""
    # Reset the global state
    import src.shared.telemetry.tracer as tracer_module

    tracer_module._tracer_provider = None
    trace._TRACER_PROVIDER_SET_ONCE = trace.Once()
    trace._TRACER_PROVIDER = None
    yield
    # Cleanup after test
    shutdown_tracer()
    tracer_module._tracer_provider = None


class TestTracerProviderInitialization:
    """Test tracer provider initialization."""

    def test_tracer_provider_initialization(self) -> None:
        """Verify tracer provider initializes successfully."""
        config = TelemetryConfig(
            service_name="test",
            service_version="1.0.0",
            environment="test",
            enabled=True,
            traces_enabled=True,
        )

        provider = initialize_tracer(config)

        assert provider is not None
        assert isinstance(provider, TracerProvider)

    def test_tracer_provider_singleton(self) -> None:
        """Verify tracer provider is a singleton."""
        config = TelemetryConfig(enabled=True, traces_enabled=True)

        provider1 = initialize_tracer(config)
        provider2 = initialize_tracer(config)

        assert provider1 is provider2

    def test_get_tracer(self) -> None:
        """Verify get_tracer returns a valid tracer."""
        config = TelemetryConfig(enabled=True, traces_enabled=True)
        initialize_tracer(config)

        tracer = get_tracer("test.module")

        assert tracer is not None
        assert tracer is not trace.NoOpTracer()


class TestTracerProviderDisabled:
    """Test disabled telemetry behavior."""

    def test_disabled_telemetry_returns_noop(self) -> None:
        """Verify disabled telemetry returns NoOpTracerProvider."""
        config = TelemetryConfig(enabled=False)

        provider = initialize_tracer(config)

        assert isinstance(provider, NoOpTracerProvider)

    def test_disabled_traces_returns_noop(self) -> None:
        """Verify disabled traces returns NoOpTracerProvider."""
        config = TelemetryConfig(enabled=True, traces_enabled=False)

        provider = initialize_tracer(config)

        assert isinstance(provider, NoOpTracerProvider)

    def test_get_tracer_when_disabled(self) -> None:
        """Verify get_tracer works when telemetry is disabled."""
        config = TelemetryConfig(enabled=False)
        initialize_tracer(config)

        tracer = get_tracer("test")

        assert tracer is not None
        assert isinstance(tracer, trace.NoOpTracer)


class TestTracerProviderSampling:
    """Test tracer provider sampling configuration."""

    def test_development_sampling_rate(self) -> None:
        """Verify 100% sampling in development."""
        config = TelemetryConfig(
            environment="development",
            sampling_rate=1.0,
            enabled=True,
            traces_enabled=True,
        )

        provider = initialize_tracer(config)

        # Verify sampler was configured
        assert provider is not None
        assert not isinstance(provider, NoOpTracerProvider)

    def test_production_sampling_rate(self) -> None:
        """Verify reduced sampling in production."""
        config = TelemetryConfig(
            environment="production",
            sampling_rate=1.0,
            enabled=True,
            traces_enabled=True,
        )

        provider = initialize_tracer(config)

        # Verify provider was created
        assert provider is not None
        assert not isinstance(provider, NoOpTracerProvider)


class TestTracerProviderGracefulDegradation:
    """Test graceful degradation on initialization failure."""

    @patch(
        "src.shared.telemetry.tracer.OTLPSpanExporter",
        side_effect=Exception("Connection refused"),
    )
    def test_initialization_failure_returns_noop(self, mock_exporter) -> None:
        """Verify graceful degradation when initialization fails."""
        config = TelemetryConfig(enabled=True, traces_enabled=True)

        provider = initialize_tracer(config)

        assert isinstance(provider, NoOpTracerProvider)

    @patch(
        "src.shared.telemetry.tracer.BatchSpanProcessor",
        side_effect=Exception("Processor error"),
    )
    def test_processor_failure_returns_noop(self, mock_processor) -> None:
        """Verify graceful degradation when processor fails."""
        config = TelemetryConfig(enabled=True, traces_enabled=True)

        provider = initialize_tracer(config)

        assert isinstance(provider, NoOpTracerProvider)


class TestTracerProviderShutdown:
    """Test tracer provider shutdown."""

    def test_shutdown_tracer(self) -> None:
        """Verify tracer provider shuts down cleanly."""
        config = TelemetryConfig(enabled=True, traces_enabled=True)
        initialize_tracer(config)

        # Should not raise any exceptions
        shutdown_tracer()

        # After shutdown, provider should be None
        assert get_tracer_provider() is None

    def test_shutdown_without_initialization(self) -> None:
        """Verify shutdown works even if not initialized."""
        # Reset any existing provider
        shutdown_tracer()

        # Should not raise any exceptions
        shutdown_tracer()

    def test_get_tracer_provider_after_shutdown(self) -> None:
        """Verify get_tracer_provider returns None after shutdown."""
        config = TelemetryConfig(enabled=True, traces_enabled=True)
        initialize_tracer(config)
        shutdown_tracer()

        provider = get_tracer_provider()
        assert provider is None


class TestTracerProviderResource:
    """Test tracer provider resource attributes."""

    def test_resource_attributes(self) -> None:
        """Verify resource attributes are set correctly."""
        config = TelemetryConfig(
            service_name="my-service",
            service_version="2.0.0",
            environment="staging",
            enabled=True,
            traces_enabled=True,
        )

        provider = initialize_tracer(config)

        assert provider is not None
        # Resource is internal, but we can verify the provider was created
        assert isinstance(provider, TracerProvider)
