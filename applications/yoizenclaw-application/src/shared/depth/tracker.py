"""Depth tracking for anti-loop protection (wdocs/03 compliance)."""

from __future__ import annotations

from typing import Any

from src.shared.metrics import yoizenclaw_metrics

MAX_DEPTH_INTERNAL = 5


class DepthExceededError(Exception):
    """Raised when envelope depth exceeds the maximum allowed limit."""


def enforce_depth_limit(
    envelope: dict[str, Any],
    max_depth: int = MAX_DEPTH_INTERNAL,
) -> dict[str, Any]:
    """Raise DepthExceededError if the envelope depth is at or above max_depth.

    Increments the ``yoizenclaw.agent.depth_exceeded`` counter when the
    limit is breached.
    """
    current_depth = envelope.get("transport", {}).get("depth", 0)
    if current_depth >= max_depth:
        tenant = envelope.get("tenant", "unknown")
        yoizenclaw_metrics.record_depth_exceeded(
            tenant=tenant,
            depth=current_depth,
        )
        raise DepthExceededError(
            f"depth={current_depth} >= MAX_DEPTH={max_depth}"
        )
    return envelope


def increment_depth(envelope: dict[str, Any]) -> dict[str, Any]:
    """Increment the transport depth and set causation_id from the parent envelope id."""
    transport = dict(envelope.get("transport", {}))
    transport["depth"] = transport.get("depth", 0) + 1
    return {**envelope, "transport": transport, "causation_id": envelope.get("id")}
