"""NATS handlers for memory proposal admin actions."""

from __future__ import annotations

import logging
from typing import Any

from nats.aio.msg import Msg

from src.app.memory.scoped_service import default_tenant_id, get_scoped_memory_service
from src.messaging.utils import json_dumps, resolve_reply_subject

from envelope import EnvelopeSource
from nats_helpers import wrap_error_reply, wrap_reply

logger = logging.getLogger(__name__)


async def handle_memory_proposals_list(
    nats_client: Any,
    message: Msg,
    data: dict[str, Any],
    envelope: dict[str, Any],
) -> None:
    """List tenant memory proposals over NATS request/reply."""

    reply_subject = resolve_reply_subject(message, data)
    if not reply_subject:
        return

    envelope_id = envelope.get("id", "unknown")
    service = get_scoped_memory_service()
    try:
        items = await service.list_proposals(
            tenant_id=default_tenant_id(),
            status=str(data.get("status", "proposed")),
            kind=str(data.get("kind")) if data.get("kind") is not None else None,
            limit=int(data.get("limit", 50)),
        )
        reply = wrap_reply(
            envelope_id,
            EnvelopeSource.CLAW,
            {"items": [service.serialize_record(item) for item in items]},
        )
        await nats_client.publish(reply_subject, json_dumps(reply))
    except Exception as error:
        logger.exception("Failed to list memory proposals: %s", error)
        error_reply = wrap_error_reply(
            envelope_id,
            EnvelopeSource.CLAW,
            "MEMORY_PROPOSALS_LIST_ERROR",
            str(error),
        )
        await nats_client.publish(reply_subject, json_dumps(error_reply))


async def handle_memory_proposals_approve(
    nats_client: Any,
    message: Msg,
    data: dict[str, Any],
    envelope: dict[str, Any],
) -> None:
    """Approve a tenant memory proposal over NATS request/reply."""

    await _handle_proposal_decision(
        nats_client=nats_client,
        message=message,
        data=data,
        envelope=envelope,
        action="approve",
    )


async def handle_memory_proposals_reject(
    nats_client: Any,
    message: Msg,
    data: dict[str, Any],
    envelope: dict[str, Any],
) -> None:
    """Reject a tenant memory proposal over NATS request/reply."""

    await _handle_proposal_decision(
        nats_client=nats_client,
        message=message,
        data=data,
        envelope=envelope,
        action="reject",
    )


async def _handle_proposal_decision(
    *,
    nats_client: Any,
    message: Msg,
    data: dict[str, Any],
    envelope: dict[str, Any],
    action: str,
) -> None:
    reply_subject = resolve_reply_subject(message, data)
    if not reply_subject:
        return

    envelope_id = envelope.get("id", "unknown")
    memory_id = str(data.get("memory_id") or data.get("id") or "").strip()
    service = get_scoped_memory_service()

    try:
        if action == "approve":
            record = await service.approve_proposal(
                tenant_id=default_tenant_id(),
                memory_id=memory_id,
                actor=str(data.get("actor")) if data.get("actor") else None,
                reason=str(data.get("reason")) if data.get("reason") else None,
            )
        else:
            record = await service.reject_proposal(
                tenant_id=default_tenant_id(),
                memory_id=memory_id,
                actor=str(data.get("actor")) if data.get("actor") else None,
                reason=str(data.get("reason")) if data.get("reason") else None,
            )

        reply = wrap_reply(
            envelope_id,
            EnvelopeSource.CLAW,
            {
                "success": record is not None,
                "item": service.serialize_record(record) if record else None,
            },
        )
        await nats_client.publish(reply_subject, json_dumps(reply))
    except Exception as error:
        logger.exception("Failed to %s memory proposal: %s", action, error)
        error_reply = wrap_error_reply(
            envelope_id,
            EnvelopeSource.CLAW,
            f"MEMORY_PROPOSALS_{action.upper()}_ERROR",
            str(error),
        )
        await nats_client.publish(reply_subject, json_dumps(error_reply))
