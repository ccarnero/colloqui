"""Tests for CloudEvents envelope builder and validation.

Tasks 1.3.1-1.3.6: CloudEvents Envelope Builder
- 1.3.1: build_internal_agent_envelope() produces valid CloudEvents structure
- 1.3.3: Envelope includes transport.protocol="internal", depth, agent_id
- 1.3.5: validate_envelope() rejects missing required fields
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import asdict
from typing import Any

import pytest

_shared_types = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "..",
    "shared",
    "types",
    "python",
)
_shared_types = os.path.abspath(_shared_types)
if _shared_types not in sys.path:
    sys.path.insert(0, _shared_types)

from cloudevent_envelope import (
    CloudEventEnvelope,
    build_internal_agent_envelope,
    validate_envelope,
)


class TestBuildInternalAgentEnvelopeStructure:
    """Task 1.3.1: build_internal_agent_envelope() produces valid CloudEvents structure."""

    def test_returns_cloud_event_envelope_instance(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={"key": "value"},
        )
        assert isinstance(envelope, CloudEventEnvelope)

    def test_specversion_is_1_0(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={"key": "value"},
        )
        assert envelope.specversion == "1.0"

    def test_id_is_valid_uuid(self) -> None:
        import uuid

        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        uuid.UUID(envelope.id)

    def test_time_is_iso8601_utc(self) -> None:
        from datetime import datetime

        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        parsed = datetime.fromisoformat(envelope.time)
        assert parsed.tzinfo is not None

    def test_source_follows_agent_convention(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.source == "/services/yoizenclaw/agents/yoizenclaw-runtime"

    def test_type_follows_io_yoizen_convention(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.type == "io.yoizen.yoizenclaw.agent.config_sync.v1"

    def test_tenant_is_set(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.tenant == "acme"

    def test_producer_is_yoizenclaw(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.producer == "yoizenclaw"

    def test_domain_is_messaging(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.domain == "messaging"

    def test_provider_is_internal(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.provider == "internal"

    def test_data_contains_payload(self) -> None:
        payload = {"message": "hello", "count": 42}
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="chat_respond",
            payload=payload,
        )
        assert envelope.data == payload

    def test_causation_id_defaults_to_none(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.causation_id is None

    def test_causation_id_set_when_provided(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
            causation_id="evt-001-causation",
        )
        assert envelope.causation_id == "evt-001-causation"

    def test_correlation_id_set_when_provided(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
            correlation_id="corr-12345",
        )
        assert envelope.correlation_id == "corr-12345"

    def test_channel_set_when_provided(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="chat_respond",
            payload={},
            channel="webchat",
        )
        assert envelope.channel == "webchat"

    def test_envelope_is_json_serializable(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={"key": "value"},
            causation_id="evt-001",
            correlation_id="corr-001",
        )
        serialized = json.dumps(asdict(envelope))
        deserialized = json.loads(serialized)
        assert deserialized["specversion"] == "1.0"
        assert deserialized["tenant"] == "acme"
        assert deserialized["transport"]["protocol"] == "internal"


class TestBuildInternalAgentEnvelopeTransportMetadata:
    """Task 1.3.3: Envelope includes transport.protocol="internal", depth, agent_id."""

    def test_transport_protocol_is_internal(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.transport["protocol"] == "internal"

    def test_transport_agent_id_is_set(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.transport["agent_id"] == "yoizenclaw-runtime"

    def test_transport_method_is_agent(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.transport["method"] == "agent"

    def test_transport_depth_defaults_to_zero(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.transport["depth"] == 0

    def test_transport_depth_set_when_provided(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="chat_respond",
            payload={},
            depth=3,
        )
        assert envelope.transport["depth"] == 3

    def test_transport_agent_capabilities_default(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert envelope.transport["agent_capabilities"] == ["reply", "classify"]

    def test_transport_agent_capabilities_custom(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
            capabilities=["reply", "classify", "summarize"],
        )
        assert envelope.transport["agent_capabilities"] == [
            "reply",
            "classify",
            "summarize",
        ]

    def test_traceid_is_auto_generated_uuid(self) -> None:
        import uuid

        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        uuid.UUID(envelope.traceid)

    def test_transport_has_all_required_keys(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        required_keys = {"method", "protocol", "agent_id", "depth", "agent_capabilities"}
        assert required_keys.issubset(set(envelope.transport.keys()))


class TestValidateEnvelope:
    """Task 1.3.5: validate_envelope() rejects missing required fields."""

    def test_valid_envelope_passes(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={"key": "value"},
        )
        assert validate_envelope(envelope) is True

    def test_valid_dict_envelope_passes(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        assert validate_envelope(asdict(envelope)) is True

    def test_rejects_missing_specversion(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["specversion"]
        assert validate_envelope(data) is False

    def test_rejects_missing_id(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["id"]
        assert validate_envelope(data) is False

    def test_rejects_missing_source(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["source"]
        assert validate_envelope(data) is False

    def test_rejects_missing_type(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["type"]
        assert validate_envelope(data) is False

    def test_rejects_missing_time(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["time"]
        assert validate_envelope(data) is False

    def test_rejects_missing_tenant(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["tenant"]
        assert validate_envelope(data) is False

    def test_rejects_missing_traceid(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["traceid"]
        assert validate_envelope(data) is False

    def test_rejects_empty_specversion(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        data["specversion"] = ""
        assert validate_envelope(data) is False

    def test_rejects_empty_tenant(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        data["tenant"] = ""
        assert validate_envelope(data) is False

    def test_rejects_completely_empty_dict(self) -> None:
        assert validate_envelope({}) is False

    def test_rejects_missing_transport(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["transport"]
        assert validate_envelope(data) is False

    def test_rejects_transport_without_protocol(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["transport"]["protocol"]
        assert validate_envelope(data) is False

    def test_rejects_transport_without_depth(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={},
        )
        data = asdict(envelope)
        del data["transport"]["depth"]
        assert validate_envelope(data) is False
