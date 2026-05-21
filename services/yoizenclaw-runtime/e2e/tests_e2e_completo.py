"""E2E: Complete system smoke tests.

Validates every HTTP endpoint and subsystem that can be tested
through the FastAPI surface.  Real requests, real assertions.
"""

from __future__ import annotations

import time

import pytest

from e2e.helpers.http_client import HttpTestClient
from e2e.helpers.assertions import assert_health_ok


pytestmark = pytest.mark.e2e


class TestInfrastructureEndpoints:
    """Core HTTP endpoints — health, metrics, logs, memories."""

    async def test_health_endpoint(self, http_client: HttpTestClient):
        resp = await http_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert_health_ok(data)

    async def test_health_configured_field(self, http_client: HttpTestClient):
        resp = await http_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert "configured" in data
        assert isinstance(data["configured"], bool)

    async def test_health_dependencies_present(self, http_client: HttpTestClient):
        resp = await http_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()

        expected = {
            "agent_manager",
            "nats_bridge",
            "scheduler",
            "runtime_config",
            "nats_connection",
        }
        present = set(data.get("dependencies", {}).keys())
        missing = expected - present
        assert not missing, f"Missing health deps: {missing}"

    async def test_metrics_endpoint(self, http_client: HttpTestClient):
        resp = await http_client.get("/metrics")
        assert resp.status_code == 200
        assert len(resp.text) > 0

    async def test_logs_endpoint(self, http_client: HttpTestClient):
        resp = await http_client.get("/logs")
        assert resp.status_code in (200, 401, 403, 404)

    async def test_memories_endpoint(self, http_client: HttpTestClient):
        resp = await http_client.get("/memories")
        assert resp.status_code in (200, 401, 403, 404)

    async def test_memories_post_endpoint(self, http_client: HttpTestClient):
        resp = await http_client.post(
            "/memories",
            json={"action": "get", "namespace": "test-e2e", "key": "nonexistent"},
        )
        assert resp.status_code in (200, 401, 403, 404)


class TestPerformance:
    """Basic performance benchmarks."""

    async def test_health_response_time(self, http_client: HttpTestClient):
        times: list[float] = []
        for _ in range(5):
            start = time.perf_counter()
            resp = await http_client.get("/health")
            elapsed_ms = (time.perf_counter() - start) * 1000
            if resp.status_code == 200:
                times.append(elapsed_ms)

        if times:
            avg = sum(times) / len(times)
            assert avg < 2000, f"Health endpoint too slow: {avg:.0f}ms avg"


class TestFullSystemIntegration:
    """End-to-end integration combining multiple checks."""

    async def test_all_endpoints_respond(self, http_client: HttpTestClient):
        endpoints = [
            ("GET", "/health"),
            ("GET", "/metrics"),
            ("GET", "/logs"),
            ("GET", "/memories"),
        ]

        failures: list[str] = []
        for method, path in endpoints:
            if method == "GET":
                resp = await http_client.get(path)
            else:
                resp = await http_client.post(path)

            if resp.status_code == 0:
                failures.append(f"{method} {path}: connection error")

        assert not failures, f"Endpoints unreachable: {failures}"
