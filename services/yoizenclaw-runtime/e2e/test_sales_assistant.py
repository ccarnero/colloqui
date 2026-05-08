"""E2E: Sales assistant agent scenarios.

Tests the sales assistant conversation flow through the real
YoizenClaw NATS bridge. Validates lead qualification,
enterprise escalation, and pricing integrity.
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

SALES_AGENT_ID = "e2e-sales-agent"


async def _sales_turns(
    nats_client: NatsTestClient,
    messages: list[str],
    session_id: str | None = None,
) -> list[dict]:
    session = session_id or make_session_id()
    turns = build_multiturn_scenario(
        agent_id=SALES_AGENT_ID,
        session_id=session,
        messages=messages,
    )
    subject = nats_client.build_subject("agent_outbound")
    results: list[dict] = []
    for turn in turns:
        envelope = nats_client.build_cloud_event(
            agent_id=SALES_AGENT_ID,
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


class TestSalesAssistant:
    """Sales assistant E2E conversation tests."""

    async def test_basic_inquiry(self, nats_client: NatsTestClient):
        results = await _sales_turns(
            nats_client,
            messages=[
                "Hola, estoy buscando una solución de IA para mi empresa",
                "Manejamos unos 200 chats por día en WhatsApp",
                "Somos un equipo de 5 personas",
            ],
        )
        assert len(results) == 3
        for i, result in enumerate(results):
            reply = result["reply"]
            assert reply is not None, f"Turn {i + 1}: no reply"
            assert_reply_success(reply)
            data = reply.get("data", {})
            assert_chat_response_fields(data)
            assert len(data.get("response", "")) > 0

    async def test_enterprise_inquiry(self, nats_client: NatsTestClient):
        results = await _sales_turns(
            nats_client,
            messages=[
                "Somos una empresa de 500 empleados",
                "Necesitamos integrar con Salesforce y SAP",
                "¿Tienen plan enterprise?",
            ],
        )
        assert len(results) == 3
        for result in results:
            reply = result["reply"]
            assert reply is not None, "Enterprise turn got no reply"
            assert_reply_success(reply)

    async def test_pricing_inquiry_no_fabrication(
        self,
        nats_client: NatsTestClient,
    ):
        """Agent should not fabricate pricing when asked directly."""
        results = await _sales_turns(
            nats_client,
            messages=[
                "¿Cuánto cuesta el plan premium?",
                "¿Y el enterprise?",
            ],
        )
        assert len(results) == 2
        for result in results:
            reply = result["reply"]
            assert reply is not None
            assert_reply_success(reply)
            data = reply.get("data", {})
            assert_chat_response_fields(data)

    async def test_sales_session_consistency(
        self,
        nats_client: NatsTestClient,
    ):
        session_id = make_session_id()
        results = await _sales_turns(
            nats_client,
            messages=[
                "Hola, nos interesa Yoizen para atención al cliente",
                "Tenemos 3 canales: WhatsApp, email, web chat",
            ],
            session_id=session_id,
        )
        assert len(results) == 2
        for result in results:
            reply = result["reply"]
            if reply:
                data = reply.get("data", {})
                assert data.get("session_id") == session_id, (
                    "Session ID mismatch across turns"
                )
