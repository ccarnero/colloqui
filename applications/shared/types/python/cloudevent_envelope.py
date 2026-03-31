"""CloudEvents envelope builder for internal agent messaging.

Compliant with wdocs/02-diseño-de-mensajes.md CloudEvents spec.
YoizenClaw operates as an internal agent (transport.protocol="internal").
"""

from __future__ import annotations

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
        "time",
        "traceid",
        "tenant",
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
    time: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(),
    )
    traceid: str = field(default_factory=lambda: str(uuid.uuid4()))
    causation_id: Optional[str] = None
    correlation_id: str = ""
    tenant: str = ""
    producer: str = "yoizenclaw"
    domain: str = "messaging"
    channel: str = ""
    provider: str = "internal"
    transport: dict[str, Any] = field(default_factory=dict)
    data: dict[str, Any] = field(default_factory=dict)


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
    return CloudEventEnvelope(
        source=f"/services/yoizenclaw/agents/{agent_id}",
        type=f"io.yoizen.yoizenclaw.agent.{action}.v1",
        tenant=tenant,
        causation_id=causation_id,
        correlation_id=correlation_id,
        channel=channel,
        transport={
            "method": "agent",
            "protocol": "internal",
            "agent_id": agent_id,
            "agent_capabilities": capabilities or ["reply", "classify"],
            "depth": depth,
        },
        data=payload,
    )


def validate_envelope(envelope: dict[str, Any] | CloudEventEnvelope) -> bool:
    if isinstance(envelope, CloudEventEnvelope):
        data = asdict(envelope)
    elif isinstance(envelope, dict):
        data = envelope
    else:
        return False

    if not isinstance(data, dict):
        return False

    for field_name in REQUIRED_STRING_FIELDS:
        value = data.get(field_name)
        if not isinstance(value, str) or not value:
            return False

    transport = data.get("transport")
    if not isinstance(transport, dict):
        return False

    for field_name in REQUIRED_TRANSPORT_FIELDS:
        if field_name not in transport:
            return False

    return True
