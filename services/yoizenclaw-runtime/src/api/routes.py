"""FastAPI routes for the YoizenClaw API.

Provides HTTP endpoints for health checks, task operations,
and conversation management. Uses the modern lifespan pattern
for startup/shutdown and structured JSON logging.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List
from uuid import uuid4

from fastapi import FastAPI, Request, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from src.app.memory import create_memory
from src.api.handlers import health, logs, memories, agents
from src.api.middleware.auth import ApiKeyAuthMiddleware
from src.api.middleware.rate_limit import RateLimitMiddleware
from src.utils.config.settings import bootstrap_settings
from src.utils.logging.structured_logger import init_logging, get_logger
from src.utils.metrics import (
    get_metrics_response,
    CONTENT_TYPE_LATEST,
    MetricsMiddleware,
)
from src.api.middleware.correlation import CorrelationIdMiddleware

LOGGER_NAME = "yoizenclaw"


class LoggingMiddleware(BaseHTTPMiddleware):
    """Middleware that logs HTTP requests and responses with OTEL metrics."""

    _IGNORED_PATHS = {"/health", "/metrics"}

    async def dispatch(self, request: Request, call_next) -> Response:
        if request.url.path in self._IGNORED_PATHS:
            return await call_next(request)

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

        logger.info(
            f"Request started: {request.method} {request.url.path}", extra=log_data
        )

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

    from src.utils.telemetry import init_telemetry

    init_telemetry()

    try:
        logger.info("Starting up YoizenClaw services...")

        memory = create_memory()
        if memory is None:
            raise RuntimeError("PostgreSQL memory backend is not available")
        await memory.initialize()

        from src.app.agents.agent_manager import get_agent_manager

        await get_agent_manager().initialize()

        from src.utils.adapter_client import ensure_adapter_client_in_container

        ensure_adapter_client_in_container()

        # Initialize conversation memory store
        from src.app.conversation.memory_store import get_conversation_store

        conversation_store = get_conversation_store()
        await conversation_store.start_cleanup_task()
        logger.info("Conversation memory store initialized")

        from src.services.scheduler import create_job_scheduler
        from src.services.scheduler_leader import SchedulerLeaderLock

        await create_job_scheduler(memory)
        scheduler_lock = SchedulerLeaderLock(memory.pool)
        scheduler_task = asyncio.create_task(
            _run_scheduler_leader_loop(scheduler_lock),
        )
        logger.info("Job scheduler leader loop started")

        from src.messaging.bridge import start_nats_bridge

        await start_nats_bridge(bootstrap_settings.NATS_URL)
        logger.info("NATS bridge started")

        yield
    finally:
        logger.info("Shutting down YoizenClaw services...")

        from src.utils.telemetry import shutdown_telemetry

        shutdown_telemetry()

        if scheduler_task is not None:
            scheduler_task.cancel()
            try:
                await scheduler_task
            except asyncio.CancelledError:
                pass
            scheduler_task = None

        from src.services.scheduler import stop_job_scheduler

        await stop_job_scheduler()
        logger.info("Job scheduler stopped")

        if scheduler_lock is not None:
            await scheduler_lock.release()
            scheduler_lock = None

        from src.messaging.bridge import stop_nats_bridge

        await stop_nats_bridge()

        if memory is not None:
            await memory.close()
            memory = None

        # Stop conversation memory store
        from src.app.conversation.memory_store import get_conversation_store

        conversation_store = get_conversation_store()
        await conversation_store.stop_cleanup_task()
        logger.info("Conversation memory store stopped")


app = FastAPI(title="YoizenClaw", version="0.1.0", lifespan=lifespan)

if os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry import metrics as otel_metrics

    meter_provider = otel_metrics.get_meter_provider()
    FastAPIInstrumentor().instrument_app(app, meter_provider=meter_provider)

    try:
        from opentelemetry.instrumentation.asyncpg import AsyncPGInstrumentor

        AsyncPGInstrumentor().instrument()
    except ImportError:
        pass
else:
    logger.info(
        "OTEL_EXPORTER_OTLP_ENDPOINT not set, skipping telemetry initialization"
    )


async def _run_scheduler_leader_loop(scheduler_lock) -> None:
    """Continuously try to become scheduler leader."""
    from src.services.scheduler import start_job_scheduler

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


# Agent management endpoints
@app.post("/api/agents")
async def create_agent(request: agents.AgentCreateRequest):
    """Create a new agent with enhanced features."""
    return await agents.create_agent(request)


@app.get("/api/agents/templates")
async def get_agent_templates():
    """Get available agent and skill templates."""
    return await agents.get_agent_templates()


@app.post("/api/agents/validate")
async def validate_agent_config(config: Dict[str, Any]):
    """Validate agent configuration."""
    return await agents.validate_agent_config(config)


# Admin console endpoints for config sync
@app.post("/config/sync")
async def admin_config_sync(files: List[Dict[str, Any]]):
    """Admin console endpoint for config sync (mirrors NATS behavior)."""
    try:
        from src.messaging.handlers.config import _apply_config_sync

        await _apply_config_sync(files, delete_paths=None)

        return {
            "success": True,
            "message": f"Config sync completed for {len(files)} files",
            "files_processed": len(files),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Config sync failed: {str(e)}")


@app.get("/config/agents")
async def list_agents():
    """List all available agent configurations."""
    try:
        from src.utils.utils.runtime_config import RuntimeConfigRepository
        from src.utils.config.settings import bootstrap_settings

        repo = RuntimeConfigRepository(
            bootstrap_settings.DATABASE_URL, bootstrap_settings.TENANT_ID
        )

        agents = await repo.load_all_agent_configs()

        return {"agents": agents, "count": len(agents)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list agents: {str(e)}")


@app.get("/config/agents/{agent_id}")
async def get_agent_config(agent_id: str):
    """Get specific agent configuration."""
    try:
        from src.utils.utils.runtime_config import RuntimeConfigRepository
        from src.utils.config.settings import bootstrap_settings

        repo = RuntimeConfigRepository(
            bootstrap_settings.DATABASE_URL, bootstrap_settings.TENANT_ID
        )

        config = await repo.load_agent_config(agent_id or None)

        return {"agent_id": agent_id, "config": config}
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Agent not found: {str(e)}")


@app.post("/config/agents/{agent_id}")
async def update_agent_config(agent_id: str, config: Dict[str, Any]):
    """Update agent configuration (admin console)."""
    try:
        from src.utils.utils.runtime_config import RuntimeConfigRepository
        from src.utils.config.settings import bootstrap_settings
        from src.utils.config.agent_config import EnhancedAgentSyncRequest

        # Validate configuration
        if config.get("enableEnhancedSkills", True):
            validated = EnhancedAgentSyncRequest(**config)
        else:
            from src.utils.config.agent_config import AgentSyncRequest

            validated = AgentSyncRequest(**config)

        repo = RuntimeConfigRepository(
            bootstrap_settings.DATABASE_URL, bootstrap_settings.TENANT_ID
        )

        saved_config = await repo.save_agent_config(validated, agent_id or None)

        # Trigger runtime reload
        from src.app.agents.agent_manager import get_agent_manager

        await get_agent_manager().update_agent_config(saved_config, agent_id or None)

        return {
            "success": True,
            "message": f"Agent {agent_id} updated successfully",
            "config": saved_config,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to update agent: {str(e)}")


@app.delete("/config/agents/{agent_id}")
async def delete_agent_config(agent_id: str):
    """Delete agent configuration."""
    try:
        from src.utils.utils.runtime_config import RuntimeConfigRepository
        from src.utils.config.settings import bootstrap_settings

        repo = RuntimeConfigRepository(
            bootstrap_settings.DATABASE_URL, bootstrap_settings.TENANT_ID
        )

        await repo.remove_agent_config(agent_id or None)

        return {"success": True, "message": f"Agent {agent_id} deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete agent: {str(e)}")
