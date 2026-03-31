"""Tests for RuntimeNatsBridge wdocs-compliant NATS rewrite.

Phase 2.4 tasks: 2.4.1 through 2.4.12

Covers:
- Tenant extraction from subject (2.4.1)
- wdocs-compliant subjects replacing flat subjects (2.4.2)
- CloudEvents envelope validation on inbound (2.4.3, 2.4.4)
- Depth limit enforcement (2.4.5, 2.4.6)
- Outbound envelope with incremented depth (2.4.7, 2.4.8)
- Claim Check for large payloads (2.4.9, 2.4.10)
- Dynamic subject subscription with TENANT_ID (2.4.11, 2.4.12)
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from dataclasses import asdict
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_repo_root = os.path.dirname(os.path.dirname(_app_dir))
shared_types_path = os.path.join(_repo_root, "applications", "shared", "types", "python")
if shared_types_path not in sys.path:
    sys.path.insert(0, shared_types_path)

from cloudevent_envelope import (
    CloudEventEnvelope,
    build_internal_agent_envelope,
    validate_envelope,
)
from subjects import (
    YOIZENCLAW_ACTIONS,
    build_subject,
    extract_tenant_from_subject,
)


def _make_valid_envelope(
    tenant: str = "acme",
    action: str = "config_sync",
    depth: int = 0,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a valid CloudEvents envelope dict for testing."""
    envelope = build_internal_agent_envelope(
        tenant=tenant,
        agent_id="test-agent",
        action=action,
        payload=data or {"files": [], "deletePaths": []},
        depth=depth,
    )
    return asdict(envelope)


def _make_mock_msg(
    subject: str,
    data: dict[str, Any],
    reply: str | None = None,
    headers: dict[str, str] | None = None,
) -> MagicMock:
    """Create a mock NATS Msg object."""
    msg = MagicMock()
    msg.subject = subject
    msg.data = json.dumps(data).encode("utf-8")
    msg.reply = reply
    msg.headers = headers or {}
    return msg


class TestTenantExtractionFromSubject:
    """Task 2.4.1: RuntimeNatsBridge extracts tenant from subject."""

    def test_extracts_tenant_from_wdocs_subject(self) -> None:
        result = extract_tenant_from_subject("evt.acme.yoizenclaw.config_sync.v1")
        assert result == "acme"

    def test_extracts_tenant_from_different_tenant(self) -> None:
        result = extract_tenant_from_subject("evt.globalcorp.yoizenclaw.online.v1")
        assert result == "globalcorp"

    def test_returns_none_for_legacy_flat_subject(self) -> None:
        result = extract_tenant_from_subject("yoizenclaw.runtime.config.sync")
        assert result is None

    def test_returns_none_for_empty_string(self) -> None:
        result = extract_tenant_from_subject("")
        assert result is None

    def test_returns_none_for_evt_prefix_only(self) -> None:
        result = extract_tenant_from_subject("evt")
        assert result is None


class TestWdocsSubjectBuilding:
    """Task 2.4.2: Subjects follow evt.{tenant}.yoizenclaw.{action}.v1."""

    def test_config_sync_subject(self) -> None:
        subject = build_subject("acme", "config_sync")
        assert subject == "evt.acme.yoizenclaw.config_sync.v1"

    def test_jobs_sync_subject(self) -> None:
        subject = build_subject("acme", "jobs_sync")
        assert subject == "evt.acme.yoizenclaw.jobs_sync.v1"

    def test_chat_respond_subject(self) -> None:
        subject = build_subject("acme", "chat_respond")
        assert subject == "evt.acme.yoizenclaw.chat_respond.v1"

    def test_online_subject(self) -> None:
        subject = build_subject("acme", "online")
        assert subject == "evt.acme.yoizenclaw.online.v1"

    def test_execution_status_subject(self) -> None:
        subject = build_subject("acme", "execution_status")
        assert subject == "evt.acme.yoizenclaw.job.execution_status.v1"

    def test_event_subject(self) -> None:
        subject = build_subject("acme", "event")
        assert subject == "evt.acme.yoizenclaw.event.v1"

    def test_agent_outbound_subject(self) -> None:
        subject = build_subject("acme", "agent_outbound")
        assert subject == "evt.acme.yoizenclaw.agent.outbound.v1"

    def test_unknown_action_raises_key_error(self) -> None:
        with pytest.raises(KeyError):
            build_subject("acme", "nonexistent_action")


class TestCloudEventsEnvelopeValidation:
    """Task 2.4.3: Bridge validates CloudEvents envelope on inbound."""

    def test_valid_envelope_passes_validation(self) -> None:
        envelope = _make_valid_envelope()
        assert validate_envelope(envelope) is True

    def test_envelope_missing_specversion_fails(self) -> None:
        envelope = _make_valid_envelope()
        del envelope["specversion"]
        assert validate_envelope(envelope) is False

    def test_envelope_missing_id_fails(self) -> None:
        envelope = _make_valid_envelope()
        del envelope["id"]
        assert validate_envelope(envelope) is False

    def test_envelope_missing_source_fails(self) -> None:
        envelope = _make_valid_envelope()
        del envelope["source"]
        assert validate_envelope(envelope) is False

    def test_envelope_missing_type_fails(self) -> None:
        envelope = _make_valid_envelope()
        del envelope["type"]
        assert validate_envelope(envelope) is False

    def test_envelope_missing_tenant_fails(self) -> None:
        envelope = _make_valid_envelope()
        del envelope["tenant"]
        assert validate_envelope(envelope) is False

    def test_envelope_missing_transport_fails(self) -> None:
        envelope = _make_valid_envelope()
        del envelope["transport"]
        assert validate_envelope(envelope) is False

    def test_envelope_transport_missing_depth_fails(self) -> None:
        envelope = _make_valid_envelope()
        envelope["transport"] = {"protocol": "internal"}
        assert validate_envelope(envelope) is False

    def test_envelope_empty_string_field_fails(self) -> None:
        envelope = _make_valid_envelope()
        envelope["tenant"] = ""
        assert validate_envelope(envelope) is False

    @pytest.mark.asyncio
    async def test_bridge_rejects_message_without_envelope(self) -> None:
        """Task 2.4.4: Inbound handler rejects non-envelope messages."""
        from src.interfaces.nats_bridge import RuntimeNatsBridge

        bridge = RuntimeNatsBridge.__new__(RuntimeNatsBridge)
        bridge._nats = MagicMock()
        bridge._nats.is_connected = False
        bridge._tracer = MagicMock()
        bridge._instance_id = "test"
        bridge._heartbeat_interval_seconds = 15.0
        bridge._heartbeat_task = None
        bridge._tenant_id = "acme"
        bridge._object_store = None

        raw_payload = {"just": "data", "no": "envelope"}
        msg = _make_mock_msg(
            "evt.acme.yoizenclaw.config_sync.v1",
            raw_payload,
        )

        with patch.object(
            bridge, "_apply_config_sync", new_callable=AsyncMock
        ) as mock_apply:
            await bridge._dispatch_message(msg)
            mock_apply.assert_not_called()


class TestDepthLimitEnforcement:
    """Task 2.4.5: Bridge enforces depth limit before processing."""

    def test_enforce_depth_limit_allows_below_max(self) -> None:
        from src.shared.depth import enforce_depth_limit

        envelope = _make_valid_envelope(depth=3)
        result = enforce_depth_limit(envelope)
        assert result["transport"]["depth"] == 3

    def test_enforce_depth_limit_rejects_at_max(self) -> None:
        from src.shared.depth import DepthExceededError, enforce_depth_limit

        envelope = _make_valid_envelope(depth=5)
        with pytest.raises(DepthExceededError):
            enforce_depth_limit(envelope)

    def test_enforce_depth_limit_rejects_above_max(self) -> None:
        from src.shared.depth import DepthExceededError, enforce_depth_limit

        envelope = _make_valid_envelope(depth=10)
        with pytest.raises(DepthExceededError):
            enforce_depth_limit(envelope)

    def test_enforce_depth_limit_allows_zero(self) -> None:
        from src.shared.depth import enforce_depth_limit

        envelope = _make_valid_envelope(depth=0)
        result = enforce_depth_limit(envelope)
        assert result["transport"]["depth"] == 0

    @pytest.mark.asyncio
    async def test_bridge_rejects_depth_exceeded_message(self) -> None:
        """Task 2.4.6: Message handler rejects depth-exceeded messages."""
        from src.interfaces.nats_bridge import RuntimeNatsBridge

        bridge = RuntimeNatsBridge.__new__(RuntimeNatsBridge)
        bridge._nats = MagicMock()
        bridge._nats.is_connected = False
        bridge._tracer = MagicMock()
        bridge._instance_id = "test"
        bridge._heartbeat_interval_seconds = 15.0
        bridge._heartbeat_task = None
        bridge._tenant_id = "acme"
        bridge._object_store = None

        envelope = _make_valid_envelope(depth=5)
        msg = _make_mock_msg(
            "evt.acme.yoizenclaw.config_sync.v1",
            envelope,
        )

        with patch.object(
            bridge, "_apply_config_sync", new_callable=AsyncMock
        ) as mock_apply:
            await bridge._dispatch_message(msg)
            mock_apply.assert_not_called()


class TestOutboundEnvelopeWithDepth:
    """Task 2.4.7: Outbound messages use envelope with incremented depth."""

    def test_increment_depth_increases_by_one(self) -> None:
        from src.shared.depth import increment_depth

        envelope = _make_valid_envelope(depth=2)
        result = increment_depth(envelope)
        assert result["transport"]["depth"] == 3

    def test_increment_depth_sets_causation_id(self) -> None:
        from src.shared.depth import increment_depth

        envelope = _make_valid_envelope(depth=2)
        envelope["id"] = "evt-123"
        result = increment_depth(envelope)
        assert result["causation_id"] == "evt-123"

    def test_increment_depth_preserves_other_fields(self) -> None:
        from src.shared.depth import increment_depth

        envelope = _make_valid_envelope(depth=1)
        result = increment_depth(envelope)
        assert result["tenant"] == envelope["tenant"]
        assert result["source"] == envelope["source"]

    def test_build_internal_agent_envelope_has_correct_fields(self) -> None:
        envelope = build_internal_agent_envelope(
            tenant="acme",
            agent_id="yoizenclaw-runtime",
            action="config_sync",
            payload={"key": "value"},
            depth=3,
        )
        as_dict = asdict(envelope)
        assert as_dict["tenant"] == "acme"
        assert as_dict["transport"]["depth"] == 3
        assert as_dict["transport"]["protocol"] == "internal"
        assert as_dict["transport"]["agent_id"] == "yoizenclaw-runtime"

    @pytest.mark.asyncio
    async def test_outbound_publish_uses_envelope_with_depth(self) -> None:
        """Task 2.4.8: Outbound publish wraps in CloudEvents envelope."""
        from src.interfaces.nats_bridge import RuntimeNatsBridge

        bridge = RuntimeNatsBridge.__new__(RuntimeNatsBridge)
        bridge._nats = AsyncMock()
        bridge._nats.is_connected = True
        bridge._tracer = MagicMock()
        bridge._instance_id = "test"
        bridge._tenant_id = "acme"

        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        bridge._tracer.start_as_current_span = MagicMock(return_value=mock_span)

        payload = {"status": "completed", "job_id": "j1"}
        await bridge.publish_execution_status(payload)

        bridge._nats.publish.assert_called_once()
        call_args = bridge._nats.publish.call_args
        published_data = json.loads(call_args[0][1].decode("utf-8"))

        assert "specversion" in published_data
        assert published_data["specversion"] == "1.0"
        assert published_data["tenant"] == "acme"
        assert published_data["transport"]["protocol"] == "internal"
        assert published_data["transport"]["depth"] == 0


class TestClaimCheckForLargePayloads:
    """Task 2.4.9: Large outbound payloads go to Claim Check."""

    @pytest.mark.asyncio
    async def test_check_payload_size_inline_for_small(self) -> None:
        from src.shared.claim_check import check_payload_size

        small_payload = b"x" * 100
        result = await check_payload_size(small_payload)
        assert result["inline"] is True
        assert result["bytes"] == 100

    @pytest.mark.asyncio
    async def test_check_payload_size_claim_check_for_large(self) -> None:
        from src.shared.claim_check import (
            CLAIM_CHECK_THRESHOLD_BYTES,
            check_payload_size,
        )

        large_payload = b"x" * (CLAIM_CHECK_THRESHOLD_BYTES + 1)
        result = await check_payload_size(large_payload)
        assert result["inline"] is False
        assert result["bytes"] == CLAIM_CHECK_THRESHOLD_BYTES + 1

    @pytest.mark.asyncio
    async def test_check_payload_size_exactly_at_threshold(self) -> None:
        from src.shared.claim_check import (
            CLAIM_CHECK_THRESHOLD_BYTES,
            check_payload_size,
        )

        threshold_payload = b"x" * CLAIM_CHECK_THRESHOLD_BYTES
        result = await check_payload_size(threshold_payload)
        assert result["inline"] is True

    @pytest.mark.asyncio
    async def test_store_payload_returns_ref(self) -> None:
        from src.shared.claim_check import store_payload

        mock_store = AsyncMock()
        mock_store.put = AsyncMock(return_value=None)

        ref = await store_payload(mock_store, "acme", "evt-001", b"big data")
        assert "PAYLOAD-acme" in ref
        mock_store.put.assert_called_once()

    @pytest.mark.asyncio
    async def test_outbound_large_payload_uses_claim_check(self) -> None:
        """Task 2.4.10: Outbound with payload > 256KB stores in Object Store."""
        from src.shared.claim_check import CLAIM_CHECK_THRESHOLD_BYTES
        from src.interfaces.nats_bridge import RuntimeNatsBridge

        bridge = RuntimeNatsBridge.__new__(RuntimeNatsBridge)
        bridge._nats = AsyncMock()
        bridge._nats.is_connected = True
        bridge._tracer = MagicMock()
        bridge._instance_id = "test"
        bridge._tenant_id = "acme"
        bridge._object_store = AsyncMock()

        mock_span = MagicMock()
        mock_span.__enter__ = MagicMock(return_value=mock_span)
        mock_span.__exit__ = MagicMock(return_value=False)
        bridge._tracer.start_as_current_span = MagicMock(return_value=mock_span)

        large_data = {"content": "x" * (CLAIM_CHECK_THRESHOLD_BYTES + 1)}
        await bridge.publish_runtime_event("large.event", large_data)

        bridge._nats.publish.assert_called_once()
        call_args = bridge._nats.publish.call_args
        published_data = json.loads(call_args[0][1].decode("utf-8"))
        assert published_data.get("payload_inline") is False
        assert "payload_ref" in published_data


def _build_test_bridge(tenant_id: str) -> Any:
    """Create a RuntimeNatsBridge via __new__ with all required attributes."""
    from src.interfaces.nats_bridge import RuntimeNatsBridge

    bridge = RuntimeNatsBridge.__new__(RuntimeNatsBridge)
    bridge._nats = AsyncMock()
    bridge._nats.is_connected = False
    bridge._nats_url = "nats://localhost:4222"
    bridge._tracer = MagicMock()
    bridge._instance_id = "test-instance"
    bridge._heartbeat_interval_seconds = 15.0
    bridge._heartbeat_task = None
    bridge._tenant_id = tenant_id
    bridge._object_store = None

    mock_span = MagicMock()
    mock_span.__enter__ = MagicMock(return_value=mock_span)
    mock_span.__exit__ = MagicMock(return_value=False)
    bridge._tracer.start_as_current_span = MagicMock(return_value=mock_span)
    return bridge


class TestDynamicSubjectSubscription:
    """Task 2.4.11: Bridge subscribes to evt.{tenant}.yoizenclaw.>."""

    @pytest.mark.asyncio
    async def test_start_subscribes_to_tenant_wildcard(self) -> None:
        """Task 2.4.12: start() uses dynamic subject with tenant from env."""
        bridge = _build_test_bridge("acme")

        with patch(
            "src.interfaces.nats_bridge._is_configured_check",
            return_value=False,
        ):
            await bridge.start()

        first_subscribe_call = bridge._nats.subscribe.call_args_list[0]
        assert first_subscribe_call[0][0] == "evt.acme.yoizenclaw.>"

    @pytest.mark.asyncio
    async def test_start_uses_tenant_id_from_env(self) -> None:
        bridge = _build_test_bridge("globalcorp")

        with patch(
            "src.interfaces.nats_bridge._is_configured_check",
            return_value=False,
        ):
            await bridge.start()

        first_subscribe_call = bridge._nats.subscribe.call_args_list[0]
        assert first_subscribe_call[0][0] == "evt.globalcorp.yoizenclaw.>"

    @pytest.mark.asyncio
    async def test_start_publishes_online_to_tenant_subject(self) -> None:
        bridge = _build_test_bridge("acme")

        with patch(
            "src.interfaces.nats_bridge._is_configured_check",
            return_value=False,
        ):
            await bridge.start()

        online_publish = bridge._nats.publish.call_args_list[0]
        subject = online_publish[0][0]
        assert subject == "evt.acme.yoizenclaw.online.v1"
