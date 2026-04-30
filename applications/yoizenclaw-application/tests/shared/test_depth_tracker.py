"""Tests for depth tracking anti-loop protection (wdocs/03 compliance).

Tasks 2.2.1-2.2.4: Depth Tracker
- 2.2.1: enforce_depth_limit() raises DepthExceededError at depth=5
- 2.2.2: enforce_depth_limit() + increment_depth() implementation
- 2.2.3: increment_depth() sets causation_id from parent envelope id
- 2.2.4: increment_depth() causation chain implementation
"""

from __future__ import annotations

from typing import Any

import pytest

from src.shared.depth.tracker import (
    DepthExceededError,
    MAX_DEPTH_INTERNAL,
    enforce_depth_limit,
    increment_depth,
)


def _make_envelope(depth: int = 0, **overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "evt-001",
        "specversion": "1.0",
        "type": "io.yoizen.yoizenclaw.agent.config_sync.v1",
        "source": "/services/yoizenclaw/agents/yoizenclaw-runtime",
        "tenant": "acme",
        "transport": {
            "method": "agent",
            "protocol": "internal",
            "agent_id": "yoizenclaw-runtime",
            "depth": depth,
        },
    }
    base.update(overrides)
    return base


class TestEnforceDepthLimit:
    """Task 2.2.1: enforce_depth_limit() raises at depth=5."""

    def test_allows_depth_zero(self) -> None:
        envelope = _make_envelope(depth=0)
        result = enforce_depth_limit(envelope)
        assert result is envelope

    def test_allows_depth_below_max(self) -> None:
        envelope = _make_envelope(depth=3)
        result = enforce_depth_limit(envelope)
        assert result is envelope

    def test_allows_depth_four(self) -> None:
        envelope = _make_envelope(depth=4)
        result = enforce_depth_limit(envelope)
        assert result is envelope

    def test_raises_at_depth_five(self) -> None:
        envelope = _make_envelope(depth=5)
        with pytest.raises(DepthExceededError, match=r"depth=5"):
            enforce_depth_limit(envelope)

    def test_raises_at_depth_above_max(self) -> None:
        envelope = _make_envelope(depth=10)
        with pytest.raises(DepthExceededError, match=r"depth=10"):
            enforce_depth_limit(envelope)

    def test_default_max_depth_is_five(self) -> None:
        assert MAX_DEPTH_INTERNAL == 5

    def test_custom_max_depth(self) -> None:
        envelope = _make_envelope(depth=3)
        with pytest.raises(DepthExceededError, match=r"depth=3"):
            enforce_depth_limit(envelope, max_depth=3)

    def test_returns_envelope_when_within_limit(self) -> None:
        envelope = _make_envelope(depth=2)
        assert enforce_depth_limit(envelope) == envelope

    def test_envelope_without_transport_defaults_to_zero(self) -> None:
        envelope = {"id": "evt-002"}
        result = enforce_depth_limit(envelope)
        assert result == envelope


class TestIncrementDepth:
    """Tasks 2.2.3-2.2.4: increment_depth() with causation chain."""

    def test_increments_depth_from_zero(self) -> None:
        envelope = _make_envelope(depth=0)
        result = increment_depth(envelope)
        assert result["transport"]["depth"] == 1

    def test_increments_depth_from_three(self) -> None:
        envelope = _make_envelope(depth=3)
        result = increment_depth(envelope)
        assert result["transport"]["depth"] == 4

    def test_sets_causation_id_from_parent_id(self) -> None:
        envelope = _make_envelope(depth=0)
        envelope["id"] = "parent-evt-123"
        result = increment_depth(envelope)
        assert result["causation_id"] == "parent-evt-123"

    def test_preserves_other_transport_fields(self) -> None:
        envelope = _make_envelope(depth=2)
        result = increment_depth(envelope)
        assert result["transport"]["protocol"] == "internal"
        assert result["transport"]["agent_id"] == "yoizenclaw-runtime"
        assert result["transport"]["method"] == "agent"

    def test_does_not_mutate_original_envelope(self) -> None:
        envelope = _make_envelope(depth=2)
        original_depth = envelope["transport"]["depth"]
        increment_depth(envelope)
        assert envelope["transport"]["depth"] == original_depth

    def test_increments_twice_yields_depth_two(self) -> None:
        envelope = _make_envelope(depth=0)
        result = increment_depth(increment_depth(envelope))
        assert result["transport"]["depth"] == 2

    def test_causation_chain_tracks_through_increments(self) -> None:
        envelope = _make_envelope(depth=0)
        first = increment_depth(envelope)
        assert first["causation_id"] == "evt-001"
        assert first["transport"]["depth"] == 1
        first["id"] = "evt-002"
        second = increment_depth(first)
        assert second["causation_id"] == "evt-002"
        assert second["transport"]["depth"] == 2

    def test_handles_envelope_without_transport(self) -> None:
        envelope: dict[str, Any] = {"id": "evt-003"}
        result = increment_depth(envelope)
        assert result["transport"]["depth"] == 1
        assert result["causation_id"] == "evt-003"
