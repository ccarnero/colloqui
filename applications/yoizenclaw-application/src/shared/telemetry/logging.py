"""OpenTelemetry logging integration.

Provides logging handler that exports logs via OTLP with trace correlation.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.sdk.resources import Resource

if TYPE_CHECKING:
    from .config import TelemetryConfig

# Track initialization state
_logger_provider: LoggerProvider | None = None
_otel_handler: LoggingHandler | None = None


def setup_otel_logging(config: TelemetryConfig) -> LoggingHandler | None:
    """Configure logging to export via OTLP with trace correlation.
    
    Creates a LoggingHandler that automatically captures trace context
    (trace_id, span_id) from the active span when logs are emitted.
    
    Args:
        config: Telemetry configuration.
        
    Returns:
        Configured LoggingHandler or None if disabled/failed.
    """
    global _logger_provider, _otel_handler
    
    if _otel_handler is not None:
        return _otel_handler
    
    if not config.enabled or not config.logs_enabled:
        logging.getLogger(__name__).debug("OTEL logging disabled by configuration")
        return None
    
    try:
        # Create resource
        resource = Resource.create({
            "service.name": config.service_name,
            "service.version": config.service_version,
            "deployment.environment": config.environment,
        })
        
        # Create logger provider
        _logger_provider = LoggerProvider(resource=resource)
        
        # Create OTLP exporter for logs
        otlp_exporter = OTLPLogExporter(
            endpoint=config.get_logs_endpoint(),
        )
        
        # Add batch processor
        processor = BatchLogRecordProcessor(
            otlp_exporter,
            max_queue_size=config.max_queue_size,
            max_export_batch_size=config.batch_size,
            schedule_delay_millis=config.schedule_delay_ms,
        )
        _logger_provider.add_log_record_processor(processor)
        
        # Create logging handler with trace correlation
        level = getattr(logging, config.log_level, logging.INFO)
        _otel_handler = LoggingHandler(
            level=level,
            logger_provider=_logger_provider,
        )
        
        logging.getLogger(__name__).info(
            "OTEL logging handler initialized",
            extra={
                "service_name": config.service_name,
                "log_level": config.log_level,
                "endpoint": config.get_logs_endpoint(),
            },
        )
        
        return _otel_handler
        
    except Exception as e:
        logging.getLogger(__name__).warning(
            f"Failed to initialize OTEL logging: {e}. "
            "Continuing without OTEL log export.",
        )
        return None


def get_otel_handler() -> LoggingHandler | None:
    """Get the initialized OTEL logging handler.
    
    Returns:
        The LoggingHandler if initialized, None otherwise.
    """
    return _otel_handler


def add_trace_context_to_log(record: logging.LogRecord) -> None:
    """Add trace context attributes to a log record.
    
    This function can be used as a logging filter to automatically
    inject trace_id and span_id into all log records.
    
    Args:
        record: The log record to augment.
        
    Returns:
        True (to allow the record to continue).
    """
    from opentelemetry import trace
    
    # Get current span context
    current_span = trace.get_current_span()
    if current_span:
        span_context = current_span.get_span_context()
        if span_context.is_valid:
            # Add trace context to the record
            record.trace_id = format(span_context.trace_id, "032x")
            record.span_id = format(span_context.span_id, "016x")
            record.trace_flags = span_context.trace_flags
    
    return True


def shutdown_logging() -> None:
    """Shutdown the logging provider and flush pending logs."""
    global _logger_provider, _otel_handler
    
    if _logger_provider is not None:
        try:
            _logger_provider.shutdown()
            logging.getLogger(__name__).info("OTEL logging provider shutdown complete")
        except Exception as e:
            logging.getLogger(__name__).warning(
                f"Error during logging provider shutdown: {e}",
            )
        finally:
            _logger_provider = None
            _otel_handler = None
