"""Handler for chat requests with session memory."""

from __future__ import annotations

import logging
from typing import Any
from datetime import datetime, timezone

from nats.aio.msg import Msg
from opentelemetry import trace

from src.messaging._nats_tracing import TracedNatsHandler
from src.messaging.utils import json_dumps, resolve_reply_subject
from src.utils.telemetry.nats_propagator import create_nats_headers_with_trace
from src.utils.config.settings import bootstrap_settings
from src.app.conversation.memory_store import get_conversation_store
from src.utils.chat import (
    ChatRequest as LegacyChatRequest,
    ChatResponse as LegacyChatResponse,
    generate_chat_reply,
)
from src.messaging.models.chat import ChatRequest, ChatResponse

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
    """Handle chat request events with session memory."""
    reply_subject = resolve_reply_subject(message, data)
    if not reply_subject:
        logger.warning("Ignoring chat request without reply subject")
        return

    subject = build_subject("chat_respond")
    envelope_id = envelope.get("id", "unknown")

    with TracedNatsHandler(_tracer, "nats.consume", subject, message) as handler:
        handler.set_attribute("nats.has_reply", True)

        try:
            # Parse chat request
            chat_request = ChatRequest(**data)

            handler.set_attribute("chat.session_id", chat_request.session_id)
            handler.set_attribute("chat.agent_id", chat_request.agent_id)
            handler.set_attribute("chat.turn_number", chat_request.turn_number)

            # Get conversation memory
            memory_store = get_conversation_store()
            conversation_context = await memory_store.get_context(
                chat_request.session_id, max_turns=10
            )

            # Build context string for prompt
            context_str = ""
            for turn in conversation_context:
                if turn.role == "user":
                    context_str += f"User: {turn.content}\n"
                else:
                    context_str += f"Assistant: {turn.content}\n"

            # Store user turn in memory
            await memory_store.add_turn(
                session_id=chat_request.session_id,
                agent_id=chat_request.agent_id,
                chat_id=chat_request.chat_id,
                role="user",
                content=chat_request.message,
                turn_number=chat_request.turn_number,
                timestamp=chat_request.timestamp,
            )

            # Build legacy request for existing chat system
            legacy_request = LegacyChatRequest(
                agentId=chat_request.agent_id,
                message=chat_request.message,
                conversationId=chat_request.session_id,
                chatId=chat_request.chat_id,
                userId=chat_request.user_id,
                context=None,  # We'll build this from memory
            )

            # Generate response using existing system
            legacy_response = await generate_chat_reply(legacy_request)

            # Store assistant turn in memory
            await memory_store.add_turn(
                session_id=chat_request.session_id,
                agent_id=chat_request.agent_id,
                chat_id=chat_request.chat_id,
                role="assistant",
                content=legacy_response.response,
                turn_number=chat_request.turn_number,
                timestamp=datetime.now(timezone.utc),
            )

            # Build response
            chat_response = ChatResponse(
                chat_id=chat_request.chat_id,
                agent_id=chat_request.agent_id,
                response=legacy_response.response,
                turn_number=chat_request.turn_number,
                session_id=chat_request.session_id,
                user_id=chat_request.user_id,
                timestamp=datetime.now(timezone.utc),
                metadata=legacy_response.metadata,
            )

            reply = wrap_reply(
                envelope_id,
                EnvelopeSource.CLAW,
                chat_response.model_dump(),
            )

            reply_headers = create_nats_headers_with_trace()
            await nats_client.publish(
                reply_subject,
                json_dumps(reply),
                headers=reply_headers,
            )

            handler.set_attribute("chat.response_length", len(legacy_response.response))
            handler.set_attribute("chat.context_turns", len(conversation_context))

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

            # We already emitted an error reply; avoid JetStream redelivery loops.
            return
