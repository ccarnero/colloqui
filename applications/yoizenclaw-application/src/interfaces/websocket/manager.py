"""WebSocket client for receiving dynamic configuration from backend.

This module manages the WebSocket connection to the Yoizen backend,
receiving real-time configuration updates and applying them to the runtime.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed, InvalidStatus

from src.jobs.domain.entities import (
    JobDefinition,
    JobEventPayload,
    JobSyncPayload,
    JobTriggerPayload,
)
from src.interfaces.websocket.config_store import (
    AgentPersonality,
    ConfigurationError,
    LLMConfig,
    RequiredFieldMissingError,
    RuntimeConfigStore,
    RuntimeConfiguration,
    RuntimeNotConfiguredError,
)
from src.interfaces.websocket.connection import get_websocket_connect_kwargs
from src.shared.errors.job import JobError

logger = logging.getLogger(__name__)


@dataclass
class WebSocketConfig:
    """Configuration for WebSocket connection."""

    url: str
    api_key: str
    reconnect_interval: float = 5.0
    heartbeat_interval: float = 30.0


class ConfigWebSocketManager:
    """Manages WebSocket connection to backend for dynamic configuration."""

    def __init__(self, config: WebSocketConfig):
        self.config = config
        self.websocket: websockets.WebSocketClientProtocol | None = None
        self._running = False
        self._reconnect_task: asyncio.Task | None = None
        self._heartbeat_task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the WebSocket connection manager."""
        self._running = True
        self._reconnect_task = asyncio.create_task(self._connection_loop())
        logger.info("WebSocket manager started for %s", self.config.url)

    async def stop(self) -> None:
        """Stop the WebSocket connection manager."""
        self._running = False

        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass

        if self._reconnect_task:
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass

        if self.websocket:
            await self.websocket.close()

        logger.info("WebSocket manager stopped")

    async def _connection_loop(self) -> None:
        """Main connection loop with automatic reconnection."""
        while self._running:
            try:
                await self._connect()
                await self._handle_messages()
            except ConnectionClosed:
                logger.warning("WebSocket connection closed, reconnecting...")
            except InvalidStatus as e:
                logger.error("WebSocket connection failed: %s", e)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("WebSocket error: %s", e)

            if self._running:
                await asyncio.sleep(self.config.reconnect_interval)

    async def _connect(self) -> None:
        """Establish WebSocket connection."""
        headers = {"Authorization": f"Bearer {self.config.api_key}"}

        self.websocket = await websockets.connect(
            self.config.url,
            **get_websocket_connect_kwargs(headers),
        )

        await self._send_event("runtime:connected", {
            "version": "0.1.0",
            "status": "ready_for_config",
            "configured": RuntimeConfigStore.get_optional() is not None,
        })

        logger.info("WebSocket connected to backend")

        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())

    async def _handle_messages(self) -> None:
        """Handle incoming WebSocket messages."""
        while self._running and self.websocket:
            try:
                message = await self.websocket.recv()
                await self._process_message(message)
            except ConnectionClosed:
                break

    async def _process_message(self, message: str) -> None:
        """Process a WebSocket message from backend."""
        try:
            data = json.loads(message)
            event = data.get("event")
            payload = data.get("payload", {})

            if event == "config:full_sync":
                await self._handle_full_sync(payload)
            elif event == "config:update":
                await self._handle_config_update(payload)
            elif event == "agent:reload":
                await self._handle_agent_reload(payload)
            elif event == "config:jobs_sync":
                await self._handle_jobs_sync(payload)
            elif event == "job:trigger":
                await self._handle_job_trigger(payload)
            elif event == "job:event":
                await self._handle_job_event(payload)
            elif event == "job:cancel":
                await self._handle_job_cancel(payload)
            elif event == "job:enable":
                await self._handle_job_enable(payload)
            elif event == "job:disable":
                await self._handle_job_disable(payload)

        except json.JSONDecodeError as e:
            logger.error("Invalid JSON in WebSocket message: %s", e)
        except (ConnectionError, RuntimeError) as e:
            logger.error("Error processing WebSocket message: %s", e)

    async def _handle_full_sync(self, payload: dict[str, Any]) -> None:
        """Handle full configuration sync from backend."""
        try:
            from src.application.memory.memory_sync import apply_runtime_config_sync

            await apply_runtime_config_sync(
                files=_coerce_sync_files(payload.get("files")),
                delete_paths=_coerce_delete_paths(payload.get("deletePaths")),
            )
            await self._send_event("runtime:config_applied", {
                "timestamp": asyncio.get_event_loop().time(),
                "status": "success",
            })
        except (ConfigurationError, RuntimeError) as e:
            logger.error("Configuration error: %s", e)
            await self._send_event("runtime:error", {
                "type": "configuration_error",
                "message": str(e)
            })

    async def _handle_config_update(self, payload: dict[str, Any]) -> None:
        """Handle an incremental runtime file sync."""

        try:
            from src.application.memory.memory_sync import apply_runtime_config_sync

            await apply_runtime_config_sync(
                files=_coerce_sync_files(payload.get("files")),
                delete_paths=_coerce_delete_paths(payload.get("deletePaths")),
            )
            await self._send_event("runtime:config_applied", {
                "timestamp": asyncio.get_event_loop().time(),
                "status": "success",
            })
        except (ConfigurationError, RuntimeError) as e:
            logger.error("Configuration update error: %s", e)
            await self._send_event("runtime:error", {
                "type": "configuration_error",
                "message": str(e),
            })

    @staticmethod
    def _set_nested_value(d: dict, path: str, value: Any) -> None:
        """Set a value in a nested dictionary using dot notation."""
        keys = path.split(".")
        for key in keys[:-1]:
            d = d.setdefault(key, {})
        d[keys[-1]] = value

    async def _handle_agent_reload(self, payload: dict[str, Any]) -> None:
        """Handle agent reload request."""
        agent_id = payload.get("agent_id")
        logger.info("Reloading agent: %s", agent_id)

    async def _handle_jobs_sync(self, payload: dict[str, Any]) -> None:
        """Handle job configuration sync from backend."""
        try:
            from src.jobs.scheduler import get_job_scheduler

            scheduler = get_job_scheduler()
            if not scheduler:
                logger.error("Job scheduler not initialized")
                await self._send_event("runtime:error", {
                    "type": "job_scheduler_not_initialized",
                    "message": "Job scheduler is not available",
                })
                return

            jobs_data = payload.get("jobs", [])
            jobs = [JobDefinition(**job_data) for job_data in jobs_data]

            sync_payload = JobSyncPayload(
                jobs=jobs,
                replace_all=payload.get("replace_all", True),
            )

            result = await scheduler.sync_jobs(sync_payload)

            await self._send_event("runtime:jobs_applied", {
                "timestamp": asyncio.get_event_loop().time(),
                "result": result,
            })

        except Exception as e:
            logger.error("Job sync error: %s", e)
            await self._send_event("runtime:error", {
                "type": "job_sync_error",
                "message": str(e),
            })

    async def _handle_job_trigger(self, payload: dict[str, Any]) -> None:
        """Handle manual job trigger request."""
        try:
            from src.jobs.scheduler import get_job_scheduler

            scheduler = get_job_scheduler()
            if not scheduler:
                logger.error("Job scheduler not initialized")
                return

            trigger_payload = JobTriggerPayload(**payload)
            execution = await scheduler.trigger_job(
                trigger_payload.job_id,
                trigger_payload.event_payload,
            )

            if execution:
                await self._send_event("job:triggered", {
                    "execution_id": execution.id,
                    "job_id": execution.job_id,
                    "status": execution.status,
                })
            else:
                await self._send_event("runtime:error", {
                    "type": "job_not_found",
                    "message": f"Job {trigger_payload.job_id} not found",
                })

        except Exception as e:
            logger.error("Job trigger error: %s", e)
            await self._send_event("runtime:error", {
                "type": "job_trigger_error",
                "message": str(e),
            })

    async def _handle_job_event(self, payload: dict[str, Any]) -> None:
        """Handle event-driven job emission request."""
        try:
            from src.jobs.scheduler import get_job_scheduler

            scheduler = get_job_scheduler()
            if not scheduler:
                logger.error("Job scheduler not initialized")
                return

            event_payload = JobEventPayload(**payload)
            triggered_jobs = await scheduler.emit_event(
                event_payload.event_name,
                event_payload.event_payload,
            )

            await self._send_event("job:event_emitted", {
                "event_name": event_payload.event_name,
                "triggered_jobs": triggered_jobs,
            })

        except Exception as e:
            logger.error("Job event error: %s", e)
            await self._send_event("runtime:error", {
                "type": "job_event_error",
                "message": str(e),
            })

    async def _handle_job_cancel(self, payload: dict[str, Any]) -> None:
        """Handle job cancel request."""
        try:
            from src.jobs.scheduler import get_job_scheduler

            scheduler = get_job_scheduler()
            if not scheduler:
                logger.error("Job scheduler not initialized")
                return

            execution_id = payload.get("execution_id")
            logger.info("Cancel requested for execution: %s", execution_id)

            await self._send_event("job:cancelled", {
                "execution_id": execution_id,
            })

        except Exception as e:
            logger.error("Job cancel error: %s", e)
            await self._send_event("runtime:error", {
                "type": "job_cancel_error",
                "message": str(e),
            })

    async def _handle_job_enable(self, payload: dict[str, Any]) -> None:
        """Handle job enable request."""
        try:
            from src.jobs.scheduler import get_job_scheduler

            scheduler = get_job_scheduler()
            if not scheduler:
                logger.error("Job scheduler not initialized")
                return

            job_id = payload.get("job_id")
            success = await scheduler.enable_job(job_id)

            await self._send_event("job:enabled", {
                "job_id": job_id,
                "success": success,
            })

        except Exception as e:
            logger.error("Job enable error: %s", e)
            await self._send_event("runtime:error", {
                "type": "job_enable_error",
                "message": str(e),
            })

    async def _handle_job_disable(self, payload: dict[str, Any]) -> None:
        """Handle job disable request."""
        try:
            from src.jobs.scheduler import get_job_scheduler

            scheduler = get_job_scheduler()
            if not scheduler:
                logger.error("Job scheduler not initialized")
                return

            job_id = payload.get("job_id")
            success = await scheduler.disable_job(job_id)

            await self._send_event("job:disabled", {
                "job_id": job_id,
                "success": success,
            })

        except Exception as e:
            logger.error("Job disable error: %s", e)
            await self._send_event("runtime:error", {
                "type": "job_disable_error",
                "message": str(e),
            })

    async def _heartbeat_loop(self) -> None:
        """Send periodic heartbeat messages."""
        while self._running and self.websocket:
            try:
                await asyncio.sleep(self.config.heartbeat_interval)
                if self.websocket:
                    await self._send_event("runtime:heartbeat", {
                        "timestamp": asyncio.get_event_loop().time()
                    })
            except ConnectionClosed:
                break
            except asyncio.CancelledError:
                break
            except (ConnectionError, RuntimeError) as e:
                logger.error("Heartbeat error: %s", e)

    async def _send_event(self, event: str, payload: dict[str, Any]) -> None:
        """Send an event to the backend."""
        if self.websocket:
            message = json.dumps({"event": event, "payload": payload})
            await self.websocket.send(message)


async def start_websocket_manager(url: str, api_key: str) -> ConfigWebSocketManager:
    """Start the global WebSocket manager."""
    from src.shared.di import AppContainer

    config = WebSocketConfig(url=url, api_key=api_key)
    manager = ConfigWebSocketManager(config)
    await manager.start()
    AppContainer.get().websocket_manager = manager

    return manager


async def stop_websocket_manager() -> None:
    """Stop the global WebSocket manager."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.websocket_manager:
        await container.websocket_manager.stop()
    container.websocket_manager = None


def get_websocket_manager() -> ConfigWebSocketManager | None:
    """Get the global WebSocket manager instance."""
    from src.shared.di import AppContainer

    return AppContainer.get().websocket_manager


def _coerce_sync_files(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []

    normalized_files: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        path = item.get("path")
        content = item.get("content")
        if not isinstance(path, str) or not isinstance(content, str):
            continue

        normalized_files.append({"path": path, "content": content})

    return normalized_files


def _coerce_delete_paths(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    return [item for item in value if isinstance(item, str)]
