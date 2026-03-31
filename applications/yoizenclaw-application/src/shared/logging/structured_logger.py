"""
Simple structured logging with correlation IDs.
Writes JSON to stdout and keeps an in-memory ring buffer for the /logs endpoint.
"""

import logging
import sys
import json
import uuid
from collections import deque
from datetime import datetime
from threading import Lock
from typing import Any, Dict, Optional
from contextvars import ContextVar
import os

# Context variable for correlation ID
correlation_id_var: ContextVar[str] = ContextVar('correlation_id', default='')


class JSONFormatter(logging.Formatter):
    """Format logs as JSON with correlation ID."""
    
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'service': os.getenv('SERVICE_NAME', 'yoizen-claw'),
            'environment': os.getenv('ENVIRONMENT', 'development'),
            'trace_id': correlation_id_var.get(),
            'source': {
                'file': record.filename,
                'line': record.lineno,
                'function': record.funcName,
            }
        }
        
        # Add exception info if present
        if record.exc_info:
            log_data['exception'] = {
                'type': record.exc_info[0].__name__ if record.exc_info[0] else None,
                'message': str(record.exc_info[1]) if record.exc_info[1] else None,
            }
        
        # Add extra fields
        for key, value in record.__dict__.items():
            if key not in {
                'name', 'msg', 'args', 'levelname', 'levelno', 'pathname',
                'filename', 'module', 'exc_info', 'exc_text', 'stack_info',
                'lineno', 'funcName', 'created', 'msecs', 'relativeCreated',
                'thread', 'threadName', 'processName', 'process', 'getMessage'
            }:
                log_data[key] = value
        
        return json.dumps(log_data, default=str)


class InMemoryRingBufferHandler(logging.Handler):
    """Thread-safe ring buffer that captures the last N log entries.

    Attached alongside the StreamHandler so the /logs endpoint can
    serve recent entries without requiring Loki or promtail.
    """

    def __init__(self, capacity: int = 500) -> None:
        super().__init__()
        self._buffer: deque[Dict[str, Any]] = deque(maxlen=capacity)
        self._lock = Lock()

    def emit(self, record: logging.LogRecord) -> None:
        try:
            formatted = self.format(record)
            entry = json.loads(formatted)
            entry["id"] = str(uuid.uuid4())
            with self._lock:
                self._buffer.append(entry)
        except Exception:
            self.handleError(record)

    def get_logs(self, min_level: int = logging.DEBUG) -> list[Dict[str, Any]]:
        """Return buffered entries at or above *min_level*, newest-last."""
        level_no = {
            "DEBUG": logging.DEBUG,
            "INFO": logging.INFO,
            "WARNING": logging.WARNING,
            "ERROR": logging.ERROR,
            "CRITICAL": logging.CRITICAL,
        }
        with self._lock:
            return [
                e for e in self._buffer
                if level_no.get(e.get("level", "DEBUG"), logging.DEBUG) >= min_level
            ]


# Module-level singletons — one for app logs, one for access logs
_app_handler: InMemoryRingBufferHandler | None = None
_access_handler: InMemoryRingBufferHandler | None = None


def get_ring_buffer_handler() -> InMemoryRingBufferHandler | None:
    """Return the app-level ring buffer handler (set during init_logging)."""
    return _app_handler


def get_access_ring_buffer_handler() -> InMemoryRingBufferHandler | None:
    """Return the access-level ring buffer handler (set during init_logging)."""
    return _access_handler


def get_correlation_id() -> str:
    """Get current correlation ID or generate new one."""
    cid = correlation_id_var.get()
    if not cid:
        cid = str(uuid.uuid4())
        correlation_id_var.set(cid)
    return cid


def set_correlation_id(cid: str) -> None:
    """Set correlation ID for current context."""
    correlation_id_var.set(cid)


def init_logging(service_name: str = 'yoizen-claw', log_level: str = 'INFO') -> logging.Logger:
    """Initialize structured logging.

    Args:
        service_name: Name of the service for logs
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR)

    Returns:
        Configured logger
    """
    global _app_handler, _access_handler

    # Set service name in env for formatter
    os.environ['SERVICE_NAME'] = service_name

    # Configure root logger
    logger = logging.getLogger()
    logger.setLevel(getattr(logging, log_level.upper()))

    # Remove existing handlers
    for handler in logger.handlers[:]:
        logger.removeHandler(handler)

    formatter = JSONFormatter()

    # Console handler with JSON formatting
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    # In-memory ring buffer for /logs endpoint
    _app_handler = InMemoryRingBufferHandler(capacity=500)
    _app_handler.setFormatter(formatter)
    logger.addHandler(_app_handler)

    # Separate access ring buffer (only for uvicorn.access logger)
    _access_handler = InMemoryRingBufferHandler(capacity=200)
    _access_handler.setFormatter(formatter)
    access_logger = logging.getLogger('uvicorn.access')
    access_logger.handlers = [console_handler, _access_handler]

    return logger


# Convenience function for getting logger
get_logger = logging.getLogger
