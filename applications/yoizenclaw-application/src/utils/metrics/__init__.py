"""
Simple Prometheus metrics for YoizenClaw.
Exposes /metrics endpoint for Prometheus scraping.
"""

from prometheus_client import Counter, Histogram, Gauge, generate_latest, CONTENT_TYPE_LATEST
from prometheus_client import REGISTRY
from typing import Optional
import time

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

# HTTP metrics
http_requests_total = Counter(
    'http_requests_total',
    'Total HTTP requests',
    ['service', 'method', 'route', 'status']
)

http_request_duration_seconds = Histogram(
    'http_request_duration_seconds',
    'HTTP request duration in seconds',
    ['service', 'method', 'route'],
    buckets=[0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0]
)

# Business metrics
agent_executions_total = Counter(
    'agent_executions_total',
    'Total agent executions',
    ['service', 'agent_id', 'status', 'model']
)

llm_requests_total = Counter(
    'llm_requests_total',
    'Total LLM requests',
    ['service', 'model', 'status']
)

llm_tokens_total = Counter(
    'llm_tokens_total',
    'Total LLM tokens used',
    ['service', 'model', 'type']  # type: input/output
)

llm_request_duration_seconds = Histogram(
    'llm_request_duration_seconds',
    'LLM request duration',
    ['service', 'model'],
    buckets=[0.5, 1.0, 2.0, 5.0, 10.0, 30.0]
)

job_executions_total = Counter(
    'job_executions_total',
    'Total job executions',
    ['service', 'job_type', 'status']
)

job_duration_seconds = Histogram(
    'job_duration_seconds',
    'Job execution duration',
    ['service', 'job_type'],
    buckets=[1.0, 5.0, 15.0, 60.0, 300.0]
)

nats_messages_total = Counter(
    'nats_messages_total',
    'Total NATS messages',
    ['service', 'subject', 'type']  # type: publish/consume
)


class MetricsMiddleware(BaseHTTPMiddleware):
    """Starlette middleware for collecting Prometheus HTTP metrics."""

    def __init__(self, app, service_name: str = "yoizen-claw"):
        super().__init__(app)
        self.service_name = service_name

    async def dispatch(self, request: Request, call_next) -> Response:
        start_time = time.time()

        response = await call_next(request)

        duration = time.time() - start_time

        route = request.url.path
        method = request.method
        status = str(response.status_code)

        http_requests_total.labels(
            service=self.service_name,
            method=method,
            route=route,
            status=status,
        ).inc()

        http_request_duration_seconds.labels(
            service=self.service_name,
            method=method,
            route=route,
        ).observe(duration)

        return response


def record_agent_execution(agent_id: str, status: str, model: str, service: str = 'yoizen-claw') -> None:
    """Record agent execution metric."""
    agent_executions_total.labels(
        service=service,
        agent_id=agent_id,
        status=status,
        model=model
    ).inc()


def record_llm_request(model: str, status: str, duration: float, 
                       input_tokens: int = 0, output_tokens: int = 0,
                       service: str = 'yoizen-claw') -> None:
    """Record LLM request metric."""
    llm_requests_total.labels(
        service=service,
        model=model,
        status=status
    ).inc()
    
    llm_request_duration_seconds.labels(
        service=service,
        model=model
    ).observe(duration)
    
    if input_tokens > 0:
        llm_tokens_total.labels(
            service=service,
            model=model,
            type='input'
        ).inc(input_tokens)
    
    if output_tokens > 0:
        llm_tokens_total.labels(
            service=service,
            model=model,
            type='output'
        ).inc(output_tokens)


def record_job_execution(job_type: str, status: str, duration: float,
                         service: str = 'yoizen-claw') -> None:
    """Record job execution metric."""
    job_executions_total.labels(
        service=service,
        job_type=job_type,
        status=status
    ).inc()
    
    job_duration_seconds.labels(
        service=service,
        job_type=job_type
    ).observe(duration)


def record_nats_message(subject: str, msg_type: str, service: str = 'yoizen-claw') -> None:
    """Record NATS message metric."""
    nats_messages_total.labels(
        service=service,
        subject=subject,
        type=msg_type
    ).inc()


def get_metrics_response():
    """Generate Prometheus metrics response."""
    return generate_latest(REGISTRY)
