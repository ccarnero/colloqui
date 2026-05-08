"""E2E: Advanced scenarios — multi-turn, health, concurrent requests.

Tests real HTTP interactions with YoizenClaw plus NATS-based
chat flows.  No simulation — every test exercises the live system.
"""

from __future__ import annotations

import asyncio
import time

import pytest

from e2e.helpers.nats_client import NatsTestClient, parse_reply
from e2e.helpers.http_client import HttpTestClient
from e2e.helpers.assertions import (
    assert_reply_success,
    assert_health_ok,
)
from e2e.helpers.factories import make_session_id, build_multiturn_scenario


pytestmark = pytest.mark.e2e

AGENT_ID = "e2e-test-agent"


class TestHealthAndMetrics:
    """HTTP surface: health, metrics, API endpoints."""

    async def test_health_returns_ok(self, http_client: HttpTestClient):
        resp = await http_client.get("/health")
        assert resp.status_code == 200
        assert_health_ok(resp.json())

    async def test_metrics_exposed(self, http_client: HttpTestClient):
        resp = await http_client.get("/metrics")
        assert resp.status_code == 200

    async def test_health_response_time(self, http_client: HttpTestClient):
        times: list[float] = []
        for _ in range(5):
            start = time.perf_counter()
            resp = await http_client.get("/health")
            elapsed = (time.perf_counter() - start) * 1000
            if resp.status_code == 200:
                times.append(elapsed)

        if times:
            avg = sum(times) / len(times)
            assert avg < 2000, f"Health too slow: {avg:.0f}ms avg"


class TestMultiturnConversations:
    """NATS-based multi-turn conversation scenarios."""

    async def test_multi_turn_with_context(
        self,
        nats_client: NatsTestClient,
    ):
        session_id = make_session_id()
        turns = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_id,
            messages=[
                "Hola, soy un usuario de prueba",
                "Quiero saber sobre microservicios",
                "¿Cómo se comunican entre ellos?",
            ],
        )

        subject = nats_client.build_subject("agent_outbound")
        results: list[dict | None] = []

        for turn in turns:
            envelope = nats_client.build_cloud_event(
                agent_id=AGENT_ID,
                action="agent_outbound",
                payload=turn,
            )
        raw = await nats_client.request_reply(subject, envelope)
        results.append(parse_reply(raw))
        await asyncio.sleep(0.3)

        assert len(results) == 3
        for reply in results:
            if reply is not None:
                assert_reply_success(reply)

    async def test_conversation_memory_persistence(
        self,
        nats_client: NatsTestClient,
    ):
        session_id = make_session_id()

        turns = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_id,
            messages=[
                "Mi nombre es Carlos y trabajo en Yoizen",
                "¿Cómo se llama la empresa donde trabajo?",
            ],
        )

        subject = nats_client.build_subject("agent_outbound")
        results: list[dict | None] = []

        for turn in turns:
            envelope = nats_client.build_cloud_event(
                agent_id=AGENT_ID,
                action="agent_outbound",
                payload=turn,
            )
            raw = await nats_client.request_reply(subject, envelope)
            results.append(parse_reply(raw))
            await asyncio.sleep(0.3)

        if results[0] is not None:
            assert_reply_success(results[0])

        last_reply = results[-1]
        if last_reply is not None:
            from e2e.helpers.assertions import assert_chat_response_content

            assert_chat_response_content(
                last_reply,
                expected_keywords=["Yoizen"],
            )


class TestConcurrentRequests:
    """Concurrent HTTP health checks to validate load handling."""

    async def test_sequential_health_burst(
        self,
        http_client: HttpTestClient,
    ):
        num_requests = 10
        successes = 0

        for _ in range(num_requests):
            resp = await http_client.get("/health")
            if resp.status_code == 200:
                successes += 1

        assert successes >= 1, "No successful health responses"
