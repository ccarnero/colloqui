"""Durable execution command handlers for YoizenClaw runtime."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import subjects as shared_subjects
from src.messaging.utils import json_dumps
from src.utils.chat import ChatRequest, generate_chat_reply
from src.utils.telemetry.nats_propagator import create_nats_headers_with_trace

logger = logging.getLogger(__name__)


async def handle_execution_requested(
    nats_client: Any,
    message: Any,
    data: dict[str, Any],
    _envelope: dict[str, Any],
) -> None:
    """Handle durable execution commands published by runtime gateway/shared client."""

    tenant_id = shared_subjects.extract_tenant_from_subject(message.subject) or ""
    execution_id = str(data.get("executionId") or "").strip()
    input_payload = data.get("input") if isinstance(data.get("input"), dict) else {}
    requested_at = str(data.get("requestedAt") or datetime.now(timezone.utc).isoformat())
    requested_by = data.get("requestedBy")
    correlation_id = data.get("correlationId")
    causation_id = data.get("causationId")

    if not execution_id or not tenant_id or not input_payload:
        logger.warning("Ignoring malformed execution request on %s", message.subject)
        return

    started_payload = {
        "executionId": execution_id,
        "tenantId": tenant_id,
        "type": "chat",
        "state": "running",
        "requestedAt": requested_at,
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "requestedBy": requested_by,
        "agentId": input_payload.get("agentId"),
        "correlationId": correlation_id,
        "causationId": causation_id,
    }
    await _publish_execution_event(nats_client, tenant_id, "execution_started", started_payload)

    try:
        response = await generate_chat_reply(ChatRequest(**input_payload))
        completed_payload = {
            **started_payload,
            "state": "completed",
            "completedAt": datetime.now(timezone.utc).isoformat(),
            "result": {
                "reply": response.reply,
                "tool_calls": response.tool_calls or [],
            },
        }
        await _publish_execution_event(
            nats_client,
            tenant_id,
            "execution_completed",
            completed_payload,
        )
    except Exception as error:
        logger.exception("Failed to execute durable YoizenClaw request: %s", error)
        failed_payload = {
            **started_payload,
            "state": "failed",
            "completedAt": datetime.now(timezone.utc).isoformat(),
            "result": {
                "errorCode": "EXECUTION_FAILED",
                "errorMessage": str(error),
            },
        }
        await _publish_execution_event(
            nats_client,
            tenant_id,
            "execution_failed",
            failed_payload,
        )
        raise


async def _publish_execution_event(
    nats_client: Any,
    tenant_id: str,
    action: str,
    payload: dict[str, Any],
) -> None:
    subject = shared_subjects.build_runtime_gateway_subject(tenant_id, action)
    envelope = {
        "tenant": tenant_id,
        "data": {"payload": payload},
    }
    await nats_client.publish(
        subject,
        json_dumps(envelope),
        headers=create_nats_headers_with_trace(),
    )
