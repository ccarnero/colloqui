"""Telemetry configuration for OpenTelemetry.

Provides Pydantic-based configuration for OTEL SDK initialization.
"""

from __future__ import annotations

import os
from typing import Literal

from pydantic import BaseModel, Field, validator


class TelemetryConfig(BaseModel):
    """Configuration for OpenTelemetry telemetry.
    
    All settings can be overridden via environment variables
    using the OTEL_ prefix (e.g., OTEL_SERVICE_NAME).
    """
    
    # Service identification
    service_name: str = Field(
        default="yoizen-claw",
        description="Service identifier for telemetry",
    )
    service_version: str = Field(
        default="1.0.0",
        description="Service version",
    )
    environment: Literal["development", "staging", "production"] = Field(
        default="development",
        description="Deployment environment",
    )
    
    # OTLP endpoints
    otel_endpoint: str = Field(
        default=os.environ.get(
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "http://otel-collector.support-services-dev.svc.cluster.local:4318"
        ),
        description="OTLP HTTP endpoint for traces, metrics and logs",
    )
    otel_logs_endpoint: str | None = Field(
        default=None,
        description="Optional override for logs endpoint",
    )
    otel_metrics_endpoint: str | None = Field(
        default=None,
        description="Optional override for metrics endpoint",
    )
    
    # Sampling configuration
    sampling_rate: float = Field(
        default=1.0,
        ge=0.0,
        le=1.0,
        description="Sampling rate (1.0 = 100%, 0.1 = 10%)",
    )
    
    # Performance settings
    batch_size: int = Field(
        default=512,
        ge=1,
        le=2048,
        description="Maximum spans per batch export",
    )
    timeout_ms: int = Field(
        default=5000,
        ge=1000,
        le=30000,
        description="Export timeout in milliseconds",
    )
    schedule_delay_ms: int = Field(
        default=5000,
        ge=1000,
        le=30000,
        description="Delay between batch exports",
    )
    max_queue_size: int = Field(
        default=2048,
        ge=512,
        le=8192,
        description="Maximum pending spans in queue",
    )
    
    # Metric export interval
    metrics_export_interval_ms: int = Field(
        default=60000,
        ge=10000,
        le=300000,
        description="Metrics export interval in milliseconds",
    )
    
    # Feature flags
    enabled: bool = Field(
        default=True,
        description="Enable/disable all telemetry",
    )
    traces_enabled: bool = Field(
        default=True,
        description="Enable trace collection",
    )
    metrics_enabled: bool = Field(
        default=True,
        description="Enable metric collection",
    )
    logs_enabled: bool = Field(
        default=True,
        description="Enable log collection",
    )
    
    # Logging level
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR"] = Field(
        default="INFO",
        description="Minimum log level to export",
    )
    
    # Security
    insecure: bool = Field(
        default=True,
        description="Use insecure connection (dev only)",
    )
    
    @validator("sampling_rate", pre=True)
    @classmethod
    def parse_sampling_rate(cls, v):
        """Parse sampling rate from string or float."""
        if isinstance(v, str):
            return float(v)
        return v
    
    def get_effective_sampling_rate(self) -> float:
        """Get sampling rate based on environment.
        
        Returns:
            Sampling rate appropriate for the environment.
        """
        if self.environment == "production":
            return min(self.sampling_rate, 0.1)
        elif self.environment == "staging":
            return min(self.sampling_rate, 0.5)
        return 1.0
    
    def get_traces_endpoint(self) -> str:
        """Get the OTLP endpoint for traces."""
        return f"{self.otel_endpoint}/v1/traces"

    def get_metrics_endpoint(self) -> str:
        """Get the OTLP endpoint for metrics."""
        base = self.otel_metrics_endpoint or self.otel_endpoint
        return f"{base}/v1/metrics"

    def get_logs_endpoint(self) -> str:
        """Get the OTLP endpoint for logs."""
        base = self.otel_logs_endpoint or self.otel_endpoint
        return f"{base}/v1/logs"
