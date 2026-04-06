"""Async HTTP client wrapper for E2E tests.

Wraps ``httpx.AsyncClient`` with sensible defaults for hitting
the YoizenClaw FastAPI surface.
"""

from __future__ import annotations

from typing import Any

import httpx

from e2e.helpers.config import config


class HttpTestClient:
    """Async HTTP client for YoizenClaw API E2E tests."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self._base_url = (base_url or config.yoizenclaw_url).rstrip("/")
        self._api_key = api_key or config.api_key
        self._client: httpx.AsyncClient | None = None

    async def start(self) -> None:
        headers: dict[str, str] = {}
        if self._api_key:
            headers["X-API-Key"] = self._api_key
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=headers,
            timeout=httpx.Timeout(30.0),
        )

    async def close(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    @property
    def client(self) -> httpx.AsyncClient:
        assert self._client is not None, "HTTP client not started"
        return self._client

    async def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.client.get(path, **kwargs)

    async def post(self, path: str, **kwargs: Any) -> httpx.Response:
        return await self.client.post(path, **kwargs)

    async def health(self) -> httpx.Response:
        return await self.get("/health")

    async def wait_for_healthy(self, timeout: float | None = None) -> bool:
        import asyncio

        deadline = asyncio.get_event_loop().time() + (
            timeout or config.health_timeout_seconds
        )
        while asyncio.get_event_loop().time() < deadline:
            try:
                resp = await self.health()
                if resp.status_code == 200:
                    return True
            except Exception:
                pass
            await asyncio.sleep(1)
        return False
