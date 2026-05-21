"""NATS message wrapping helpers for legacy envelope format.

Provides wrap_event, wrap_command, wrap_reply, and wrap_error_reply
used by nats_bridge.py and tools/yoizen.py.
"""

from __future__ import annotations

from typing import Any

import uuid
from datetime import datetime, timezone

from envelope import CommandEnvelope, EnvelopeSource


def wrap_event(
    event_type: str,
    payload: dict[str, Any],
    source: EnvelopeSource,
) -> dict[str, Any]:
    """Wrap an event payload in a legacy envelope dict."""
    return {
        "id": str(uuid.uuid4()),
        "kind": "event",
        "source": source.value,
        "type": event_type,
        "data": payload,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def wrap_command(
    command_type: str,
    payload: dict[str, Any],
    source: EnvelopeSource,
) -> dict[str, Any]:
    """Wrap a command payload in a legacy envelope dict."""
    envelope = CommandEnvelope.create(command_type, payload, source)
    return {
        "id": envelope.id,
        "kind": "command",
        "source": envelope.source.value,
        "type": envelope.type,
        "data": envelope.data,
        "timestamp": envelope.timestamp,
    }


def wrap_reply(
    envelope_id: str,
    source: EnvelopeSource,
    data: dict[str, Any],
) -> dict[str, Any]:
    """Wrap a reply payload in a legacy envelope dict."""
    return {
        "id": str(uuid.uuid4()),
        "correlation_id": envelope_id,
        "kind": "reply",
        "source": source.value,
        "success": True,
        "data": data,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def wrap_error_reply(
    envelope_id: str,
    source: EnvelopeSource,
    error_code: str,
    error_message: str,
) -> dict[str, Any]:
    """Wrap an error reply in a legacy envelope dict."""
    return {
        "id": str(uuid.uuid4()),
        "correlation_id": envelope_id,
        "kind": "reply",
        "source": source.value,
        "success": False,
        "error": {
            "code": error_code,
            "message": error_message,
        },
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
