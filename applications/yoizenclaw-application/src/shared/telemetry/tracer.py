"""OpenTelemetry tracer provider singleton.

Provides a singleton TracerProvider with OTLP export and graceful degradation.
"""

from __future__ import annotations

import logging
import socket
from typing import TYPE_CHECKING

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.trace.sampling import (
    ParentBased,
    TraceIdRatioBased,
)

if TYPE_CHECKING:
    from .config import TelemetryConfig

logger = logging.getLogger(__name__)

# Global singleton instance
_tracer_provider: TracerProvider | None = None


def _create_sampler(sampling_rate: float) -> ParentBased:
    """Create a parent-based sampler with ratio-based root.
    
    Args:
        sampling_rate: Sampling ratio (0.0 to 1.0).
        
    Returns:
        Configured ParentBased sampler.
    """
    return ParentBased(
        root=TraceIdRatioBased(sampling_rate),
    )


def initialize_tracer(config: TelemetryConfig) -> TracerProvider:
    """Initialize the OTEL tracer provider singleton.
    
    Uses singleton pattern to prevent multiple initializations.
    Gracefully degrades to NoOpTracerProvider if initialization fails.
    
    Args:
        config: Telemetry configuration.
        
    Returns:
        Initialized TracerProvider or NoOpTracerProvider on failure.
    """
    global _tracer_provider
    
    if _tracer_provider is not None:
        logger.debug("Tracer provider already initialized, returning existing instance")
        return _tracer_provider
    
    if not config.enabled or not config.traces_enabled:
        logger.info("Telemetry or traces disabled, using NoOpTracerProvider")
        noop_provider = trace.NoOpTracerProvider()
        trace.set_tracer_provider(noop_provider)
        _tracer_provider = noop_provider
        return noop_provider
    
    try:
        # Create resource with service attributes
        resource = Resource.create({
            "service.name": config.service_name,
            "service.version": config.service_version,
            "deployment.environment": config.environment,
            "host.name": socket.gethostname(),
        })
        
        # Create sampler based on environment
        effective_rate = config.get_effective_sampling_rate()
        sampler = _create_sampler(effective_rate)
        
        # Create provider
        provider = TracerProvider(
            resource=resource,
            sampler=sampler,
        )
        
        # Create OTLP exporter
        otlp_exporter = OTLPSpanExporter(
            endpoint=config.get_traces_endpoint(),
            timeout=config.timeout_ms // 1000,
        )
        
        # Create batch span processor for efficiency
        span_processor = BatchSpanProcessor(
            otlp_exporter,
            max_queue_size=config.max_queue_size,
            max_export_batch_size=config.batch_size,
            schedule_delay_millis=config.schedule_delay_ms,
            export_timeout_millis=config.timeout_ms,
        )
        
        provider.add_span_processor(span_processor)
        trace.set_tracer_provider(provider)
        
        _tracer_provider = provider
        
        logger.info(
            "Tracer provider initialized",
            extra={
                "service_name": config.service_name,
                "environment": config.environment,
                "sampling_rate": effective_rate,
                "endpoint": config.get_traces_endpoint(),
            },
        )
        
        return provider
        
    except Exception as e:
        logger.warning(
            f"Failed to initialize tracer provider: {e}. "
            "Continuing with NoOpTracerProvider.",
        )
        noop_provider = trace.NoOpTracerProvider()
        trace.set_tracer_provider(noop_provider)
        _tracer_provider = noop_provider
        return noop_provider


def get_tracer_provider() -> TracerProvider | None:
    """Get the initialized tracer provider.
    
    Returns:
        The TracerProvider if initialized, None otherwise.
    """
    return _tracer_provider


def get_tracer(name: str = __name__) -> trace.Tracer:
    """Get a tracer instance.
    
    Args:
        name: Tracer name (typically module name).
        
    Returns:
        Tracer instance.
    """
    return trace.get_tracer(name)


def shutdown_tracer() -> None:
    """Shutdown the tracer provider and flush pending spans."""
    global _tracer_provider
    
    if _tracer_provider is not None:
        try:
            _tracer_provider.shutdown()
            logger.info("Tracer provider shutdown complete")
        except Exception as e:
            logger.warning(f"Error during tracer shutdown: {e}")
        finally:
            _tracer_provider = None
