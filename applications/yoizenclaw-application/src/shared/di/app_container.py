"""Application-wide singleton container.

Centralizes module-level mutable globals into a single, typed container
for testability, lifecycle management, and thread-safety.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import httpx
    from nats.aio.client import Client as NATS

    from src.interfaces.nats_bridge import RuntimeNatsBridge
    from src.interfaces.websocket.manager import ConfigWebSocketManager
    from src.jobs.scheduler_core import JobScheduler
    from src.shared.adapter_client import AdapterClient
    from src.shared.config.tools import ToolRegistry
    from src.shared.logging.log_handlers import (
        AccessLogHandler,
        InMemoryLogHandler,
    )
    from src.shared.utils.runtime_config import RuntimeConfigRepository
    from src.tools.adapter_executor import AdapterToolExecutor


class AppContainer:
    """Typed container for all application-wide singleton instances.

    Access via ``AppContainer.get()``.  Each attribute is a property so
    consumers can read/write through the container while the underlying
    module-level ``get_X()`` helpers continue to work via delegation.
    """

    _instance: AppContainer | None = None

    def __init__(self) -> None:
        self._job_scheduler: JobScheduler | None = None
        self._websocket_manager: ConfigWebSocketManager | None = None
        self._nats_bridge: RuntimeNatsBridge | None = None
        self._webhook_client: httpx.AsyncClient | None = None
        self._pipeline_http_client: httpx.AsyncClient | None = None
        self._default_tool_registry: ToolRegistry | None = None
        self._runtime_config_repository: RuntimeConfigRepository | None = None
        self._yoizen_http_client: httpx.AsyncClient | None = None
        self._yoizen_nats_client: NATS | None = None
        self._in_memory_handler: InMemoryLogHandler | None = None
        self._access_log_handler: AccessLogHandler | None = None
        self._adapter_client: AdapterClient | None = None
        self._adapter_tool_executor: AdapterToolExecutor | None = None

    @classmethod
    def get(cls) -> AppContainer:
        """Return the singleton ``AppContainer`` instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset(cls) -> None:
        """Drop the singleton instance (useful in tests)."""
        cls._instance = None

    # -- job_scheduler --------------------------------------------------

    @property
    def job_scheduler(self) -> JobScheduler | None:
        return self._job_scheduler

    @job_scheduler.setter
    def job_scheduler(self, value: JobScheduler | None) -> None:
        self._job_scheduler = value

    # -- websocket_manager ----------------------------------------------

    @property
    def websocket_manager(self) -> ConfigWebSocketManager | None:
        return self._websocket_manager

    @websocket_manager.setter
    def websocket_manager(self, value: ConfigWebSocketManager | None) -> None:
        self._websocket_manager = value

    # -- nats_bridge ----------------------------------------------------

    @property
    def nats_bridge(self) -> RuntimeNatsBridge | None:
        return self._nats_bridge

    @nats_bridge.setter
    def nats_bridge(self, value: RuntimeNatsBridge | None) -> None:
        self._nats_bridge = value

    # -- webhook_client -------------------------------------------------

    @property
    def webhook_client(self) -> httpx.AsyncClient | None:
        return self._webhook_client

    @webhook_client.setter
    def webhook_client(self, value: httpx.AsyncClient | None) -> None:
        self._webhook_client = value

    # -- pipeline_http_client -------------------------------------------

    @property
    def pipeline_http_client(self) -> httpx.AsyncClient | None:
        return self._pipeline_http_client

    @pipeline_http_client.setter
    def pipeline_http_client(self, value: httpx.AsyncClient | None) -> None:
        self._pipeline_http_client = value

    # -- default_tool_registry ------------------------------------------

    @property
    def default_tool_registry(self) -> ToolRegistry | None:
        return self._default_tool_registry

    @default_tool_registry.setter
    def default_tool_registry(self, value: ToolRegistry | None) -> None:
        self._default_tool_registry = value

    # -- runtime_config_repository --------------------------------------

    @property
    def runtime_config_repository(self) -> RuntimeConfigRepository | None:
        return self._runtime_config_repository

    @runtime_config_repository.setter
    def runtime_config_repository(
        self,
        value: RuntimeConfigRepository | None,
    ) -> None:
        self._runtime_config_repository = value

    # -- yoizen_http_client ---------------------------------------------

    @property
    def yoizen_http_client(self) -> httpx.AsyncClient | None:
        return self._yoizen_http_client

    @yoizen_http_client.setter
    def yoizen_http_client(self, value: httpx.AsyncClient | None) -> None:
        self._yoizen_http_client = value

    # -- yoizen_nats_client ---------------------------------------------

    @property
    def yoizen_nats_client(self) -> NATS | None:
        return self._yoizen_nats_client

    @yoizen_nats_client.setter
    def yoizen_nats_client(self, value: NATS | None) -> None:
        self._yoizen_nats_client = value

    # -- in_memory_handler ----------------------------------------------

    @property
    def in_memory_handler(self) -> InMemoryLogHandler | None:
        return self._in_memory_handler

    @in_memory_handler.setter
    def in_memory_handler(self, value: InMemoryLogHandler | None) -> None:
        self._in_memory_handler = value

    # -- access_log_handler ---------------------------------------------

    @property
    def access_log_handler(self) -> AccessLogHandler | None:
        return self._access_log_handler

    @access_log_handler.setter
    def access_log_handler(self, value: AccessLogHandler | None) -> None:
        self._access_log_handler = value

    # -- adapter_client -------------------------------------------------

    @property
    def adapter_client(self) -> AdapterClient | None:
        return self._adapter_client

    @adapter_client.setter
    def adapter_client(self, value: AdapterClient | None) -> None:
        self._adapter_client = value

    # -- adapter_tool_executor ------------------------------------------

    @property
    def adapter_tool_executor(self) -> AdapterToolExecutor | None:
        return self._adapter_tool_executor

    @adapter_tool_executor.setter
    def adapter_tool_executor(self, value: AdapterToolExecutor | None) -> None:
        self._adapter_tool_executor = value
