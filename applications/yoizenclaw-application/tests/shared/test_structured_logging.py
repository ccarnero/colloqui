"""Tests for structured logging with PII policy (wdocs/06 compliance).

Phase 3.2 tasks: 3.2.1-3.2.4

Covers:
- 3.2.1: Log entries include tenant, traceid, causation_id fields
- 3.2.2: Structured logging with tenant tags configured in bridge startup
- 3.2.3: data.payload is NEVER logged (PII policy)
- 3.2.4: Log sanitizer that strips data.payload before logging
"""

from __future__ import annotations

import json
import logging
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.shared.logging.structured import (
    PIISanitizerFilter,
    TenantContextFilter,
    clear_tenant_context,
    get_causation_id_context,
    get_tenant_context,
    get_traceid_context,
    init_structured_logging,
    set_causation_id_context,
    set_tenant_context,
    set_traceid_context,
)


@pytest.fixture(autouse=True)
def _clean_context() -> Any:
    """Reset tenant context before and after each test."""
    clear_tenant_context()
    yield
    clear_tenant_context()


# ── Task 3.2.1: Log entries include tenant, traceid, causation_id ──


class TestLogEntriesIncludeContextFields:
    """Task 3.2.1: Log entries include tenant, traceid, causation_id."""

    def test_filter_injects_tenant_into_record(self) -> None:
        ctx_filter = TenantContextFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "msg", (), None,
        )
        set_tenant_context("acme")
        ctx_filter.filter(record)
        assert record.tenant == "acme"  # type: ignore[attr-defined]

    def test_filter_injects_traceid_into_record(self) -> None:
        ctx_filter = TenantContextFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "msg", (), None,
        )
        set_traceid_context("trace-123")
        ctx_filter.filter(record)
        assert record.traceid == "trace-123"  # type: ignore[attr-defined]

    def test_filter_injects_causation_id_into_record(self) -> None:
        ctx_filter = TenantContextFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "msg", (), None,
        )
        set_causation_id_context("cause-456")
        ctx_filter.filter(record)
        assert record.causation_id == "cause-456"  # type: ignore[attr-defined]

    def test_filter_injects_all_fields_together(self) -> None:
        ctx_filter = TenantContextFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "msg", (), None,
        )
        set_tenant_context("acme")
        set_traceid_context("trace-789")
        set_causation_id_context("cause-012")
        ctx_filter.filter(record)
        assert record.tenant == "acme"  # type: ignore[attr-defined]
        assert record.traceid == "trace-789"  # type: ignore[attr-defined]
        assert record.causation_id == "cause-012"  # type: ignore[attr-defined]

    def test_filter_defaults_to_empty_strings(self) -> None:
        ctx_filter = TenantContextFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "msg", (), None,
        )
        ctx_filter.filter(record)
        assert record.tenant == ""  # type: ignore[attr-defined]
        assert record.traceid == ""  # type: ignore[attr-defined]
        assert record.causation_id == ""  # type: ignore[attr-defined]

    def test_json_output_contains_all_context_fields(self) -> None:
        """End-to-end: JSON formatter output includes context fields."""
        from src.shared.logging.structured_logger import JSONFormatter

        ctx_filter = TenantContextFilter()
        formatter = JSONFormatter()
        record = logging.LogRecord(
            "test.logger", logging.INFO, "app.py", 42, "hello", (), None,
        )
        set_tenant_context("acme")
        set_traceid_context("trace-abc")
        set_causation_id_context("cause-def")
        ctx_filter.filter(record)

        output = formatter.format(record)
        data = json.loads(output)
        assert data["tenant"] == "acme"
        assert data["traceid"] == "trace-abc"
        assert data["causation_id"] == "cause-def"


# ── Task 3.2.2: Structured logging configured with tenant tags ──


class TestStructuredLoggingWithTenantTags:
    """Task 3.2.2: Configure structured logging with tenant tags."""

    def test_init_structured_logging_adds_filters(self) -> None:
        test_logger = logging.getLogger("test.init_structured")
        test_logger.filters.clear()
        init_structured_logging(test_logger)
        filter_types = {type(f) for f in test_logger.filters}
        assert TenantContextFilter in filter_types
        assert PIISanitizerFilter in filter_types

    def test_context_vars_are_isolated_per_set(self) -> None:
        set_tenant_context("tenant-a")
        assert get_tenant_context() == "tenant-a"
        set_tenant_context("tenant-b")
        assert get_tenant_context() == "tenant-b"

    def test_clear_context_resets_all_vars(self) -> None:
        set_tenant_context("acme")
        set_traceid_context("trace-1")
        set_causation_id_context("cause-1")
        clear_tenant_context()
        assert get_tenant_context() == ""
        assert get_traceid_context() == ""
        assert get_causation_id_context() == ""

    def test_full_logging_pipeline_includes_context(self) -> None:
        """Integration: log through handler pipeline and verify output."""
        from src.shared.logging.structured_logger import JSONFormatter

        test_logger = logging.getLogger("test.pipeline.context")
        test_logger.handlers.clear()
        test_logger.filters.clear()
        test_logger.setLevel(logging.DEBUG)

        formatter = JSONFormatter()
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        test_logger.addHandler(handler)
        init_structured_logging(test_logger)

        set_tenant_context("acme")
        set_traceid_context("trace-pipeline")
        set_causation_id_context("cause-pipeline")

        record = logging.LogRecord(
            "test.pipeline.context",
            logging.INFO,
            "app.py",
            10,
            "Pipeline test",
            (),
            None,
        )
        for f in test_logger.filters:
            f.filter(record)

        output = formatter.format(record)
        data = json.loads(output)
        assert data["tenant"] == "acme"
        assert data["traceid"] == "trace-pipeline"
        assert data["causation_id"] == "cause-pipeline"

    @pytest.mark.asyncio
    async def test_bridge_sets_tenant_context_on_start(self) -> None:
        """Verify bridge startup configures tenant context for logging."""
        import sys

        mock_prom = MagicMock()
        with patch.dict(sys.modules, {"prometheus_client": mock_prom}):
            from src.interfaces.nats_bridge import RuntimeNatsBridge

            bridge = RuntimeNatsBridge.__new__(RuntimeNatsBridge)
            bridge._nats = AsyncMock()
            bridge._nats.is_connected = False
            bridge._nats_url = "nats://localhost:4222"
            bridge._tracer = MagicMock()
            bridge._instance_id = "test-instance"
            bridge._heartbeat_interval_seconds = 15.0
            bridge._heartbeat_task = None
            bridge._tenant_id = "acme"
            bridge._object_store = None

            with patch(
                "src.interfaces.nats_bridge._is_configured_check",
                return_value=False,
            ):
                await bridge.start()

        assert get_tenant_context() == "acme"


# ── Task 3.2.3: data.payload is NEVER logged (PII policy) ──


class TestPayloadNeverLogged:
    """Task 3.2.3: data.payload is NEVER logged (PII policy)."""

    def test_data_payload_is_redacted_in_args(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "envelope: %s", (), None,
        )
        envelope: dict[str, Any] = {
            "data": {
                "payload": "sensitive-user-message",
                "other": "safe",
            },
        }
        record.args = (envelope,)
        sanitizer.filter(record)
        assert record.args[0]["data"]["payload"] == "[REDACTED]"  # type: ignore[index]
        assert record.args[0]["data"]["other"] == "safe"  # type: ignore[index]

    def test_data_system_prompt_is_redacted(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "env: %s", (), None,
        )
        envelope: dict[str, Any] = {
            "data": {
                "system_prompt": "You are a helpful assistant",
            },
        }
        record.args = (envelope,)
        sanitizer.filter(record)
        assert record.args[0]["data"]["system_prompt"] == "[REDACTED]"  # type: ignore[index]

    def test_data_credentials_are_redacted(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "env: %s", (), None,
        )
        envelope: dict[str, Any] = {
            "data": {
                "credentials": {"api_key": "sk-12345"},
            },
        }
        record.args = (envelope,)
        sanitizer.filter(record)
        assert record.args[0]["data"]["credentials"] == "[REDACTED]"  # type: ignore[index]

    def test_password_key_is_redacted(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "", (), None,
        )
        record.args = ({"password": "secret123", "username": "john"},)  # type: ignore[assignment]
        sanitizer.filter(record)
        assert record.args[0]["password"] == "[REDACTED]"  # type: ignore[index]
        assert record.args[0]["username"] == "john"  # type: ignore[index]

    def test_secret_key_is_redacted(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "", (), None,
        )
        record.args = ({"client_secret": "abc"},)  # type: ignore[assignment]
        sanitizer.filter(record)
        assert record.args[0]["client_secret"] == "[REDACTED]"  # type: ignore[index]

    def test_token_key_is_redacted(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "", (), None,
        )
        record.args = ({"access_token": "ey..."},)  # type: ignore[assignment]
        sanitizer.filter(record)
        assert record.args[0]["access_token"] == "[REDACTED]"  # type: ignore[index]

    def test_api_key_field_is_redacted(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "", (), None,
        )
        record.args = ({"api_key": "sk-abc"},)  # type: ignore[assignment]
        sanitizer.filter(record)
        assert record.args[0]["api_key"] == "[REDACTED]"  # type: ignore[index]

    def test_pii_in_extra_dict_is_redacted(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "msg", (), None,
        )
        record.envelope = {  # type: ignore[attr-defined]
            "data": {"payload": "secret-data"},
        }
        sanitizer.filter(record)
        assert record.envelope["data"]["payload"] == "[REDACTED]"  # type: ignore[attr-defined]

    def test_non_pii_fields_preserved(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "", (), None,
        )
        data: dict[str, Any] = {
            "tenant": "acme",
            "traceid": "trace-1",
            "action": "config_sync",
            "data": {
                "files": [{"path": "/config.yaml"}],
                "payload": "should-be-redacted",
            },
        }
        record.args = (data,)
        sanitizer.filter(record)
        assert record.args[0]["tenant"] == "acme"  # type: ignore[index]
        assert record.args[0]["data"]["files"] == [{"path": "/config.yaml"}]  # type: ignore[index]
        assert record.args[0]["data"]["payload"] == "[REDACTED]"  # type: ignore[index]


# ── Task 3.2.4: Log sanitizer implementation ──


class TestPIISanitizerFilterImplementation:
    """Task 3.2.4: Full PIISanitizerFilter behavior validation."""

    def test_sanitizer_strips_from_tuple_args(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "data: %s", (), None,
        )
        record.args = (  # type: ignore[assignment]
            {"data": {"payload": "secret", "safe": "value"}},
            "plain-string",
        )
        sanitizer.filter(record)
        result = record.args[0]  # type: ignore[index]
        assert result["data"]["payload"] == "[REDACTED]"
        assert result["data"]["safe"] == "value"
        assert record.args[1] == "plain-string"  # type: ignore[index]

    def test_sanitizer_strips_from_dict_args(self) -> None:
        """Handle %(key)s style dict args."""
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "%(user)s", (), None,
        )
        record.args = {"user": "john", "password": "secret"}  # type: ignore[assignment]
        sanitizer.filter(record)
        assert record.args["user"] == "john"  # type: ignore[index]
        assert record.args["password"] == "[REDACTED]"  # type: ignore[index]

    def test_sanitizer_handles_nested_pii(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "", (), None,
        )
        nested: dict[str, Any] = {
            "level1": {
                "data": {
                    "payload": "deep-secret",
                    "credentials": {"key": "val"},
                },
                "safe": "kept",
            },
        }
        record.args = (nested,)
        sanitizer.filter(record)
        result = record.args[0]  # type: ignore[index]
        assert result["level1"]["data"]["payload"] == "[REDACTED]"
        assert result["level1"]["data"]["credentials"] == "[REDACTED]"
        assert result["level1"]["safe"] == "kept"

    def test_sanitizer_preserves_non_dict_args(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "count: %d", (), None,
        )
        record.args = (42,)
        sanitizer.filter(record)
        assert record.args[0] == 42  # type: ignore[index]

    def test_sanitizer_handles_empty_args(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "no args", None, None,
        )
        sanitizer.filter(record)
        assert record.args is None

    def test_sanitizer_handles_list_values(self) -> None:
        sanitizer = PIISanitizerFilter()
        record = logging.LogRecord(
            "test", logging.INFO, "", 0, "", (), None,
        )
        data: dict[str, Any] = {
            "items": [
                {"password": "a", "name": "x"},
                {"password": "b", "name": "y"},
            ],
        }
        record.args = (data,)
        sanitizer.filter(record)
        result = record.args[0]  # type: ignore[index]
        assert result["items"][0]["password"] == "[REDACTED]"
        assert result["items"][0]["name"] == "x"
        assert result["items"][1]["password"] == "[REDACTED]"

    def test_end_to_end_json_output_no_pii(self) -> None:
        """Full pipeline: log an envelope and verify JSON has no PII."""
        from src.shared.logging.structured_logger import JSONFormatter

        test_logger = logging.getLogger("test.e2e.pii")
        test_logger.handlers.clear()
        test_logger.filters.clear()
        test_logger.setLevel(logging.DEBUG)

        formatter = JSONFormatter()
        test_logger.addHandler(logging.StreamHandler())
        test_logger.handlers[0].setFormatter(formatter)
        init_structured_logging(test_logger)

        record = logging.LogRecord(
            "test.e2e.pii",
            logging.INFO,
            "bridge.py",
            100,
            "envelope: %s",
            (),
            None,
        )
        envelope: dict[str, Any] = {
            "tenant": "acme",
            "data": {
                "payload": "user phone number and PII here",
                "system_prompt": "system instructions",
                "safe_field": "this is fine",
            },
            "api_key": "sk-secret",
        }
        record.args = (envelope,)

        set_tenant_context("acme")
        set_traceid_context("trace-e2e")
        set_causation_id_context("cause-e2e")

        for f in test_logger.filters:
            f.filter(record)

        output = formatter.format(record)
        data = json.loads(output)

        # Context fields present
        assert data["tenant"] == "acme"
        assert data["traceid"] == "trace-e2e"
        assert data["causation_id"] == "cause-e2e"

        # PII fields redacted in the formatted message
        msg = data["message"]
        assert "[REDACTED]" in msg
        assert "user phone number" not in msg
        assert "sk-secret" not in msg
        assert "system instructions" not in msg
