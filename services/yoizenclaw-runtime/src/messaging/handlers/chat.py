"""Handler for chat-related NATS messages."""

from __future__ import annotations

import logging
from typing import Any

from nats.aio.msg import Msg
from opentelemetry import trace

from src.messaging._nats_tracing import TracedNatsHandler
from src.messaging.utils import json_dumps, resolve_reply_subject
from src.utils.config.settings import bootstrap_settings
from src.utils.telemetry.nats_propagator import create_nats_headers_with_trace

import subjects as shared_subjects
from envelope import EnvelopeSource
from nats_helpers import wrap_error_reply, wrap_reply

logger = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)


def build_subject(action: str) -> str:
    """Build NATS subject for tenant."""
    return shared_subjects.build_subject(bootstrap_settings.TENANT_ID, action)


async def handle_chat_respond(
    nats_client: Any,
    message: Msg,
    data: dict[str, Any],
    envelope: dict[str, Any],
) -> None:
    """Handle chat request events."""
    reply_subject = resolve_reply_subject(message, data)
    headers = getattr(message, "headers", None)
    header_reply = None
    if headers is not None:
        header_reply = (
            headers.get("x-reply-to")
            or headers.get("Nats-Msg-Reply")
            or headers.get("Nats-Msg-Reply-To")
        )

    logger.info(
        "Chat reply routing resolved=%s raw=%s header=%s",
        reply_subject,
        message.reply,
        header_reply,
    )

    if not reply_subject:
        logger.warning("Ignoring chat request without reply subject")
        return

    subject = build_subject("chat_respond")
    envelope_id = envelope.get("id", "unknown")

    with TracedNatsHandler(_tracer, "nats.consume", subject, message) as handler:
        handler.set_attribute("nats.has_reply", True)

        try:
            from src.utils.chat import (
                ChatRequest,
                generate_chat_reply,
            )

            response = await generate_chat_reply(ChatRequest(**data))
            reply = wrap_reply(
                envelope_id,
                EnvelopeSource.CLAW,
                response.model_dump(),
            )

            reply_headers = create_nats_headers_with_trace()
            await nats_client.publish(
                reply_subject,
                json_dumps(reply),
                headers=reply_headers,
            )
        except Exception as error:
            logger.exception("Failed to process chat request via NATS: %s", error)

            error_reply = wrap_error_reply(
                envelope_id,
                EnvelopeSource.CLAW,
                "CHAT_ERROR",
                str(error),
            )
            try:
                reply_headers = create_nats_headers_with_trace()
                await nats_client.publish(
                    reply_subject,
                    json_dumps(error_reply),
                    headers=reply_headers,
                )
            except Exception:
                pass

            # Important for JetStream consumers: we already sent an error reply,
            # so this message is considered handled and should not be redelivered
            # in an endless loop.
            return
