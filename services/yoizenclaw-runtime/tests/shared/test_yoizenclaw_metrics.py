"""Tests for YoizenClaw OTEL metrics (wdocs/06 compliance).

Tasks 3.1.1-3.1.5: YoizenClaw Metrics
- 3.1.1: yoizenclaw.ingress.published counter increments on publish
- 3.1.2: OTEL counters + histograms module creation
- 3.1.3: yoizenclaw.agent.depth_exceeded counter increments on rejection
- 3.1.4: depth_exceeded metric integration in depth tracker
- 3.1.5: claimcheck.stored and claimcheck.inline metrics
"""

from __future__ import annotations

from typing import Any

import pytest
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import InMemoryMetricReader

from src.shared.metrics import yoizenclaw_metrics


@pytest.fixture()
def _metric_reader() -> InMemoryMetricReader:
    """Set up an in-memory metric reader for testing."""
    reader = InMemoryMetricReader()
    provider = MeterProvider(metric_readers=[reader])
    metrics.set_meter_provider(provider)
    meter = provider.get_meter("yoizenclaw")
    yoizenclaw_metrics.initialize(meter)
    return reader


@pytest.fixture()
def _reset_module_globals() -> Any:
    """Ensure module globals are restored after each test."""
    yield
    yoizenclaw_metrics.initialize()


def _get_counter_value(
    reader: InMemoryMetricReader,
    metric_name: str,
) -> float:
    """Read the sum of all data points for a counter from the reader."""
    total = 0.0
    metrics_data = reader.get_metrics_data()
    for resource_metrics in metrics_data.resource_metrics:
        for scope_metrics in resource_metrics.scope_metrics:
            for metric in scope_metrics.metrics:
                if metric.name == metric_name:
                    for data_point in metric.data.data_points:
                        total += float(data_point.value)
    return total


class TestIngressPublishedCounter:
    """Task 3.1.1: yoizenclaw.ingress.published increments on publish."""

    def test_counter_increments_on_record(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        yoizenclaw_metrics.record_ingress_published(
            tenant="acme",
            subject="evt.acme.yoizenclaw.config_sync.v1",
        )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.ingress.published"
        )
        assert value == 1.0

    def test_counter_increments_multiple_times(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        for i in range(5):
            yoizenclaw_metrics.record_ingress_published(
                tenant="acme",
                subject=f"evt.acme.yoizenclaw.event.v1",
            )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.ingress.published"
        )
        assert value == 5.0

    def test_counter_records_with_attributes(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        yoizenclaw_metrics.record_ingress_published(
            tenant="my-tenant",
            subject="evt.my-tenant.yoizenclaw.jobs_sync.v1",
        )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.ingress.published"
        )
        assert value == 1.0

    def test_ingress_publish_failed_counter(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        yoizenclaw_metrics.record_ingress_publish_failed(
            tenant="acme",
            reason="invalid_envelope",
        )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.ingress.publish_failed"
        )
        assert value == 1.0

    def test_ingress_latency_histogram_records(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        yoizenclaw_metrics.record_ingress_publish_latency(
            latency_ms=42.5,
            tenant="acme",
        )
        metrics_data = _metric_reader.get_metrics_data()
        found = False
        for resource_metrics in metrics_data.resource_metrics:
            for scope_metrics in resource_metrics.scope_metrics:
                for metric in scope_metrics.metrics:
                    if metric.name == "yoizenclaw.ingress.publish_latency_ms":
                        found = True
                        assert len(metric.data.data_points) > 0
        assert found


class TestAgentDepthExceededCounter:
    """Task 3.1.3: yoizenclaw.agent.depth_exceeded increments on rejection."""

    def test_counter_increments_on_depth_exceeded(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        yoizenclaw_metrics.record_depth_exceeded(
            tenant="acme",
            depth=5,
        )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.agent.depth_exceeded"
        )
        assert value == 1.0

    def test_counter_increments_multiple_rejections(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        for depth in [5, 6, 10]:
            yoizenclaw_metrics.record_depth_exceeded(
                tenant="acme",
                depth=depth,
            )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.agent.depth_exceeded"
        )
        assert value == 3.0

    def test_depth_tracker_integration_raises_and_increments_metric(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        from src.shared.depth.tracker import (
            DepthExceededError,
            enforce_depth_limit,
        )

        envelope: dict[str, Any] = {
            "id": "evt-depth",
            "tenant": "acme",
            "transport": {"depth": 5},
        }

        with pytest.raises(DepthExceededError):
            enforce_depth_limit(envelope)

        value = _get_counter_value(
            _metric_reader, "yoizenclaw.agent.depth_exceeded"
        )
        assert value == 1.0


class TestClaimCheckMetrics:
    """Task 3.1.5: yoizenclaw.claimcheck.stored and .inline metrics."""

    def test_claimcheck_stored_counter(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        yoizenclaw_metrics.record_claimcheck_stored(
            tenant="acme",
            size_bytes=300 * 1024,
        )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.claimcheck.stored"
        )
        assert value == 1.0

    def test_claimcheck_inline_counter(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        yoizenclaw_metrics.record_claimcheck_inline(
            tenant="acme",
            size_bytes=100 * 1024,
        )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.claimcheck.inline"
        )
        assert value == 1.0

    @pytest.mark.asyncio
    async def test_claimcheck_inline_increments_on_small_payload(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        from src.shared.claim_check.resolver import check_payload_size

        payload = b"x" * 100
        result = await check_payload_size(payload, tenant="acme")
        assert result["inline"] is True

        value = _get_counter_value(
            _metric_reader, "yoizenclaw.claimcheck.inline"
        )
        assert value == 1.0

    @pytest.mark.asyncio
    async def test_claimcheck_stored_increments_on_large_payload(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        from src.shared.claim_check.resolver import (
            CLAIM_CHECK_THRESHOLD_BYTES,
            check_payload_size,
        )

        payload = b"x" * (CLAIM_CHECK_THRESHOLD_BYTES + 1)
        result = await check_payload_size(payload, tenant="acme")
        assert result["inline"] is False

        value = _get_counter_value(
            _metric_reader, "yoizenclaw.claimcheck.stored"
        )
        assert value == 1.0


class TestAgentEventsCounter:
    """Agent events counter tests."""

    def test_agent_events_counter(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        yoizenclaw_metrics.record_agent_event(
            agent_id="yoizenclaw-runtime",
            event_type="outbound",
            tenant="acme",
        )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.agent.events"
        )
        assert value == 1.0


class TestRuntimeHeartbeatCounter:
    """Runtime heartbeat counter tests."""

    def test_runtime_heartbeat_counter(
        self, _metric_reader: InMemoryMetricReader
    ) -> None:
        yoizenclaw_metrics.record_runtime_heartbeat(
            tenant="acme",
            status="healthy",
        )
        value = _get_counter_value(
            _metric_reader, "yoizenclaw.runtime.heartbeat"
        )
        assert value == 1.0


class TestNoOpGracefulHandling:
    """Metrics should not crash when instruments are None."""

    def test_record_with_none_instruments(self) -> None:
        yoizenclaw_metrics.ingress_published = None
        yoizenclaw_metrics.agent_depth_exceeded = None
        yoizenclaw_metrics.claimcheck_stored = None
        yoizenclaw_metrics.claimcheck_inline = None

        yoizenclaw_metrics.record_ingress_published("t", "s")
        yoizenclaw_metrics.record_depth_exceeded("t", 5)
        yoizenclaw_metrics.record_claimcheck_stored("t", 100)
        yoizenclaw_metrics.record_claimcheck_inline("t", 50)

        yoizenclaw_metrics.initialize()
