"""E2E test configuration loaded from environment variables."""

from __future__ import annotations

import os


class E2EConfig:
    """Centralised configuration for E2E tests.

    Every value can be overridden via environment variables so the suite
    works both locally and in CI.
    """

    @property
    def nats_url(self) -> str:
        return os.getenv("NATS_URL", "nats://localhost:4222")

    @property
    def yoizenclaw_url(self) -> str:
        return os.getenv("YOIZENCLAW_URL", "http://localhost:8080")

    @property
    def api_key(self) -> str:
        return os.getenv("RUNTIME_API_KEY", "")

    @property
    def tenant_id(self) -> str:
        return os.getenv("TENANT_ID", "test-tenant")

    @property
    def chat_timeout_seconds(self) -> float:
        return float(os.getenv("E2E_CHAT_TIMEOUT", "30"))

    @property
    def health_timeout_seconds(self) -> float:
        return float(os.getenv("E2E_HEALTH_TIMEOUT", "10"))

    @property
    def startup_wait_seconds(self) -> float:
        return float(os.getenv("E2E_STARTUP_WAIT", "5"))


config = E2EConfig()
