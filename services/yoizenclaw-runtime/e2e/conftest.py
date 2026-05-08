"""Shared pytest fixtures for YoizenClaw E2E tests.

All fixtures are session-scoped by default to avoid reconnecting
NATS / HTTP clients for every single test function.
"""

from __future__ import annotations

import asyncio
import logging

import pytest
import yaml

from e2e.helpers.config import E2EConfig
from e2e.helpers.nats_client import NatsTestClient
from e2e.helpers.http_client import HttpTestClient
from e2e.helpers.factories import build_agent_config_for_sync


logger = logging.getLogger(__name__)

# Agent IDs used across the E2E suite.
E2E_AGENT_IDS = [
    "e2e-test-agent",
    "e2e-medical-agent",
    "e2e-engineering-agent",
    "e2e-sales-agent",
]


@pytest.fixture(scope="session")
def e2e_config() -> E2EConfig:
    return E2EConfig()


@pytest.fixture(scope="session")
async def http_client(e2e_config: E2EConfig) -> HttpTestClient:
    client = HttpTestClient(
        base_url=e2e_config.yoizenclaw_url,
        api_key=e2e_config.api_key,
    )
    await client.start()
    yield client
    await client.close()


@pytest.fixture(scope="session")
async def healthy_service(http_client: HttpTestClient) -> HttpTestClient:
    """Ensure the YoizenClaw service is healthy before running any E2E test."""
    ok = await http_client.wait_for_healthy(timeout=30)
    if not ok:
        pytest.skip("YoizenClaw service not healthy — skipping E2E suite")
    return http_client


@pytest.fixture(scope="session")
async def nats_client(
    e2e_config: E2EConfig,
    healthy_service: HttpTestClient,
) -> NatsTestClient:
    """NATS client — depends on healthy_service so infra is guaranteed."""
    client = NatsTestClient(tenant_id=e2e_config.tenant_id)
    await client.connect()
    yield client
    await client.close()


@pytest.fixture(scope="session", autouse=True)
async def _seed_and_cleanup_test_agents(nats_client: NatsTestClient) -> None:
    """Register test agents via config_sync and cleanup at session end.

    Without this, any chat request to a non-existent agent_id will
    receive a CHAT_ERROR from the system.
    """
    import aiohttp

    subject = nats_client.build_subject("config_sync")

    # Build all agent configs first
    all_files = []
    for agent_id in E2E_AGENT_IDS:
        config_result = build_agent_config_for_sync(
            agent_id=agent_id,
            system_prompt=f"You are a helpful test assistant. Agent ID: {agent_id}",
        )
        # build_agent_config_for_sync returns list with {path, content} for legacy format
        # Extract the content directly
        if isinstance(config_result, list) and len(config_result) > 0:
            content = config_result[0].get("content", "")
        else:
            # Enhanced format - convert to YAML
            content = yaml.dump(
                config_result, default_flow_style=False, allow_unicode=True
            )

        all_files.append(
            {
                "path": f"agents/runtime/{agent_id}.yaml",
                "content": content,
            }
        )

    # Send single config_sync with all files in proper dict format
    envelope = nats_client.build_cloud_event(
        agent_id="e2e-seeder",
        action="config_sync",
        payload={"files": all_files, "delete_paths": []},
    )
    await nats_client.publish(subject, envelope)
    logger.info("Published config_sync with %d agent configs", len(all_files))

    # Wait for config_sync to be processed and agents to be available
    # The config_sync triggers an async reload, so we need to wait
    logger.info("Waiting for agent reload to complete...")
    await asyncio.sleep(15)  # Give more time for reload to complete

    # Wait for agents to be registered by polling the health endpoint
    health_url = "http://localhost:8080/health"
    timeout = 60
    start = asyncio.get_event_loop().time()

    while (asyncio.get_event_loop().time() - start) < timeout:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(health_url) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        # Check if runtime is configured (agents are loaded)
                        # Accept both "healthy" and "degraded" as long as configured=True
                        if data.get("configured") is True:
                            logger.info(
                                "Agents seeded and runtime is ready (status=%s)",
                                data.get("status"),
                            )
                            break
        except Exception as e:
            logger.debug("Health check failed: %s", e)
        await asyncio.sleep(1)
    else:
        logger.warning("Timeout waiting for agents to be ready, proceeding anyway")

    # Yield to let all tests run
    yield

    # NOTE: Cleanup disabled - tests were failing because cleanup runs before tests complete
    # To cleanup manually, restart the yoizenclaw container
    logger.info("Skipping cleanup - agents will persist")


@pytest.fixture(autouse=True)
async def _ensure_nats_connected(nats_client: NatsTestClient) -> None:
    """Reconnect NATS if the connection was lost between tests."""
    if not nats_client.is_connected:
        await nats_client.connect()
