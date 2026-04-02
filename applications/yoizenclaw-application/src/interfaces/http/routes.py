"""FastAPI routes for the YoizenClaw API.

Provides HTTP endpoints for health checks, task operations,
and conversation management. Uses the modern lifespan pattern
for startup/shutdown and structured JSON logging.
"""

from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from src.application.memory import create_memory
from src.interfaces.http.handlers import health, logs, memories
from src.interfaces.http.middleware.auth import ApiKeyAuthMiddleware
from src.interfaces.http.middleware.rate_limit import RateLimitMiddleware
from src.shared.config.settings import bootstrap_settings
from src.shared.logging.structured_logger import init_logging, get_logger
from src.shared.metrics import get_metrics_response, CONTENT_TYPE_LATEST, MetricsMiddleware
from src.interfaces.http.middleware.correlation import CorrelationIdMiddleware

LOGGER_NAME = "yoizenclaw"


class LoggingMiddleware(BaseHTTPMiddleware):
    """Middleware that logs HTTP requests and responses with OTEL metrics."""

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = str(uuid4())
        start_time = time.perf_counter()

        client_ip = request.client.host if request.client else "unknown"
        log_data: dict[str, Any] = {
            "type": "access",
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "client_ip": client_ip,
            "query": str(request.query_params) if request.query_params else None,
        }

        logger.info(f"Request started: {request.method} {request.url.path}", extra=log_data)

        response = await call_next(request)

        duration = time.perf_counter() - start_time
        status_code = response.status_code

        response_data: dict[str, Any] = {
            "type": "access",
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "client_ip": client_ip,
            "status_code": status_code,
            "duration_ms": round(duration * 1000, 2),
        }

        if status_code < 400:
            logger.info(f"Request completed: {status_code}", extra=response_data)
        elif status_code < 500:
            logger.warning(f"Request warning: {status_code}", extra=response_data)
        else:
            logger.error(f"Request error: {status_code}", extra=response_data)

        return response


logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifespan with simplified observability."""
    scheduler_task = None
    scheduler_lock = None
    memory = None
    
    # Initialize logging outside try block
    init_logging(service_name="yoizen-claw", log_level="INFO")
    logger = get_logger(__name__)

    from src.shared.telemetry import init_telemetry
    init_telemetry()

    try:
        logger.info("Starting up YoizenClaw services...")

        memory = create_memory()
        if memory is None:
            raise RuntimeError("PostgreSQL memory backend is not available")
        await memory.initialize()

        from src.application.agents.agent_manager import get_agent_manager

        await get_agent_manager().initialize()

        from src.jobs.scheduler import create_job_scheduler
        from src.jobs.scheduler_leader import SchedulerLeaderLock

        await create_job_scheduler(memory)
        scheduler_lock = SchedulerLeaderLock(memory.pool)
        scheduler_task = asyncio.create_task(
            _run_scheduler_leader_loop(scheduler_lock),
        )
        logger.info("Job scheduler leader loop started")

        from src.interfaces.nats_bridge import start_nats_bridge

        await start_nats_bridge(bootstrap_settings.NATS_URL)
        logger.info("NATS bridge started")

        yield
    finally:
        logger.info("Shutting down YoizenClaw services...")

        from src.shared.telemetry import shutdown_telemetry
        shutdown_telemetry()

        if scheduler_task is not None:
            scheduler_task.cancel()
            try:
                await scheduler_task
            except asyncio.CancelledError:
                pass
            scheduler_task = None

        from src.jobs.scheduler import stop_job_scheduler

        await stop_job_scheduler()
        logger.info("Job scheduler stopped")

        if scheduler_lock is not None:
            await scheduler_lock.release()
            scheduler_lock = None

        from src.interfaces.nats_bridge import stop_nats_bridge

        await stop_nats_bridge()

        if memory is not None:
            await memory.close()
            memory = None


app = FastAPI(title="YoizenClaw", version="0.1.0", lifespan=lifespan)

# Initialize telemetry immediately after app creation (before adding middlewares)
from src.shared.telemetry import init_telemetry
init_telemetry()

# Instrument FastAPI for automatic HTTP tracing and metrics
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry import metrics as otel_metrics
meter_provider = otel_metrics.get_meter_provider()
FastAPIInstrumentor().instrument_app(app, meter_provider=meter_provider)

# Instrument asyncpg for automatic database tracing
try:
    from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor
    AsyncPGInstrumentor().instrument()
except ImportError:
    # AsyncPG instrumentation not available (missing dependency)
    pass


async def _run_scheduler_leader_loop(scheduler_lock) -> None:
    """Continuously try to become scheduler leader."""
    from src.jobs.scheduler import start_job_scheduler

    while scheduler_lock is not None:
        if await scheduler_lock.acquire():
            await start_job_scheduler()
            logging.info("Job scheduler started as leader")
            return
        await asyncio.sleep(10)


app.add_middleware(MetricsMiddleware, service_name="yoizen-claw")
app.add_middleware(LoggingMiddleware)
app.add_middleware(CorrelationIdMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(ApiKeyAuthMiddleware)

_cors_origins = bootstrap_settings.CORS_ORIGINS.split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in _cors_origins],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(logs.router)
app.include_router(memories.router)

# Metrics endpoint for Prometheus
@app.get("/metrics")
async def metrics():
    """Expose Prometheus metrics."""
    return Response(content=get_metrics_response(), media_type=CONTENT_TYPE_LATEST)
