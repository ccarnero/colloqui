"""CloudEvents envelope builder for internal agent messaging.

Compliant with wdocs/02-diseño-de-mensajes.md CloudEvents spec.
Agent Admin Service operates as an internal agent (transport.protocol="internal").
"""

from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional


REQUIRED_STRING_FIELDS: frozenset[str] = frozenset(
    {
        "specversion",
        "id",
        "source",
        "type",
        "resource",
        "time",
        "traceid",
        "tenant",
        "accountid",
        "idempotencykey",
    }
)

REQUIRED_TRANSPORT_FIELDS: frozenset[str] = frozenset(
    {
        "protocol",
        "depth",
    }
)


@dataclass
class CloudEventEnvelope:
    specversion: str = "1.0"
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    source: str = ""
    type: str = ""
    resource: str = ""
    time: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
    )
    traceid: str = field(default_factory=lambda: str(uuid.uuid4()))
    causation_id: Optional[str] = None
    correlation_id: str = ""
    tenant: str = ""
    producer: str = "agent-admin-service"
    domain: str = "messaging"
    channel: str = ""
    provider: str = "internal"
    accountid: str = "platform-admin"
    idempotencykey: str = ""
    transport: dict[str, Any] = field(default_factory=dict)
    data: dict[str, Any] = field(default_factory=dict)


def calculate_checksum(payload: dict[str, Any]) -> str:
    """Calculate SHA256 checksum for payload using canonical JSON."""
    import hashlib
    import json
    
    canonical = json.dumps(payload, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode()).hexdigest()


def build_data_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Build data payload with envelope metadata."""
    serialized = json.dumps(payload, sort_keys=True, separators=(',', ':'))
    
    return {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "payload_inline": True,
        "payload_ref": None,
        "payload_bytes": len(serialized.encode('utf-8')),
        "payload_checksum": calculate_checksum(payload),
        "payload": payload,
    }


def build_internal_agent_envelope(
    tenant: str,
    agent_id: str,
    action: str,
    payload: dict[str, Any],
    causation_id: Optional[str] = None,
    correlation_id: str = "",
    depth: int = 0,
    channel: str = "",
    capabilities: list[str] | None = None,
) -> CloudEventEnvelope:
    """Build a CloudEvents envelope for internal agent messages."""
    return CloudEventEnvelope(
        id=str(uuid.uuid4()),
        source=f"/services/agent-admin-service/agents/{agent_id}",
        type=f"io.yoizen.agent-admin-service.agent.{action}.v1",
        resource=f"tenant/{tenant}/agents/{agent_id}",
        tenant=tenant,
        traceid=str(uuid.uuid4()),
        causation_id=causation_id,
        correlation_id=correlation_id,
        channel=channel,
        idempotencykey=f"sha256:{calculate_checksum(payload)}",
        transport={
            "method": "agent",
            "protocol": "internal",
            "agent_id": agent_id,
            "agent_capabilities": capabilities or ["reply", "classify"],
            "depth": depth,
        },
        data=build_data_payload(payload),
    )


def validate_envelope(envelope: dict[str, Any] | CloudEventEnvelope) -> bool:
    """Validate CloudEvents envelope structure and required fields."""
    if isinstance(envelope, CloudEventEnvelope):
        data = asdict(envelope)
    elif isinstance(envelope, dict):
        data = envelope
    else:
        return False

    if not isinstance(data, dict):
        return False

    # Validate required string fields
    for field_name in REQUIRED_STRING_FIELDS:
        value = data.get(field_name)
        if not isinstance(value, str) or not value:
            return False

    # Validate transport object
    transport = data.get("transport")
    if not isinstance(transport, dict):
        return False

    for field_name in REQUIRED_TRANSPORT_FIELDS:
        if field_name not in transport:
            return False

    return True
