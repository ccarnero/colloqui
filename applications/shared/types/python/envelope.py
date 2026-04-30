"""Legacy envelope types for backward compatibility.

These types are used by nats_bridge.py and tools/yoizen.py.
They will be gradually replaced by CloudEvents envelope
(cloudevent_envelope.py) as the bridge is migrated.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Any

import uuid
from datetime import datetime, timezone


class EnvelopeSource(Enum):
    """Identifies the origin of an envelope."""

    CLAW = "claw"
    ADMIN = "admin"
    PLATFORM = "platform"


@dataclass
class CommandEnvelope:
    """Wraps a command payload with metadata."""

    id: str
    kind: str
    source: EnvelopeSource
    type: str
    data: dict[str, Any]
    timestamp: str

    @staticmethod
    def create(
        type_: str,
        data: dict[str, Any],
        source: EnvelopeSource,
    ) -> "CommandEnvelope":
        return CommandEnvelope(
            id=str(uuid.uuid4()),
            kind="command",
            source=source,
            type=type_,
            data=data,
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
