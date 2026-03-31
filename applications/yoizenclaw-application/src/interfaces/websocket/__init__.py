"""WebSocket interface compatibility layer for YoizenClaw."""

from __future__ import annotations

from importlib import import_module
from typing import Any

_LAZY_EXPORTS: dict[str, str] = {
    "ConfigurationError": "src.interfaces.websocket.config_store",
    "RuntimeNotConfiguredError": "src.interfaces.websocket.config_store",
    "RequiredFieldMissingError": "src.interfaces.websocket.config_store",
    "AgentPersonality": "src.interfaces.websocket.config_store",
    "LLMConfig": "src.interfaces.websocket.config_store",
    "RuntimeConfiguration": "src.interfaces.websocket.config_store",
    "RuntimeConfigStore": "src.interfaces.websocket.config_store",
    "WebSocketConfig": "src.interfaces.websocket.manager",
    "ConfigWebSocketManager": "src.interfaces.websocket.manager",
    "start_websocket_manager": "src.interfaces.websocket.manager",
    "stop_websocket_manager": "src.interfaces.websocket.manager",
    "get_websocket_manager": "src.interfaces.websocket.manager",
    "get_websocket_connect_kwargs": "src.interfaces.websocket.connection",
}

__all__ = list(_LAZY_EXPORTS)


def __getattr__(name: str) -> Any:
    """Resolve websocket compatibility exports on demand."""

    module_path = _LAZY_EXPORTS.get(name)
    if module_path is None:
        raise AttributeError(
            f"module 'src.interfaces.websocket' has no attribute '{name}'",
        )

    module = import_module(module_path)
    value = getattr(module, name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    """Return the module namespace for interactive use."""

    return sorted({*globals(), *_LAZY_EXPORTS})
