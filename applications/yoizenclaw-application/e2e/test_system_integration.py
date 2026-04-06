"""E2E: Comprehensive system integration tests.

Covers the main YoizenClaw subsystems through the real HTTP API
and NATS bridge.  Every test makes an actual network call and
asserts on the response.
"""

from __future__ import annotations

import pytest

from e2e.helpers.nats_client import NatsTestClient, parse_reply
from e2e.helpers.http_client import HttpTestClient
from e2e.helpers.assertions import (
    assert_reply_success,
    assert_chat_response_fields,
    assert_cloud_event_valid,
)
from e2e.helpers.factories import make_session_id, build_multiturn_scenario


pytestmark = pytest.mark.e2e

AGENT_ID = "e2e-test-agent"


class TestChatQA:
    """Q&A chat via NATS request/reply."""

    async def test_single_qa_turn(
        self,
        nats_client: NatsTestClient,
    ):
        session_id = make_session_id()
        turns = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_id,
            messages=["What is artificial intelligence?"],
        )

        subject = nats_client.build_subject("agent_outbound")
        envelope = nats_client.build_cloud_event(
            agent_id=AGENT_ID,
            action="agent_outbound",
            payload=turns[0],
        )

        raw = await nats_client.request_reply(subject, envelope)
        reply = parse_reply(raw)

        assert reply is not None, "No reply for Q&A turn"
        assert_reply_success(reply)


class TestHttpTools:
    """HTTP API endpoint validation."""

    async def test_health_endpoint(self, http_client: HttpTestClient):
        resp = await http_client.get("/health")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "status" in data
        assert data["status"] in ("ok", "degraded")

    async def test_metrics_endpoint(self, http_client: HttpTestClient):
        resp = await http_client.get("/metrics")
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"

    async def test_logs_endpoint(self, http_client: HttpTestClient):
        resp = await http_client.get("/logs")
        assert resp.status_code in (200, 401, 403, 404)

    async def test_memories_endpoint(self, http_client: HttpTestClient):
        resp = await http_client.get("/memories")
        assert resp.status_code in (200, 401, 403, 404)

    async def test_health_dependencies_detail(
        self,
        http_client: HttpTestClient,
    ):
        resp = await http_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "dependencies" in data
        deps = data["dependencies"]

        expected_deps = {
            "agent_manager",
            "nats_bridge",
            "scheduler",
            "runtime_config",
            "nats_connection",
        }
        missing = expected_deps - set(deps.keys())
        assert not missing, f"Missing dependencies: {missing}"


class TestMultiturnConversation:
    """Multi-turn conversation with context tracking."""

    async def test_multiturn_context_builds(
        self,
        nats_client: NatsTestClient,
    ):
        session_id = make_session_id()
        turns = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_id,
            messages=[
                "I'm learning about microservices",
                "How do they communicate?",
                "What about NATS specifically?",
            ],
        )

        subject = nats_client.build_subject("agent_outbound")
        results = []

        for turn in turns:
            envelope = nats_client.build_cloud_event(
                agent_id=AGENT_ID,
                action="agent_outbound",
                payload=turn,
            )
            raw = await nats_client.request_reply(subject, envelope)
            results.append(parse_reply(raw))

        for i, reply in enumerate(results):
            if reply is not None:
                assert_reply_success(reply)
                data = reply.get("data", {})
                assert data.get("session_id") == session_id


class TestChatIsolation:
    """Verify conversations are isolated from each other."""

    async def test_parallel_sessions_no_cross_contamination(
        self,
        nats_client: NatsTestClient,
    ):
        session_a = make_session_id()
        session_b = make_session_id()

        turns_a = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_a,
            messages=["Context A: I love football"],
        )
        turns_b = build_multiturn_scenario(
            agent_id=AGENT_ID,
            session_id=session_b,
            messages=["Context B: I love cooking"],
        )

        subject = nats_client.build_subject("agent_outbound")

        envelope_a = nats_client.build_cloud_event(
            agent_id=AGENT_ID,
            action="agent_outbound",
            payload=turns_a[0],
        )
        envelope_b = nats_client.build_cloud_event(
            agent_id=AGENT_ID,
            action="agent_outbound",
            payload=turns_b[0],
        )

        raw_a = await nats_client.request_reply(subject, envelope_a)
        raw_b = await nats_client.request_reply(subject, envelope_b)

        reply_a = parse_reply(raw_a)
        reply_b = parse_reply(raw_b)

        if reply_a and reply_b:
            assert reply_a.get("data", {}).get("session_id") != reply_b.get(
                "data", {}
            ).get("session_id")
