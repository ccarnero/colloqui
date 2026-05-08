"""Async NATS client wrapper for E2E tests.

Provides a thin layer over ``nats-py`` with:
* Connection lifecycle management
* CloudEvents envelope construction
* Request/reply helpers
* Stream setup / teardown
"""

from __future__ import annotations

import json
import sys
import os
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from nats.aio.client import Client as NATS
from nats.aio.msg import Msg

_shared_types_path = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "..", "packages", "shared-python"
)
if _shared_types_path not in sys.path:
    sys.path.insert(0, os.path.abspath(_shared_types_path))

from cloudevent_envelope import (
    CloudEventEnvelope,
    build_data_payload,
    calculate_checksum,
)
import subjects as shared_subjects

from e2e.helpers.config import config


class NatsTestClient:
    """Async NATS client tailored for YoizenClaw E2E tests."""

    def __init__(self, tenant_id: str | None = None) -> None:
        self._nc: NATS | None = None
        self._tenant_id = tenant_id or config.tenant_id
        self._subscriptions: list[Any] = []

    async def connect(self) -> None:
        if self._nc is not None and self._nc.is_connected:
            return
        self._nc = NATS()
        await self._nc.connect(servers=[config.nats_url])

    async def close(self) -> None:
        if self._nc is None:
            return
        for sub in self._subscriptions:
            try:
                await sub.unsubscribe()
            except Exception:
                pass
        self._subscriptions.clear()
        if self._nc.is_connected:
            await self._nc.drain()
            await self._nc.close()
        self._nc = None

    @property
    def is_connected(self) -> bool:
        return self._nc is not None and self._nc.is_connected

    def build_subject(self, action: str) -> str:
        return shared_subjects.build_subject(self._tenant_id, action)

    def build_chat_request_payload(
        self,
        *,
        chat_id: str | None = None,
        agent_id: str = "test-agent",
        message: str = "Hello",
        turn_number: int = 1,
        session_id: str | None = None,
        timestamp: str | None = None,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        return {
            "chat_id": chat_id or str(uuid.uuid4()),
            "agent_id": agent_id,
            "message": message,
            "turn_number": turn_number,
            "session_id": session_id or str(uuid.uuid4()),
            "timestamp": timestamp or now,
        }

    def build_cloud_event(
        self,
        *,
        agent_id: str,
        action: str,
        payload: dict[str, Any],
        depth: int = 0,
    ) -> dict[str, Any]:
        envelope = CloudEventEnvelope(
            id=str(uuid.uuid4()),
            source=f"/services/yoizenclaw/agents/{agent_id}",
            type=f"io.yoizen.yoizenclaw.agent.{action}.v1",
            resource=f"tenant/{self._tenant_id}/agents/{agent_id}",
            tenant=self._tenant_id,
            traceid=str(uuid.uuid4()),
            correlation_id=str(uuid.uuid4()),
            idempotencykey=f"sha256:{calculate_checksum(payload)}",
            transport={
                "method": "agent",
                "protocol": "internal",
                "agent_id": agent_id,
                "agent_capabilities": ["reply", "classify"],
                "depth": depth,
            },
            data=build_data_payload(payload),
        )
        return asdict(envelope)

    def build_admin_service_subject(self, action: str) -> str:
        """Build admin-service format subject (8 parts).

        Format: evt.{tenant}.yoizenclaw-admin-service.automation.yoizenclaw.internal.{action}.v1
        """
        return (
            f"evt.{self._tenant_id}.yoizenclaw-admin-service"
            f".automation.yoizenclaw.internal.{action}.v1"
        )

    def build_admin_service_cloud_event(
        self,
        *,
        agent_id: str,
        action: str,
        payload: dict[str, Any],
        depth: int = 0,
    ) -> dict[str, Any]:
        """Build CloudEvents envelope matching admin-service format."""
        envelope = CloudEventEnvelope(
            id=str(uuid.uuid4()),
            source=f"//yoizenclaw-admin-service/admin/agents/chat",
            type=f"io.yoizen.yoizenclaw.chat.request.v1",
            resource=f"tenant/{self._tenant_id}/agents/{agent_id}",
            tenant=self._tenant_id,
            traceid=str(uuid.uuid4()),
            correlation_id=str(uuid.uuid4()),
            idempotencykey=f"sha256:{calculate_checksum(payload)}",
            transport={
                "method": "agent",
                "protocol": "internal",
                "agent_id": "yoizenclaw-admin-service",
                "depth": depth,
            },
            data=build_data_payload(payload),
        )
        return asdict(envelope)

    async def publish(
        self,
        subject: str,
        payload: dict[str, Any],
    ) -> None:
        assert self._nc is not None, "NATS client not connected"
        data = json.dumps(payload).encode("utf-8")
        await self._nc.publish(subject, data)

    async def request_reply(
        self,
        subject: str,
        payload: dict[str, Any],
        timeout: float | None = None,
    ) -> Msg | None:
        assert self._nc is not None, "NATS client not connected"
        data = json.dumps(payload).encode("utf-8")
        try:
            return await self._nc.request(
                subject,
                data,
                timeout=(timeout or config.chat_timeout_seconds),
            )
        except Exception:
            return None

    async def subscribe(self, subject: str) -> Any:
        assert self._nc is not None, "NATS client not connected"
        sub = await self._nc.subscribe(subject)
        self._subscriptions.append(sub)
        return sub

    async def wait_for_message(
        self,
        subscription: Any,
        timeout: float | None = None,
    ) -> Msg | None:
        try:
            return await subscription.next_msg(
                timeout=(timeout or config.chat_timeout_seconds),
            )
        except Exception:
            return None


def parse_reply(raw_msg: Msg | None) -> dict[str, Any] | None:
    if raw_msg is None:
        return None
    try:
        data = json.loads(raw_msg.data.decode("utf-8"))
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return None
