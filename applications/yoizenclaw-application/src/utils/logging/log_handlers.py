"""Logging handlers for YoizenClaw.

Uses structured JSON logging to stdout and an in-memory ring buffer
for the /logs endpoint.
"""

import logging

from .structured_logger import (
    get_logger,
    JSONFormatter,
    InMemoryRingBufferHandler,
    get_ring_buffer_handler,
    get_access_ring_buffer_handler,
)

__all__ = ["get_logger", "JSONFormatter", "InMemoryRingBufferHandler"]


def get_log_handler() -> InMemoryRingBufferHandler:
    """Return the in-memory ring buffer handler for application logs."""
    handler = get_ring_buffer_handler()
    if handler is None:
        raise RuntimeError(
            "Logging not initialised yet. Call init_logging() at startup."
        )
    return handler


def get_access_log_handler() -> InMemoryRingBufferHandler:
    """Return the in-memory ring buffer handler for access logs."""
    handler = get_access_ring_buffer_handler()
    if handler is None:
        raise RuntimeError(
            "Logging not initialised yet. Call init_logging() at startup."
        )
    return handler
