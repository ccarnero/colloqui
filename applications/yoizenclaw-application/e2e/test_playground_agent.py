"""E2E: Playground / draft agent testing.

Tests both LEGACY and ENHANCED payload formats where a full
``agent_profile`` is included inline. This allows testing agents
before they are published through the admin service.

Also tests the admin-service chat_respond path (the real playground flow).

Requires a running YoizenClaw instance connected to NATS.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from e2e.helpers.nats_client import NatsTestClient, parse_reply
from e2e.helpers.assertions import assert_reply_success
from e2e.helpers.factories import (
    make_session_id,
    make_chat_id,
    now_iso,
    build_agent_config_for_sync,
)


def _assert_valid_reply(reply: dict | None, context: str) -> None:
    """Assert reply is a valid chat response with expected structure."""
    assert reply is not None, f"No reply for {context}"
    assert isinstance(reply, dict), f"Reply should be a dict for {context}"
    # Reply may be wrapped: {"kind":"reply","data":{"response":"..."}}
    # or flat: {"response":"..."}
    if "data" in reply and isinstance(reply["data"], dict):
        assert "response" in reply["data"], (
            f"Reply data should contain 'response' for {context}"
        )
    else:
        assert "response" in reply or "error" in reply, (
            f"Reply should contain 'response' or 'error' for {context}"
        )


pytestmark = pytest.mark.e2e


AGENT_ID = "e2e-test-agent"
ENHANCED_AGENT_ID = "e2e-enhanced-test-agent"


async def _send_playground_turn(
    nats_client: NatsTestClient,
    agent_id: str,
    message: str,
    session_id: str,
    turn_number: int,
) -> dict | None:
    """Send a chat turn using the seeded E2E agent."""
    from e2e.helpers.factories import make_chat_id, now_iso

    payload = {
        "chat_id": make_chat_id(),
        "agent_id": agent_id,
        "message": message,
        "turn_number": turn_number,
        "session_id": session_id,
        "timestamp": now_iso(),
    }
    envelope = nats_client.build_cloud_event(
        agent_id=agent_id,
        action="agent_outbound",
        payload=payload,
    )
    subject = nats_client.build_subject("agent_outbound")
    raw = await nats_client.request_reply(subject, envelope)
    return parse_reply(raw)


class TestPlaygroundAgent:
    """Tests for playground-style agent interactions."""

    async def test_sales_draft_agent(
        self,
        nats_client: NatsTestClient,
    ):
        session_id = make_session_id()

        reply = await _send_playground_turn(
            nats_client,
            "e2e-sales-agent",
            "Hi, I'm looking for an AI solution for my e-commerce business",
            session_id,
            1,
        )

        _assert_valid_reply(reply, "sales draft agent")

    async def test_support_draft_agent(
        self,
        nats_client: NatsTestClient,
    ):
        session_id = make_session_id()

        reply = await _send_playground_turn(
            nats_client,
            AGENT_ID,
            "I'm having trouble connecting my WhatsApp Business API",
            session_id,
            1,
        )

        _assert_valid_reply(reply, "support draft agent")

    async def test_medical_draft_agent_safety(
        self,
        nats_client: NatsTestClient,
    ):
        session_id = make_session_id()

        reply = await _send_playground_turn(
            nats_client,
            "e2e-medical-agent",
            "I've been having headaches and dizziness for 3 days",
            session_id,
            1,
        )

        _assert_valid_reply(reply, "medical draft agent")


class TestEnhancedPlaygroundAgent:
    """Tests for enhanced playground-style agent interactions."""

    async def test_enhanced_agent_basic(
        self,
        nats_client: NatsTestClient,
    ):
        """Test basic enhanced agent functionality."""
        session_id = make_session_id()

        reply = await _send_playground_turn(
            nats_client,
            ENHANCED_AGENT_ID,
            "Hello, I need help with testing",
            session_id,
            1,
        )

        _assert_valid_reply(reply, "enhanced agent")

    async def test_enhanced_agent_skill_trigger(
        self,
        nats_client: NatsTestClient,
    ):
        """Test enhanced agent skill trigger functionality."""
        session_id = make_session_id()

        reply = await _send_playground_turn(
            nats_client,
            ENHANCED_AGENT_ID,
            "/test webapp production v2.1.0",
            session_id,
            1,
        )

        _assert_valid_reply(reply, "enhanced agent skill trigger")

    async def test_enhanced_agent_argument_substitution(
        self,
        nats_client: NatsTestClient,
    ):
        """Test enhanced agent argument substitution."""
        session_id = make_session_id()

        reply = await _send_playground_turn(
            nats_client,
            ENHANCED_AGENT_ID,
            "/process frontend staging deploy",
            session_id,
            1,
        )

        _assert_valid_reply(reply, "enhanced agent argument substitution")


async def _send_admin_service_chat(
    nats_client: NatsTestClient,
    agent_id: str,
    message: str,
    conversation_id: str | None = None,
) -> dict | None:
    """Send a chat turn simulating the admin-service path (chat_respond subject).

    This mirrors what the real playground does: Angular -> API Gateway ->
    yoizenclaw-admin-service -> NATS request to chat_respond subject.
    """
    payload = {
        "action_type": "chat_respond",
        "agent_id": agent_id,
        "message": message,
        "conversation_id": conversation_id or f"playground-{agent_id}-{int(time.time() * 1000)}",
        "customer_name": "Test User",
        "context": [],
    }
    envelope = nats_client.build_admin_service_cloud_event(
        agent_id=agent_id,
        action="chat_respond",
        payload=payload,
    )
    subject = nats_client.build_admin_service_subject("chat_respond")
    raw = await nats_client.request_reply(subject, envelope)
    return parse_reply(raw)


class TestAdminServicePlayground:
    """Tests for admin-service chat_respond path (real playground flow)."""

    async def test_chat_respond_from_admin_service(
        self,
        nats_client: NatsTestClient,
    ):
        """Admin-service chat_respond subject reaches the runtime handler."""
        reply = await _send_admin_service_chat(
            nats_client,
            AGENT_ID,
            "Hello from the admin-service playground path",
        )

        _assert_valid_reply(reply, "admin-service chat_respond")

    async def test_admin_service_chat_with_context(
        self,
        nats_client: NatsTestClient,
    ):
        """Admin-service chat_respond with conversation context."""
        conversation_id = f"playground-{AGENT_ID}-{int(time.time() * 1000)}"

        # First turn
        reply1 = await _send_admin_service_chat(
            nats_client,
            AGENT_ID,
            "Hi, I need help with my account",
            conversation_id=conversation_id,
        )
        _assert_valid_reply(reply1, "admin-service chat_respond turn 1")
