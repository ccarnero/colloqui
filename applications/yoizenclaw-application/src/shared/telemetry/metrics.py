"""OpenTelemetry metrics provider.

Provides MeterProvider with OTLP export for custom business metrics.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.sdk.resources import Resource

if TYPE_CHECKING:
    from .config import TelemetryConfig

logger = logging.getLogger(__name__)

# Global singleton instances
_meter_provider: MeterProvider | None = None
_meter: metrics.Meter | None = None

# Pre-defined business metrics (initialized lazily)
_agent_executions_counter: metrics.Counter | None = None
_llm_tokens_histogram: metrics.Histogram | None = None
_llm_calls_counter: metrics.Counter | None = None
_job_duration_histogram: metrics.Histogram | None = None
_job_executions_counter: metrics.Counter | None = None
_nats_messages_counter: metrics.Counter | None = None
_nats_duration_histogram: metrics.Histogram | None = None
_http_requests_counter: metrics.Counter | None = None
_http_duration_histogram: metrics.Histogram | None = None


def initialize_metrics(config: TelemetryConfig) -> metrics.Meter:
    """Initialize the OTEL metrics provider.
    
    Uses singleton pattern to prevent multiple initializations.
    
    Args:
        config: Telemetry configuration.
        
    Returns:
        Initialized Meter instance.
    """
    global _meter_provider, _meter
    
    if _meter is not None:
        logger.debug("Metrics provider already initialized, returning existing meter")
        return _meter
    
    if not config.enabled or not config.metrics_enabled:
        logger.info("Telemetry or metrics disabled, using NoOpMeterProvider")
        noop_provider = metrics.NoOpMeterProvider()
        metrics.set_meter_provider(noop_provider)
        _meter_provider = noop_provider
        _meter = noop_provider.get_meter(__name__)
        return _meter
    
    try:
        # Create resource
        resource = Resource.create({
            "service.name": config.service_name,
            "service.version": config.service_version,
            "deployment.environment": config.environment,
        })
        
        # Create OTLP exporter
        otlp_exporter = OTLPMetricExporter(
            endpoint=config.get_metrics_endpoint(),
        )
        
        # Create periodic reader
        reader = PeriodicExportingMetricReader(
            otlp_exporter,
            export_interval_millis=config.metrics_export_interval_ms,
        )
        
        # Create provider
        _meter_provider = MeterProvider(
            resource=resource,
            metric_readers=[reader],
        )
        
        metrics.set_meter_provider(_meter_provider)
        _meter = metrics.get_meter(__name__)
        
        # Initialize pre-defined metrics
        _initialize_business_metrics(_meter)
        
        logger.info(
            "Metrics provider initialized",
            extra={
                "service_name": config.service_name,
                "export_interval_ms": config.metrics_export_interval_ms,
                "endpoint": config.get_metrics_endpoint(),
            },
        )
        
        return _meter
        
    except Exception as e:
        logger.warning(
            f"Failed to initialize metrics provider: {e}. "
            "Continuing with NoOpMeterProvider.",
        )
        noop_provider = metrics.NoOpMeterProvider()
        metrics.set_meter_provider(noop_provider)
        _meter_provider = noop_provider
        _meter = noop_provider.get_meter(__name__)
        return _meter


def _initialize_business_metrics(meter: metrics.Meter) -> None:
    """Initialize pre-defined business metrics.
    
    Args:
        meter: Meter instance to create metrics with.
    """
    global _agent_executions_counter
    global _llm_tokens_histogram
    global _llm_calls_counter
    global _job_duration_histogram
    global _job_executions_counter
    global _nats_messages_counter
    global _nats_duration_histogram
    global _http_requests_counter
    global _http_duration_histogram
    
    # Agent execution metrics
    _agent_executions_counter = meter.create_counter(
        "agent_executions_total",
        description="Total number of agent executions",
        unit="1",
    )
    
    # LLM metrics
    _llm_tokens_histogram = meter.create_histogram(
        "llm_tokens_used",
        description="Number of tokens used in LLM calls",
        unit="token",
        explicit_bucket_boundaries_advisory=[1, 10, 50, 100, 500, 1000, 5000, 10000],
    )
    
    _llm_calls_counter = meter.create_counter(
        "llm_calls_total",
        description="Total number of LLM API calls",
        unit="1",
    )
    
    # Job metrics
    _job_duration_histogram = meter.create_histogram(
        "job_execution_duration_seconds",
        description="Job execution duration in seconds",
        unit="s",
        explicit_bucket_boundaries_advisory=[0.1, 0.5, 1, 2, 5, 10, 30, 60],
    )
    
    _job_executions_counter = meter.create_counter(
        "job_executions_total",
        description="Total number of job executions",
        unit="1",
    )
    
    # NATS metrics
    _nats_messages_counter = meter.create_counter(
        "nats_messages_total",
        description="Total number of NATS messages",
        unit="1",
    )
    
    _nats_duration_histogram = meter.create_histogram(
        "nats_message_duration_seconds",
        description="NATS message processing duration",
        unit="s",
        explicit_bucket_boundaries_advisory=[0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    )
    
    # HTTP metrics
    _http_requests_counter = meter.create_counter(
        "http_requests_total",
        description="Total number of HTTP requests",
        unit="1",
    )
    
    _http_duration_histogram = meter.create_histogram(
        "http_request_duration_seconds",
        description="HTTP request duration in seconds",
        unit="s",
        explicit_bucket_boundaries_advisory=[0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    )


def get_meter() -> metrics.Meter:
    """Get the initialized meter.
    
    Returns:
        Meter instance (may be NoOp if not initialized).
    """
    if _meter is None:
        return metrics.get_meter(__name__)
    return _meter


# Metric recording functions

def record_agent_execution(agent_name: str, status: str, model: str | None = None) -> None:
    """Record an agent execution.
    
    Args:
        agent_name: Name of the agent.
        status: Execution status (success/error).
        model: Optional model name used.
    """
    if _agent_executions_counter:
        attributes = {"agent_name": agent_name, "status": status}
        if model:
            attributes["model"] = model
        _agent_executions_counter.add(1, attributes)


def record_llm_tokens(tokens: int, model_name: str, operation_type: str = "completion") -> None:
    """Record LLM token usage.
    
    Args:
        tokens: Number of tokens used.
        model_name: Name of the model.
        operation_type: Type of operation (completion/embeddings).
    """
    if _llm_tokens_histogram:
        _llm_tokens_histogram.record(
            tokens,
            {"model_name": model_name, "operation_type": operation_type},
        )


def record_llm_call(model: str, status: str) -> None:
    """Record an LLM API call.
    
    Args:
        model: Model name.
        status: Call status (success/error).
    """
    if _llm_calls_counter:
        _llm_calls_counter.add(1, {"model": model, "status": status})


def record_job_duration(duration_seconds: float, job_type: str, status: str) -> None:
    """Record job execution duration.
    
    Args:
        duration_seconds: Execution duration.
        job_type: Type of job.
        status: Execution status.
    """
    if _job_duration_histogram:
        _job_duration_histogram.record(
            duration_seconds,
            {"job_type": job_type, "status": status},
        )


def record_job_execution(job_type: str, status: str) -> None:
    """Record a job execution.
    
    Args:
        job_type: Type of job.
        status: Execution status.
    """
    if _job_executions_counter:
        _job_executions_counter.add(1, {"job_type": job_type, "status": status})


def record_nats_message(subject: str, direction: str, status: str) -> None:
    """Record a NATS message.
    
    Args:
        subject: NATS subject.
        direction: Message direction (publish/consume).
        status: Processing status.
    """
    if _nats_messages_counter:
        _nats_messages_counter.add(
            1,
            {"subject": subject, "direction": direction, "status": status},
        )


def record_nats_duration(duration_seconds: float, subject: str) -> None:
    """Record NATS message processing duration.
    
    Args:
        duration_seconds: Processing duration.
        subject: NATS subject.
    """
    if _nats_duration_histogram:
        _nats_duration_histogram.record(duration_seconds, {"subject": subject})


def record_http_request(method: str, route: str, status_code: int) -> None:
    """Record an HTTP request.
    
    Args:
        method: HTTP method.
        route: Route path.
        status_code: Response status code.
    """
    if _http_requests_counter:
        _http_requests_counter.add(
            1,
            {"method": method, "route": route, "status_code": str(status_code)},
        )


def record_http_duration(duration_seconds: float, method: str, route: str) -> None:
    """Record HTTP request duration.
    
    Args:
        duration_seconds: Request duration.
        method: HTTP method.
        route: Route path.
    """
    if _http_duration_histogram:
        _http_duration_histogram.record(
            duration_seconds,
            {"method": method, "route": route},
        )


def shutdown_metrics() -> None:
    """Shutdown the metrics provider and flush pending metrics."""
    global _meter_provider, _meter
    
    if _meter_provider is not None:
        try:
            _meter_provider.shutdown()
            logger.info("Metrics provider shutdown complete")
        except Exception as e:
            logger.warning(f"Error during metrics shutdown: {e}")
        finally:
            _meter_provider = None
            _meter = None
