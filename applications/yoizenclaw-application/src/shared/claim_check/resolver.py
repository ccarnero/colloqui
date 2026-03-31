"""Claim check pattern for large payloads (wdocs/04 compliance)."""

from __future__ import annotations

import hashlib
from typing import Any

from src.shared.metrics import yoizenclaw_metrics

CLAIM_CHECK_THRESHOLD_BYTES = 262144  # 256 KB


async def check_payload_size(
    payload_bytes: bytes,
    tenant: str = "unknown",
) -> dict[str, Any]:
    """Determine whether a payload should travel inline or be claim-checked.

    Increments ``yoizenclaw.claimcheck.inline`` or
    ``yoizenclaw.claimcheck.stored`` depending on the result.
    """
    size = len(payload_bytes)
    inline = size <= CLAIM_CHECK_THRESHOLD_BYTES

    if inline:
        yoizenclaw_metrics.record_claimcheck_inline(
            tenant=tenant, size_bytes=size
        )
    else:
        yoizenclaw_metrics.record_claimcheck_stored(
            tenant=tenant, size_bytes=size
        )

    return {
        "inline": inline,
        "bytes": size,
    }


async def store_payload(
    object_store: Any,
    tenant: str,
    event_id: str,
    payload: bytes,
) -> str:
    """Store payload in NATS Object Store and return a reference URI."""
    key = f"PAYLOAD-{tenant}/{event_id}-payload"
    await object_store.put(key, payload)
    return f"nats://objstore/PAYLOAD-{tenant}/{key}"


async def resolve_payload(
    data: dict[str, Any],
    object_store: Any,
) -> bytes:
    """Retrieve payload, either inline or from Object Store with checksum verification."""
    if data.get("payload_inline", True):
        return data.get("payload", b"")
    ref = data.get("payload_ref")
    if not ref:
        raise ValueError("payload_ref missing for non-inline event")
    raw = await object_store.get(ref)
    checksum = f"sha256:{hashlib.sha256(raw).hexdigest()}"
    expected = data.get("payload_checksum", "")
    if checksum != expected:
        raise ValueError(
            f"Checksum mismatch: expected {expected}, got {checksum}"
        )
    return raw
