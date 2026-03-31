"""Unit tests for telemetry configuration.

Tests the TelemetryConfig class with Pydantic validation,
environment variable parsing, and sampling rate logic.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from src.shared.telemetry.config import TelemetryConfig


class TestTelemetryConfigDefaults:
    """Test default configuration values."""

    def test_telemetry_config_defaults(self) -> None:
        """Verify default configuration values."""
        config = TelemetryConfig()

        assert config.enabled is True
        assert config.service_name == "yoizen-claw"
        assert config.service_version == "1.0.0"
        assert config.environment == "development"
        assert config.sampling_rate == 1.0
        assert config.otel_endpoint == "http://otel-collector:4317"
        assert config.batch_size == 512
        assert config.timeout_ms == 5000
        assert config.schedule_delay_ms == 5000
        assert config.max_queue_size == 2048
        assert config.metrics_export_interval_ms == 60000
        assert config.traces_enabled is True
        assert config.metrics_enabled is True
        assert config.logs_enabled is True
        assert config.log_level == "INFO"
        assert config.insecure is True


class TestTelemetryConfigFromEnv:
    """Test configuration loading from environment variables."""

    @patch.dict(os.environ, {
        "OTEL_SERVICE_NAME": "test-service",
        "OTEL_SERVICE_VERSION": "2.0.0",
        "OTEL_ENVIRONMENT": "production",
        "OTEL_ENDPOINT": "http://custom:4317",
        "OTEL_SAMPLING_RATE": "0.5",
        "OTEL_BATCH_SIZE": "256",
        "OTEL_TIMEOUT_MS": "10000",
        "OTEL_ENABLED": "false",
        "OTEL_TRACES_ENABLED": "false",
        "OTEL_METRICS_ENABLED": "false",
        "OTEL_LOGS_ENABLED": "false",
        "OTEL_LOG_LEVEL": "DEBUG",
        "OTEL_INSECURE": "false",
    }, clear=True)
    def test_telemetry_config_from_env(self) -> None:
        """Verify configuration is loaded from environment variables."""
        config = TelemetryConfig()

        assert config.service_name == "test-service"
        assert config.service_version == "2.0.0"
        assert config.environment == "production"
        assert config.otel_endpoint == "http://custom:4317"
        assert config.sampling_rate == 0.5
        assert config.batch_size == 256
        assert config.timeout_ms == 10000
        assert config.enabled is False
        assert config.traces_enabled is False
        assert config.metrics_enabled is False
        assert config.logs_enabled is False
        assert config.log_level == "DEBUG"
        assert config.insecure is False

    @patch.dict(os.environ, {"OTEL_SAMPLING_RATE": "0.25"}, clear=True)
    def test_sampling_rate_from_string(self) -> None:
        """Verify sampling rate is parsed from string."""
        config = TelemetryConfig()
        assert config.sampling_rate == 0.25


class TestTelemetryConfigValidation:
    """Test Pydantic validation constraints."""

    def test_sampling_rate_range(self) -> None:
        """Verify sampling rate must be between 0 and 1."""
        with pytest.raises(ValueError):
            TelemetryConfig(sampling_rate=1.5)

        with pytest.raises(ValueError):
            TelemetryConfig(sampling_rate=-0.1)

    def test_batch_size_range(self) -> None:
        """Verify batch size constraints."""
        with pytest.raises(ValueError):
            TelemetryConfig(batch_size=0)

        with pytest.raises(ValueError):
            TelemetryConfig(batch_size=4096)

    def test_timeout_ms_range(self) -> None:
        """Verify timeout constraints."""
        with pytest.raises(ValueError):
            TelemetryConfig(timeout_ms=500)

        with pytest.raises(ValueError):
            TelemetryConfig(timeout_ms=40000)

    def test_environment_enum(self) -> None:
        """Verify environment must be a valid literal."""
        with pytest.raises(ValueError):
            TelemetryConfig(environment="invalid")


class TestTelemetryConfigMethods:
    """Test configuration helper methods."""

    def test_get_effective_sampling_rate_development(self) -> None:
        """Verify 100% sampling in development."""
        config = TelemetryConfig(environment="development", sampling_rate=1.0)
        assert config.get_effective_sampling_rate() == 1.0

    def test_get_effective_sampling_rate_staging(self) -> None:
        """Verify capped sampling in staging."""
        config = TelemetryConfig(environment="staging", sampling_rate=1.0)
        assert config.get_effective_sampling_rate() == 0.5

    def test_get_effective_sampling_rate_production(self) -> None:
        """Verify capped sampling in production."""
        config = TelemetryConfig(environment="production", sampling_rate=1.0)
        assert config.get_effective_sampling_rate() == 0.1

    def test_get_effective_sampling_rate_with_lower_config(self) -> None:
        """Verify user-configured rate is respected if lower."""
        config = TelemetryConfig(environment="production", sampling_rate=0.05)
        assert config.get_effective_sampling_rate() == 0.05

    def test_get_traces_endpoint(self) -> None:
        """Verify traces endpoint returns main endpoint."""
        config = TelemetryConfig(otel_endpoint="http://traces:4317")
        assert config.get_traces_endpoint() == "http://traces:4317"

    def test_get_metrics_endpoint_with_override(self) -> None:
        """Verify metrics endpoint uses override if provided."""
        config = TelemetryConfig(
            otel_endpoint="http://main:4317",
            otel_metrics_endpoint="http://metrics:4318",
        )
        assert config.get_metrics_endpoint() == "http://metrics:4318"

    def test_get_metrics_endpoint_fallback(self) -> None:
        """Verify metrics endpoint falls back to main endpoint."""
        config = TelemetryConfig(otel_endpoint="http://main:4317")
        assert config.get_metrics_endpoint() == "http://main:4317"

    def test_get_logs_endpoint_with_override(self) -> None:
        """Verify logs endpoint uses override if provided."""
        config = TelemetryConfig(
            otel_endpoint="http://main:4317",
            otel_logs_endpoint="http://logs:4319",
        )
        assert config.get_logs_endpoint() == "http://logs:4319"

    def test_get_logs_endpoint_fallback(self) -> None:
        """Verify logs endpoint falls back to main endpoint."""
        config = TelemetryConfig(otel_endpoint="http://main:4317")
        assert config.get_logs_endpoint() == "http://main:4317"


class TestTelemetryConfigDisabled:
    """Test disabled telemetry behavior."""

    def test_disabled_telemetry(self) -> None:
        """Verify disabled flag propagates correctly."""
        config = TelemetryConfig(enabled=False)
        assert config.enabled is False
        assert config.traces_enabled is True  # Still enabled individually
        assert config.metrics_enabled is True
        assert config.logs_enabled is True
