"""Health check handler with dependency validation.

Checks PostgreSQL, NATS, and scheduler connectivity.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from src.shared.config.runtime_config_store import RuntimeConfigStore

router = APIRouter()

logger = logging.getLogger(__name__)


class HealthCheckDependency(BaseModel):
    """Status of an individual dependency check."""

    name: str
    status: str
    detail: str | None = None


class DetailedHealthResponse(BaseModel):
    """Detailed health check response with dependency statuses."""

    status: str
    configured: bool
    dependencies: dict[str, HealthCheckDependency]


def _check_agent_manager() -> HealthCheckDependency:
    try:
        from src.application.agents.agent_manager import get_agent_manager

        get_agent_manager()
        return HealthCheckDependency(name="agent_manager", status="ok")
    except Exception as exc:
        logger.debug("Agent manager check failed: %s", exc)
        return HealthCheckDependency(
            name="agent_manager", status="error", detail=str(exc),
        )


def _check_nats() -> HealthCheckDependency:
    try:
        from src.interfaces.nats_bridge import get_nats_bridge

        bridge = get_nats_bridge()
        if bridge is None:
            return HealthCheckDependency(
                name="nats_bridge", status="unavailable",
            )
        connected = bridge._nats.is_connected
        return HealthCheckDependency(
            name="nats_bridge",
            status="ok" if connected else "disconnected",
        )
    except Exception as exc:
        logger.debug("NATS bridge check failed: %s", exc)
        return HealthCheckDependency(
            name="nats_bridge", status="error", detail=str(exc),
        )


def _check_scheduler() -> HealthCheckDependency:
    try:
        from src.jobs.scheduler import get_job_scheduler

        scheduler = get_job_scheduler()
        if scheduler is None:
            return HealthCheckDependency(
                name="scheduler", status="unavailable",
            )
        return HealthCheckDependency(name="scheduler", status="ok")
    except Exception as exc:
        logger.debug("Scheduler check failed: %s", exc)
        return HealthCheckDependency(
            name="scheduler", status="error", detail=str(exc),
        )


def _check_config() -> HealthCheckDependency:
    config = RuntimeConfigStore.get_optional()
    if config is None:
        return HealthCheckDependency(
            name="runtime_config", status="waiting_for_config",
        )
    return HealthCheckDependency(name="runtime_config", status="ok")


def _check_nats_status() -> HealthCheckDependency:
    """Check NATS connection status."""
    try:
        from src.interfaces.nats_bridge import get_nats_bridge

        bridge = get_nats_bridge()
        if bridge is None:
            return HealthCheckDependency(
                name="nats_connection", status="unavailable",
            )
        connected = bridge._nats.is_connected
        return HealthCheckDependency(
            name="nats_connection",
            status="ok" if connected else "disconnected",
        )
    except Exception as exc:
        logger.debug("NATS connection check failed: %s", exc)
        return HealthCheckDependency(
            name="nats_connection", status="error", detail=str(exc),
        )


@router.get("/health", response_model=DetailedHealthResponse)
async def health_check() -> DetailedHealthResponse:
    """Comprehensive health check with dependency validation."""
    configured = RuntimeConfigStore.get_optional() is not None

    checkers = [
        _check_agent_manager,
        _check_nats,
        _check_scheduler,
        _check_config,
        _check_nats_status,
    ]

    dependencies: dict[str, HealthCheckDependency] = {}
    for checker in checkers:
        dep = checker()
        dependencies[dep.name] = dep

    all_ok = all(d.status == "ok" for d in dependencies.values())
    overall = "ok" if all_ok else "degraded"

    return DetailedHealthResponse(
        status=overall,
        configured=configured,
        dependencies=dependencies,
    )
