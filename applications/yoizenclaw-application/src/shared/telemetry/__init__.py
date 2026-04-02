"""OpenTelemetry telemetry module for YoizenClaw.

Provides unified initialization for tracing, metrics, and logging
with OpenTelemetry SDK integration.
"""

from __future__ import annotations

import logging as stdlib_logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .config import TelemetryConfig

logger = stdlib_logging.getLogger(__name__)

# Export public API
from .config import TelemetryConfig
from .tracer import (
    initialize_tracer,
    get_tracer_provider,
    get_tracer,
    shutdown_tracer,
)
from .metrics import (
    initialize_metrics,
    get_meter,
    record_agent_execution,
    record_llm_tokens,
    record_llm_call,
    record_job_duration,
    record_job_execution,
    record_nats_message,
    record_nats_duration,
    record_http_request,
    record_http_duration,
    shutdown_metrics,
)
from .logging import (
    setup_otel_logging,
    get_otel_handler,
    add_trace_context_to_log,
    shutdown_logging,
)
from .propagator import (
    inject_trace_context,
    extract_trace_context,
    get_traceparent_header,
    extract_from_headers,
    inject_into_headers,
    get_current_trace_id,
    get_current_span_id,
    get_current_trace_flags,
)
from .nats_propagator import (
    inject_trace_context as inject_nats_trace_context,
    extract_trace_context as extract_nats_trace_context,
    get_traceparent_header as get_nats_traceparent_header,
    create_nats_headers_with_trace,
    extract_context_from_nats_message,
)
from .sanitizer import (
    sanitize_attributes,
    sanitize_headers,
    sanitize_db_statement,
    sanitize_error_message,
    sanitize_log_message,
    is_safe_to_export,
)

__all__ = [
    # Configuration
    "TelemetryConfig",
    # Initialization
    "init_telemetry",
    "shutdown_telemetry",
    # Tracing
    "initialize_tracer",
    "get_tracer_provider",
    "get_tracer",
    "shutdown_tracer",
    # Metrics
    "initialize_metrics",
    "get_meter",
    "record_agent_execution",
    "record_llm_tokens",
    "record_llm_call",
    "record_job_duration",
    "record_job_execution",
    "record_nats_message",
    "record_nats_duration",
    "record_http_request",
    "record_http_duration",
    "shutdown_metrics",
    # Logging
    "setup_otel_logging",
    "get_otel_handler",
    "add_trace_context_to_log",
    "shutdown_logging",
    # Propagation (HTTP)
    "inject_trace_context",
    "extract_trace_context",
    "get_traceparent_header",
    "extract_from_headers",
    "inject_into_headers",
    "get_current_trace_id",
    "get_current_span_id",
    "get_current_trace_flags",
    # Propagation (NATS)
    "inject_nats_trace_context",
    "extract_nats_trace_context",
    "get_nats_traceparent_header",
    "create_nats_headers_with_trace",
    "extract_context_from_nats_message",
    # Sanitization
    "sanitize_attributes",
    "sanitize_headers",
    "sanitize_db_statement",
    "sanitize_error_message",
    "sanitize_log_message",
    "is_safe_to_export",
]

# Track initialization state
_is_initialized: bool = False
_config: TelemetryConfig | None = None


def init_telemetry(config: TelemetryConfig | None = None) -> None:
    """Initialize all telemetry components.
    
    This is the main entry point for setting up OpenTelemetry in YoizenClaw.
    Initializes tracer, metrics, and logging with the provided configuration.
    
    The initialization order is:
    1. Tracer provider (for distributed tracing)
    2. Metrics provider (for business metrics)
    3. Logging handler (for log correlation)
    
    Args:
        config: Telemetry configuration. If None, uses default configuration
            loaded from environment variables.
            
    Example:
        >>> from src.shared.telemetry import init_telemetry, TelemetryConfig
        >>> config = TelemetryConfig(
        ...     service_name="yoizen-claw",
        ...     service_version="1.0.0",
        ...     environment="development",
        ... )
        >>> init_telemetry(config)
    """
    global _is_initialized, _config
    
    if _is_initialized:
        logger.debug("Telemetry already initialized, skipping")
        return
    
    # Use default config if none provided
    if config is None:
        config = TelemetryConfig(
            service_name=os.getenv("OTEL_SERVICE_NAME", "yoizen-claw"),
            service_version=os.getenv("OTEL_SERVICE_VERSION", "1.0.0"),
            environment=os.getenv("OTEL_ENVIRONMENT", "development"),
            otel_endpoint=os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT", ""),
            sampling_rate=float(os.getenv("OTEL_SAMPLING_RATE", "1.0")),
            log_level=os.getenv("OTEL_LOG_LEVEL", "INFO"),
        )
    
    _config = config
    
    logger.info(
        "Initializing telemetry",
        extra={
            "service_name": config.service_name,
            "service_version": config.service_version,
            "environment": config.environment,
            "enabled": config.enabled,
        },
    )
    
    try:
        # 1. Initialize tracer provider first (other components depend on it)
        initialize_tracer(config)
        
        # 2. Initialize metrics provider
        initialize_metrics(config)
        
        # 3. Initialize logging integration
        otel_handler = setup_otel_logging(config)
        
        # 4. Add OTEL handler to root logger if available
        if otel_handler:
            root_logger = stdlib_logging.getLogger()
            root_logger.addHandler(otel_handler)
            
            # Add trace context filter to root logger
            for handler in root_logger.handlers:
                if hasattr(handler, "addFilter"):
                    handler.addFilter(add_trace_context_to_log)
        
        _is_initialized = True
        
        logger.info(
            "Telemetry initialization complete",
            extra={
                "traces_enabled": config.traces_enabled and config.enabled,
                "metrics_enabled": config.metrics_enabled and config.enabled,
                "logs_enabled": config.logs_enabled and config.enabled,
            },
        )
        
    except Exception as e:
        logger.error(f"Telemetry initialization failed: {e}")
        # Don't re-raise - telemetry should not break the application


def shutdown_telemetry() -> None:
    """Shutdown all telemetry components and flush pending data.
    
    Should be called during application shutdown to ensure all
    pending traces, metrics, and logs are exported.
    """
    global _is_initialized, _config
    
    if not _is_initialized:
        return
    
    logger.info("Shutting down telemetry")
    
    # Shutdown in reverse order of initialization
    try:
        shutdown_logging()
    except Exception as e:
        logger.warning(f"Error shutting down logging: {e}")
    
    try:
        shutdown_metrics()
    except Exception as e:
        logger.warning(f"Error shutting down metrics: {e}")
    
    try:
        shutdown_tracer()
    except Exception as e:
        logger.warning(f"Error shutting down tracer: {e}")
    
    _is_initialized = False
    _config = None
    
    logger.info("Telemetry shutdown complete")


def is_initialized() -> bool:
    """Check if telemetry has been initialized.
    
    Returns:
        True if telemetry is initialized, False otherwise.
    """
    return _is_initialized


def get_config() -> TelemetryConfig | None:
    """Get the current telemetry configuration.
    
    Returns:
        Current configuration if initialized, None otherwise.
    """
    return _config
