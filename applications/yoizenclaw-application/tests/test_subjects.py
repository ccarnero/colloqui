"""Tests for NATS subject helpers (wdocs/01 compliance).

Tests for:
- build_subject() — builds evt.{tenant}.yoizenclaw.{action}.v1
- extract_tenant_from_subject() — extracts tenant from a wdocs subject
- YOIZENCLAW_ACTIONS map completeness
- Legacy flat constant preservation
"""

from __future__ import annotations

import sys
import os

import pytest

_shared_types_path = os.path.join(
    os.path.dirname(__file__),
    "..",
    "..",
    "shared",
    "types",
    "python",
)
if _shared_types_path not in sys.path:
    sys.path.insert(0, os.path.abspath(_shared_types_path))

import subjects


class TestBuildSubject:
    """Test suite for build_subject() — task 1.4.1 / 1.4.2."""

    def test_config_sync_produces_wdocs_subject(self) -> None:
        result = subjects.build_subject("acme", "config_sync")
        assert result == "evt.acme.yoizenclaw.config_sync.v1"

    def test_jobs_sync(self) -> None:
        result = subjects.build_subject("tenant-x", "jobs_sync")
        assert result == "evt.tenant-x.yoizenclaw.jobs_sync.v1"

    def test_job_trigger(self) -> None:
        result = subjects.build_subject("acme", "job_trigger")
        assert result == "evt.acme.yoizenclaw.job_trigger.v1"

    def test_chat_respond(self) -> None:
        result = subjects.build_subject("acme", "chat_respond")
        assert result == "evt.acme.yoizenclaw.chat_respond.v1"

    def test_online(self) -> None:
        result = subjects.build_subject("acme", "online")
        assert result == "evt.acme.yoizenclaw.online.v1"

    def test_event(self) -> None:
        result = subjects.build_subject("acme", "event")
        assert result == "evt.acme.yoizenclaw.event.v1"

    def test_agent_outbound(self) -> None:
        result = subjects.build_subject("acme", "agent_outbound")
        assert result == "evt.acme.yoizenclaw.agent.outbound.v1"

    def test_execution_status(self) -> None:
        result = subjects.build_subject("acme", "execution_status")
        assert result == "evt.acme.yoizenclaw.job.execution_status.v1"

    def test_unknown_action_raises_key_error(self) -> None:
        with pytest.raises(KeyError):
            subjects.build_subject("acme", "nonexistent_action")

    def test_tenant_with_hyphens(self) -> None:
        result = subjects.build_subject("my-tenant-42", "config_sync")
        assert result == "evt.my-tenant-42.yoizenclaw.config_sync.v1"


class TestExtractTenantFromSubject:
    """Test suite for extract_tenant_from_subject() — task 1.4.3 / 1.4.4."""

    def test_extracts_tenant_from_online_subject(self) -> None:
        result = subjects.extract_tenant_from_subject(
            "evt.acme.yoizenclaw.online.v1",
        )
        assert result == "acme"

    def test_extracts_tenant_from_config_sync(self) -> None:
        result = subjects.extract_tenant_from_subject(
            "evt.tenant-x.yoizenclaw.config_sync.v1",
        )
        assert result == "tenant-x"

    def test_extracts_tenant_from_nested_action(self) -> None:
        result = subjects.extract_tenant_from_subject(
            "evt.acme.yoizenclaw.agent.outbound.v1",
        )
        assert result == "acme"

    def test_returns_none_for_non_evt_prefix(self) -> None:
        result = subjects.extract_tenant_from_subject(
            "yoizenclaw.runtime.config.sync",
        )
        assert result is None

    def test_returns_none_for_single_part(self) -> None:
        result = subjects.extract_tenant_from_subject("evt")
        assert result is None

    def test_returns_none_for_empty_string(self) -> None:
        result = subjects.extract_tenant_from_subject("")
        assert result is None

    def test_extracts_tenant_with_hyphens(self) -> None:
        result = subjects.extract_tenant_from_subject(
            "evt.my-tenant-42.yoizenclaw.online.v1",
        )
        assert result == "my-tenant-42"


class TestYoizenClawActionsMap:
    """Verify YOIZENCLAW_ACTIONS contains all required actions."""

    EXPECTED_ACTIONS = {
        "config_sync",
        "jobs_sync",
        "job_trigger",
        "chat_respond",
        "online",
        "event",
        "agent_outbound",
        "execution_status",
    }

    def test_all_required_actions_present(self) -> None:
        missing = self.EXPECTED_ACTIONS - set(subjects.YOIZENCLAW_ACTIONS.keys())
        assert not missing, f"Missing actions: {missing}"

    def test_all_suffixes_end_with_v1(self) -> None:
        for action, suffix in subjects.YOIZENCLAW_ACTIONS.items():
            assert suffix.endswith(".v1"), (
                f"Action '{action}' suffix '{suffix}' does not end with .v1"
            )


class TestLegacyConstantsPreserved:
    """Ensure legacy flat constants still exist for nats_bridge.py compat."""

    def test_chat_respond_exists(self) -> None:
        assert hasattr(subjects, "CHAT_RESPOND")
        assert isinstance(subjects.CHAT_RESPOND, str)

    def test_runtime_online_exists(self) -> None:
        assert hasattr(subjects, "RUNTIME_ONLINE")
        assert isinstance(subjects.RUNTIME_ONLINE, str)

    def test_runtime_config_sync_exists(self) -> None:
        assert hasattr(subjects, "RUNTIME_CONFIG_SYNC")
        assert isinstance(subjects.RUNTIME_CONFIG_SYNC, str)

    def test_runtime_jobs_sync_exists(self) -> None:
        assert hasattr(subjects, "RUNTIME_JOBS_SYNC")
        assert isinstance(subjects.RUNTIME_JOBS_SYNC, str)

    def test_job_trigger_exists(self) -> None:
        assert hasattr(subjects, "JOB_TRIGGER")
        assert isinstance(subjects.JOB_TRIGGER, str)

    def test_job_event_emit_exists(self) -> None:
        assert hasattr(subjects, "JOB_EVENT_EMIT")
        assert isinstance(subjects.JOB_EVENT_EMIT, str)

    def test_job_execution_status_exists(self) -> None:
        assert hasattr(subjects, "JOB_EXECUTION_STATUS")
        assert isinstance(subjects.JOB_EXECUTION_STATUS, str)

    def test_runtime_event_exists(self) -> None:
        assert hasattr(subjects, "RUNTIME_EVENT")
        assert isinstance(subjects.RUNTIME_EVENT, str)
