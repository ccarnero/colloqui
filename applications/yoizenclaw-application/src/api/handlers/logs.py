"""Logs handler for YoizenClaw API."""

import logging
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.utils.logging.log_handlers import get_log_handler, get_access_log_handler

logger = logging.getLogger(__name__)


router = APIRouter()


class LogEntry(BaseModel):
    """Single log entry model."""
    id: str
    timestamp: str
    level: str
    message: str
    name: str | None = None


class AccessLogEntry(BaseModel):
    """Single access log entry model."""
    id: str
    timestamp: str
    level: str
    message: str
    name: str | None = None


class LogsResponse(BaseModel):
    """Response model for logs endpoint."""
    logs: list[LogEntry]
    total: int


class AccessLogsResponse(BaseModel):
    """Response model for access logs endpoint."""
    logs: list[AccessLogEntry]
    total: int


LEVEL_MAP: dict[str, int] = {
    "DEBUG": logging.DEBUG,
    "INFO": logging.INFO,
    "WARNING": logging.WARNING,
    "WARN": logging.WARNING,
    "ERROR": logging.ERROR,
    "CRITICAL": logging.CRITICAL,
}


_LOG_LEVELS = Literal["DEBUG", "INFO", "WARNING", "WARN", "ERROR", "CRITICAL", "all",
                "debug", "info", "warning", "warn", "error", "critical"]

@router.get("/logs", response_model=LogsResponse)
async def get_logs(level: _LOG_LEVELS = "all") -> LogsResponse:
    """Get application logs.
    
    Args:
        level: Filter logs by level (DEBUG, INFO, WARNING, ERROR, all)
        
    Returns:
        List of log entries with timestamp, level, and message.
    """
    try:
        handler = get_log_handler()
        min_level = LEVEL_MAP.get(level.upper(), logging.DEBUG) if level != "all" else logging.DEBUG
        raw_logs = handler.get_logs(min_level)
        
        logs = [
            LogEntry(
                id=log["id"],
                timestamp=log["timestamp"],
                level=log["level"],
                message=log["message"],
                name=log.get("name"),
            )
            for log in raw_logs
        ]
        
        return LogsResponse(logs=logs, total=len(logs))
    except Exception as e:
        logger.exception("Failed to retrieve logs: %s", e)
        raise HTTPException(status_code=500, detail={"error": "LOG_RETRIEVAL_ERROR", "message": str(e)})


@router.get("/logs/access", response_model=AccessLogsResponse)
async def get_access_logs(
    level: _LOG_LEVELS = "all"
) -> AccessLogsResponse:
    """Get HTTP access logs.
    
    Args:
        level: Filter logs by level (DEBUG, INFO, WARNING, ERROR, all)
        
    Returns:
        List of access log entries with request/response details.
    """
    try:
        handler = get_access_log_handler()
        min_level = LEVEL_MAP.get(level.upper(), logging.DEBUG) if level != "all" else logging.DEBUG
        raw_logs = handler.get_logs(min_level)
        
        logs = [
            AccessLogEntry(
                id=log["id"],
                timestamp=log["timestamp"],
                level=log["level"],
                message=log["message"],
                name=log.get("name"),
            )
            for log in raw_logs
        ]
        
        return AccessLogsResponse(logs=logs, total=len(logs))
    except Exception as e:
        logger.exception("Failed to retrieve access logs: %s", e)
        raise HTTPException(status_code=500, detail={"error": "ACCESS_LOG_RETRIEVAL_ERROR", "message": str(e)})
