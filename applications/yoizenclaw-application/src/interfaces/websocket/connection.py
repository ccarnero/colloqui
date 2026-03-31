"""WebSocket connection and reconnection logic.

Provides connection management utilities for WebSocket client.
"""

import asyncio
import inspect
import json
import logging
from dataclasses import dataclass
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed, InvalidStatus

logger = logging.getLogger(__name__)


@dataclass
class WebSocketConfig:
    """Configuration for WebSocket connection."""

    url: str
    api_key: str
    reconnect_interval: float = 5.0
    heartbeat_interval: float = 30.0


def get_websocket_connect_kwargs(
    headers: dict[str, str],
) -> dict[str, Any]:
    """Build a header argument compatible with the installed websockets version."""

    connect_signature = inspect.signature(websockets.connect)
    if "additional_headers" in connect_signature.parameters:
        return {"additional_headers": headers}

    return {"extra_headers": headers}


async def connect_websocket(config: WebSocketConfig) -> websockets.WebSocketClientProtocol:
    """Establish WebSocket connection to backend.
    
    Args:
        config: WebSocket connection configuration.
        
    Returns:
        Connected WebSocket client protocol.
    """
    headers = {"Authorization": f"Bearer {config.api_key}"}

    websocket = await websockets.connect(
        config.url,
        **get_websocket_connect_kwargs(headers),
    )

    return websocket


async def connection_loop(
    running: bool,
    config: WebSocketConfig,
    connect_func: Any,
    message_handler: Any,
    reconnect_interval: float,
) -> None:
    """Main connection loop with automatic reconnection.
    
    Args:
        running: Whether the connection loop should keep running.
        config: WebSocket configuration.
        connect_func: Async function to call for connecting.
        message_handler: Async function to handle messages.
        reconnect_interval: Seconds to wait before reconnecting.
    """
    while running:
        try:
            await connect_func()
            await message_handler()
        except ConnectionClosed:
            logger.warning("WebSocket connection closed, reconnecting...")
        except InvalidStatus as e:
            logger.error("WebSocket connection failed: %s", e)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("WebSocket error: %s", e)

        if running:
            await asyncio.sleep(reconnect_interval)


async def send_event(
    websocket: websockets.WebSocketClientProtocol | None,
    event: str,
    payload: dict[str, Any],
) -> None:
    """Send an event to the backend.
    
    Args:
        websocket: The WebSocket connection.
        event: Event name.
        payload: Event payload data.
    """
    if websocket:
        message = json.dumps({"event": event, "payload": payload})
        await websocket.send(message)
