"""E2E: Advanced multi-turn scenarios.

Tests conversation resilience: typo handling, memory persistence,
and multi-session isolation with different agents.
All scenarios validate REAL system behaviour via NATS request/reply.
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
)
from e2e.helpers.factories import (
    make_session_id,
    build_multiturn_scenario,
)


pytestmark = pytest.mark.e2e


async def _send_and_collect(
    nats_client: NatsTestClient,
    turns: list[dict],
) -> list[dict]:
    subject = nats_client.build_subject("agent_outbound")
    results: list[dict] = []

    for turn in turns:
        envelope = nats_client.build_cloud_event(
            agent_id=turn["agent_id"],
            action="agent_outbound",
            payload=turn,
        )
        raw = await nats_client.request_reply(subject, envelope)
        results.append(
            {
                "turn": turn,
                "reply": parse_reply(raw),
            }
        )
        await asyncio.sleep(0.3)

    return results


class TestMultiturnAvanzado:
    """Advanced multi-turn conversation scenarios."""

    async def test_medical_with_typos(
        self,
        nats_client: NatsTestClient,
    ):
        """Agent should handle messages with typos and still respond."""
        session_id = make_session_id()

        turns = build_multiturn_scenario(
            agent_id="e2e-medical-agent",
            session_id=session_id,
            messages=[
                "Hola doctrina, tngo dolor de cabesa y fiebre",
                "Dsd ayer, y tmb tengo tos seka",
                "Soy diabetiko y tengo presion alta",
            ],
        )

        results = await _send_and_collect(nats_client, turns)

        assert len(results) == 3

        for i, result in enumerate(results):
            reply = result["reply"]
            assert reply is not None, f"Turn {i + 1}: no reply (typos test)"
            assert_reply_success(reply)

            data = reply.get("data", {})
            assert_chat_response_fields(data)
            assert len(data.get("response", "")) > 0, (
                f"Turn {i + 1}: empty response despite valid message"
            )

    async def test_engineering_memory_persistence(
        self,
        nats_client: NatsTestClient,
    ):
        """Agent should recall stack info from earlier turns."""
        session_id = make_session_id()

        turns = build_multiturn_scenario(
            agent_id="e2e-engineering-agent",
            session_id=session_id,
            messages=[
                "Estoy usando Kubernetes con Node.js en mi proyecto",
                "Mi equipo tiene 5 desarrolladores",
                "¿Qué herramientas me recomiendas para mi stack?",
            ],
        )

        results = await _send_and_collect(nats_client, turns)

        assert len(results) == 3
        last_reply = results[-1]["reply"]
        assert last_reply is not None, "Last turn received no reply"

        assert_reply_success(last_reply)
        assert_chat_response_content(
            last_reply,
            expected_keywords=["Kubernetes"],
        )

    async def test_topic_switching(
        self,
        nats_client: NatsTestClient,
    ):
        """Agent should handle abrupt topic changes within one session."""
        session_id = make_session_id()

        turns = build_multiturn_scenario(
            agent_id="e2e-test-agent",
            session_id=session_id,
            messages=[
                "Explícame la mecánica cuántica",
                "Ahora cambiamos: ¿cómo funciona la relatividad general?",
                "Volviendo: ¿cómo se unen cuántica y relatividad?",
            ],
        )

        results = await _send_and_collect(nats_client, turns)

        assert len(results) == 3
        for result in results:
            reply = result["reply"]
            assert reply is not None, "No reply on topic switch turn"
            assert_reply_success(reply)

    async def test_concurrent_sessions_different_agents(
        self,
        nats_client: NatsTestClient,
    ):
        """Two agents in parallel sessions should not interfere."""
        session_med = make_session_id()
        session_eng = make_session_id()

        turns_med = build_multiturn_scenario(
            agent_id="e2e-medical-agent",
            session_id=session_med,
            messages=["Tengo fiebre", "Y también tos"],
        )
        turns_eng = build_multiturn_scenario(
            agent_id="e2e-engineering-agent",
            session_id=session_eng,
            messages=["Necesito ayuda con Docker", "Y también con Kubernetes"],
        )

        results_med = await _send_and_collect(nats_client, turns_med)
        results_eng = await _send_and_collect(nats_client, turns_eng)

        assert len(results_med) == 2
        assert len(results_eng) == 2

        for result in results_med:
            if result["reply"]:
                assert result["reply"].get("data", {}).get("session_id") == session_med

        for result in results_eng:
            if result["reply"]:
                assert result["reply"].get("data", {}).get("session_id") == session_eng
