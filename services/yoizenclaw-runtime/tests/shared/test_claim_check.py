"""Tests for claim check pattern for large payloads (wdocs/04 compliance).

Tasks 2.3.1-2.3.6: Claim Check Resolver
- 2.3.1: check_payload_size() returns inline=true for 100KB, false for 300KB
- 2.3.2: check_payload_size() implementation with 256KB threshold
- 2.3.3: store_payload() stores to Object Store and returns nats:// ref
- 2.3.4: store_payload() implementation
- 2.3.5: resolve_payload() retrieves from Object Store + validates checksum
- 2.3.6: resolve_payload() with sha256 checksum verification
"""

from __future__ import annotations

import hashlib
from typing import Any
from unittest.mock import AsyncMock

import pytest

from src.shared.claim_check.resolver import (
    CLAIM_CHECK_THRESHOLD_BYTES,
    check_payload_size,
    resolve_payload,
    store_payload,
)


class TestCheckPayloadSize:
    """Tasks 2.3.1-2.3.2: check_payload_size() threshold at 256KB."""

    @pytest.mark.asyncio
    async def test_inline_true_for_small_payload(self) -> None:
        payload = b"x" * 100
        result = await check_payload_size(payload)
        assert result["inline"] is True
        assert result["bytes"] == 100

    @pytest.mark.asyncio
    async def test_inline_true_for_exactly_100kb(self) -> None:
        payload = b"x" * (100 * 1024)
        result = await check_payload_size(payload)
        assert result["inline"] is True

    @pytest.mark.asyncio
    async def test_inline_true_for_exactly_256kb(self) -> None:
        payload = b"x" * CLAIM_CHECK_THRESHOLD_BYTES
        result = await check_payload_size(payload)
        assert result["inline"] is True

    @pytest.mark.asyncio
    async def test_inline_false_for_300kb(self) -> None:
        payload = b"x" * (300 * 1024)
        result = await check_payload_size(payload)
        assert result["inline"] is False
        assert result["bytes"] == 300 * 1024

    @pytest.mark.asyncio
    async def test_inline_false_for_just_over_threshold(self) -> None:
        payload = b"x" * (CLAIM_CHECK_THRESHOLD_BYTES + 1)
        result = await check_payload_size(payload)
        assert result["inline"] is False

    @pytest.mark.asyncio
    async def test_threshold_is_256kb(self) -> None:
        assert CLAIM_CHECK_THRESHOLD_BYTES == 262144

    @pytest.mark.asyncio
    async def test_empty_payload_is_inline(self) -> None:
        result = await check_payload_size(b"")
        assert result["inline"] is True
        assert result["bytes"] == 0


class TestStorePayload:
    """Tasks 2.3.3-2.3.4: store_payload() with NATS Object Store."""

    @pytest.mark.asyncio
    async def test_stores_and_returns_ref(self) -> None:
        object_store = AsyncMock()
        payload = b"large payload data"

        ref = await store_payload(
            object_store,
            tenant="acme",
            event_id="evt-001",
            payload=payload,
        )

        object_store.put.assert_awaited_once_with(
            "PAYLOAD-acme/evt-001-payload",
            payload,
        )
        assert "nats://objstore/" in ref
        assert "PAYLOAD-acme" in ref

    @pytest.mark.asyncio
    async def test_ref_contains_tenant_and_key(self) -> None:
        object_store = AsyncMock()
        ref = await store_payload(
            object_store,
            tenant="my-tenant",
            event_id="evt-002",
            payload=b"data",
        )
        assert ref == "nats://objstore/PAYLOAD-my-tenant/PAYLOAD-my-tenant/evt-002-payload"

    @pytest.mark.asyncio
    async def test_stores_large_payload(self) -> None:
        object_store = AsyncMock()
        payload = b"x" * (300 * 1024)

        await store_payload(
            object_store,
            tenant="acme",
            event_id="evt-big",
            payload=payload,
        )

        object_store.put.assert_awaited_once()
        stored_payload = object_store.put.call_args[0][1]
        assert len(stored_payload) == 300 * 1024


class TestResolvePayload:
    """Tasks 2.3.5-2.3.6: resolve_payload() with checksum verification."""

    @pytest.mark.asyncio
    async def test_returns_inline_payload(self) -> None:
        data: dict[str, Any] = {
            "payload_inline": True,
            "payload": b"inline data",
        }
        result = await resolve_payload(data, AsyncMock())
        assert result == b"inline data"

    @pytest.mark.asyncio
    async def test_returns_inline_by_default(self) -> None:
        data: dict[str, Any] = {
            "payload": b"default inline",
        }
        result = await resolve_payload(data, AsyncMock())
        assert result == b"default inline"

    @pytest.mark.asyncio
    async def test_returns_empty_when_no_payload_key(self) -> None:
        data: dict[str, Any] = {
            "payload_inline": True,
        }
        result = await resolve_payload(data, AsyncMock())
        assert result == b""

    @pytest.mark.asyncio
    async def test_retrieves_from_object_store_with_valid_checksum(
        self,
    ) -> None:
        raw = b"stored payload content"
        checksum = f"sha256:{hashlib.sha256(raw).hexdigest()}"

        object_store = AsyncMock()
        object_store.get.return_value = raw

        data: dict[str, Any] = {
            "payload_inline": False,
            "payload_ref": "PAYLOAD-acme/evt-001-payload",
            "payload_checksum": checksum,
        }

        result = await resolve_payload(data, object_store)
        assert result == raw
        object_store.get.assert_awaited_once_with(
            "PAYLOAD-acme/evt-001-payload"
        )

    @pytest.mark.asyncio
    async def test_raises_on_checksum_mismatch(self) -> None:
        raw = b"corrupted or wrong"
        wrong_checksum = "sha256:0000000000000000"

        object_store = AsyncMock()
        object_store.get.return_value = raw

        data: dict[str, Any] = {
            "payload_inline": False,
            "payload_ref": "PAYLOAD-acme/evt-001-payload",
            "payload_checksum": wrong_checksum,
        }

        with pytest.raises(ValueError, match="Checksum mismatch"):
            await resolve_payload(data, object_store)

    @pytest.mark.asyncio
    async def test_raises_on_missing_ref_for_non_inline(self) -> None:
        data: dict[str, Any] = {
            "payload_inline": False,
        }

        with pytest.raises(
            ValueError, match="payload_ref missing"
        ):
            await resolve_payload(data, AsyncMock())

    @pytest.mark.asyncio
    async def test_valid_checksum_with_large_payload(self) -> None:
        raw = b"x" * (300 * 1024)
        checksum = f"sha256:{hashlib.sha256(raw).hexdigest()}"

        object_store = AsyncMock()
        object_store.get.return_value = raw

        data: dict[str, Any] = {
            "payload_inline": False,
            "payload_ref": "PAYLOAD-acme/evt-big-payload",
            "payload_checksum": checksum,
        }

        result = await resolve_payload(data, object_store)
        assert result == raw
        assert len(result) == 300 * 1024
