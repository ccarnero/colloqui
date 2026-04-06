"""NATS messaging utilities and helpers."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)


class _DateTimeEncoder(json.JSONEncoder):
    def default(self, o: Any) -> Any:
        if isinstance(o, datetime):
            return o.isoformat()
        return super().default(o)


def json_dumps(payload: dict[str, Any]) -> bytes:
    """Serialize dict to JSON bytes."""
    return json.dumps(payload, cls=_DateTimeEncoder).encode("utf-8")


def json_loads(data: bytes) -> dict[str, Any]:
    """Deserialize JSON bytes to dict."""
    value = json.loads(data.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("NATS payload must be a JSON object")
    return value


def unwrap_event_data(raw: dict[str, Any]) -> dict[str, Any]:
    """Extract event data from envelope."""
    if raw.get("kind") == "event" and "data" in raw:
        data = raw["data"]
        if isinstance(data, dict):
            return data
    return raw


def unwrap_command_data(raw: dict[str, Any]) -> tuple[dict[str, Any], str]:
    """Extract command data and envelope ID from envelope."""
    if raw.get("kind") == "command" and "data" in raw:
        data = raw["data"]
        envelope_id = raw.get("id", "unknown")
        if isinstance(data, dict):
            return data, envelope_id
    return raw, "unknown"


def extract_action_from_subject(subject: str) -> str | None:
    """Extract the action from wdocs-compliant subjects.

    Admin-service format (8 parts): evt.tenant.producer.domain.channel.provider.kind.v1
    Example: 'evt.acme.yoizenclaw-admin-service.automation.yoizenclaw.internal.agent_published.v1'
    Returns: 'agent_published'

    Runtime format (5-7 parts): evt.tenant.yoizenclaw.<action_parts...>.v1
    Example: 'evt.acme.yoizenclaw.online.v1'
    Returns: 'online'

    Example: 'evt.acme.yoizenclaw.agent.outbound.v1'
    Returns: 'agent_outbound'
    """
    parts = subject.split(".")
    if parts[0] != "evt":
        return None

    # Handle admin-service subjects (8 parts)
    if len(parts) >= 8:
        return parts[6]

    # Handle runtime subjects: action is parts[3:-1] joined with _
    # e.g. config_sync.v1 -> config_sync
    # e.g. agent.outbound.v1 -> agent_outbound
    # e.g. job.execution_status.v1 -> job_execution_status
    if len(parts) >= 5:
        action_parts = parts[3:-1]
        return "_".join(action_parts)

    return None


def coerce_sync_files(value: Any) -> list[dict[str, str]]:
    """Normalize sync files from payload."""
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        path = item.get("path")
        content = item.get("content")
        if isinstance(path, str) and isinstance(content, str):
            normalized_item: dict[str, str] = {
                "path": path,
                "content": content,
            }

            raw_format = item.get("format")
            if isinstance(raw_format, str) and raw_format.strip():
                normalized_item["format"] = raw_format

            normalized.append(normalized_item)

    return normalized


def coerce_delete_paths(value: Any) -> list[str]:
    """Normalize delete paths from payload."""
    if not isinstance(value, list):
        return []

    return [item for item in value if isinstance(item, str)]


def resolve_reply_subject(
    message: Any,
    data: dict[str, Any] | None = None,
) -> str | None:
    """Resolve the request/reply inbox for runtime handlers.

    For JetStream deliveries, ``message.reply`` can be an ACK subject
    (e.g. ``$JS.ACK...``) instead of the original request inbox. In that
    case we read the explicit header emitted by admin-service.
    """

    headers = getattr(message, "headers", None)
    if headers is not None:
        for key in (
            "x-reply-to",
            "X-Reply-To",
            "x-yoizen-reply-to",
            "Nats-Msg-Reply",
            "Nats-Msg-Reply-To",
        ):
            value = headers.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    if data is not None:
        payload_reply = data.get("reply_to")
        if isinstance(payload_reply, str) and payload_reply.strip():
            return payload_reply.strip()

    reply = getattr(message, "reply", None)
    if not isinstance(reply, str):
        return None

    normalized = reply.strip()
    if not normalized:
        return None

    if normalized.startswith("$JS.ACK."):
        return None

    return normalized
