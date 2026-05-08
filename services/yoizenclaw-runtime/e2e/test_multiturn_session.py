"""E2E: Multi-turn conversations with session-based payloads.

Validates the 6-field session chat contract against the real
YoizenClaw NATS bridge:
  chat_id, agent_id, message, turn_number, session_id, timestamp

Requires a running YoizenClaw instance connected to NATS.
Agents are seeded via config_sync in conftest.py.
"""

from __future__ import annotations

import asyncio

import pytest

from e2e.helpers.nats_client import NatsTestClient, parse_reply
from e2e.helpers.assertions import (
    assert_reply_success,
    assert_chat_response_fields,
    assert_chat_response_content,
    assert_session_isolation,
)
from e2e.helpers.factories import (
    make_session_id,
    build_multiturn_scenario,
)


pytestmark = pytest.mark.e2e

AGENT_ID = "e2e-test-agent"


async def _send_turns(
    nats_client: NatsTestClient,
    turns: list[dict],
) -> list[dict]:
    """Send a sequence of session turns and return parsed replies."""
    subject = nats_client.build_subject("agent_outbound")
    replies: list[dict] = []

    for turn_payload in turns:
        envelope = nats_client.build_cloud_event(
            agent_id=turn_payload["agent_id"],
            action="agent_outbound",
            payload=turn_payload,
        )
        raw = await nats_client.request_reply(subject, envelope)
        reply = parse_reply(raw)
        replies.append(
            {
                "turn": turn_payload,
                "reply": reply,
            }
        )
        await asyncio.sleep(0.3)

    return replies


class TestMultiturnSession:
    """Session-based multi-turn conversation tests."""

    async def test_basic_conversation_session(
        self,
        nats_client: NatsTestClient,
    ):
        session_id = make_session_id()

        turns = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_id,
            messages=[
                "Hola, tengo una consulta general",
                "Me gustaría saber más sobre el servicio",
                "¿Cuáles son las opciones disponibles?",
            ],
        )

        results = await _send_turns(nats_client, turns)

        assert len(results) == 3

        for i, result in enumerate(results):
            reply = result["reply"]
            assert reply is not None, f"Turn {i + 1}: no reply received"
            assert_reply_success(reply)

            data = reply.get("data", {})
            assert_chat_response_fields(data)
            assert data["session_id"] == session_id, f"Session mismatch on turn {i + 1}"

    async def test_memory_persistence_across_turns(
        self,
        nats_client: NatsTestClient,
    ):
        """Agent should remember information from earlier turns."""
        session_id = make_session_id()

        turns = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_id,
            messages=[
                "Mi nombre es Carlos y trabajo en Yoizen",
                "¿Cómo se llama la empresa donde trabajo?",
            ],
        )

        results = await _send_turns(nats_client, turns)

        assert len(results) == 2
        last_reply = results[-1]["reply"]
        assert last_reply is not None, "Memory query got no reply"

        assert_chat_response_content(
            last_reply,
            expected_keywords=["Yoizen"],
        )

    async def test_topic_switching(
        self,
        nats_client: NatsTestClient,
    ):
        """Agent should handle topic changes within one session."""
        session_id = make_session_id()

        turns = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_id,
            messages=[
                "Hablemos de inteligencia artificial",
                "Cambiando de tema: ¿cómo funciona Kubernetes?",
                "Volviendo a IA: ¿cómo se relaciona con Kubernetes?",
            ],
        )

        results = await _send_turns(nats_client, turns)

        assert len(results) == 3

        for result in results:
            reply = result["reply"]
            assert reply is not None, "No reply for topic switch turn"
            assert_reply_success(reply)

    async def test_session_isolation(
        self,
        nats_client: NatsTestClient,
    ):
        session_a = make_session_id()
        session_b = make_session_id()

        turns_a = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_a,
            messages=["Contexto A: estoy hablando de fútbol"],
        )
        turns_b = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_b,
            messages=["Contexto B: estoy hablando de cocina"],
        )

        results_a = await _send_turns(nats_client, turns_a)
        results_b = await _send_turns(nats_client, turns_b)

        assert len(results_a) == 1
        assert len(results_b) == 1

        reply_a = results_a[0]["reply"]
        reply_b = results_b[0]["reply"]

        if reply_a and reply_b:
            assert_session_isolation(
                reply_a.get("data", {}),
                reply_b.get("data", {}),
            )
