"""Backend transport client for Yoizen runtime integrations."""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import httpx
from nats.aio.client import Client as NATS

from src.shared.config.settings import bootstrap_settings as settings

shared_types_path = os.path.join(os.path.dirname(__file__), "..", "..", "..", "shared", "types", "python")
if shared_types_path not in sys.path:
    sys.path.insert(0, os.path.abspath(shared_types_path))

from envelope import EnvelopeSource
import subjects as shared_subjects
from nats_helpers import wrap_command, wrap_error_reply, wrap_reply

_DEFAULT_TIMEOUT = 30.0
_TOOL_REQUEST_SUBJECT = shared_subjects.TOOL_REQUEST


def get_http_client() -> httpx.AsyncClient:
    """Return the shared HTTP client."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.yoizen_http_client is None:
        container.yoizen_http_client = httpx.AsyncClient(
            timeout=_DEFAULT_TIMEOUT,
            limits=httpx.Limits(max_keepalive_connections=20, max_connections=100),
        )
    return container.yoizen_http_client


async def close_http_client() -> None:
    """Close the shared HTTP client."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.yoizen_http_client is not None:
        await container.yoizen_http_client.aclose()
    container.yoizen_http_client = None


async def get_nats_client() -> NATS:
    """Return the shared NATS client."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    client = container.yoizen_nats_client
    if client is None or not client.is_connected:
        client = NATS()
        await client.connect(
            servers=[settings.NATS_URL],
            connect_timeout=_DEFAULT_TIMEOUT,
            name="yoizenclaw-tools-client",
        )
        container.yoizen_nats_client = client
    return client


async def close_nats_client() -> None:
    """Close the shared NATS client."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    client = container.yoizen_nats_client
    if client is not None and client.is_connected:
        await client.drain()
    container.yoizen_nats_client = None


class BackendClient:
    """Async HTTP client for the backend API."""

    def __init__(self) -> None:
        self.base_url = self._resolve_base_url()
        self.api_key = self._resolve_api_key()
        self.timeout = _DEFAULT_TIMEOUT

    @staticmethod
    def _resolve_base_url() -> str:
        return settings.backend_http_url

    @staticmethod
    def _resolve_api_key() -> str:
        return settings.backend_http_api_key

    def _get_headers(
        self,
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, str]:
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json",
        }
        if extra_headers:
            headers.update(extra_headers)
        return headers

    @staticmethod
    def _is_tool_path(path: str) -> bool:
        normalized_path = path.strip()
        return normalized_path.startswith("/tools/") or normalized_path.startswith(
            "/api/tools/",
        )

    async def _request_tool_via_nats(
        self,
        method: str,
        path: str,
        *,
        data: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        command = wrap_command(
            "tool.request",
            {
                "method": method,
                "path": path,
                "data": data or {},
                "headers": headers or {},
                "params": params or {},
            },
            EnvelopeSource.CLAW,
        )
        response = await (await get_nats_client()).request(
            _TOOL_REQUEST_SUBJECT,
            json.dumps(command).encode("utf-8"),
            timeout=self.timeout,
        )
        raw_response = response.data.decode("utf-8").strip()
        if not raw_response:
            return {}
        reply = json.loads(raw_response)
        if reply.get("kind") == "reply":
            if reply.get("success") and reply.get("data") is not None:
                return reply["data"]
            error_info = reply.get("error", {})
            raise Exception(error_info.get("message", "Tool request failed"))
        return reply

    async def get(
        self,
        path: str,
        params: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        if self._is_tool_path(path):
            return await self._request_tool_via_nats(
                "GET",
                path,
                params=params,
                headers=headers,
            )

        url = f"{self.base_url}{path}"
        response = await get_http_client().get(
            url,
            headers=self._get_headers(headers),
            params=params,
            timeout=self.timeout,
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"Server error ({e.response.status_code}) at {url}: {e.response.text[:200]}",
                    request=e.request,
                    response=e.response,
                )
            raise
        return response.json()

    async def post(
        self,
        path: str,
        data: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        if self._is_tool_path(path):
            return await self._request_tool_via_nats(
                "POST",
                path,
                data=data,
                headers=headers,
            )

        url = f"{self.base_url}{path}"
        response = await get_http_client().post(
            url,
            headers=self._get_headers(headers),
            json=data,
            timeout=self.timeout,
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"Server error ({e.response.status_code}) at {url}: {e.response.text[:200]}",
                    request=e.request,
                    response=e.response,
                )
            raise
        return response.json()

    async def put(
        self,
        path: str,
        data: dict[str, Any],
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        if self._is_tool_path(path):
            return await self._request_tool_via_nats(
                "PUT",
                path,
                data=data,
                headers=headers,
            )

        url = f"{self.base_url}{path}"
        response = await get_http_client().put(
            url,
            headers=self._get_headers(headers),
            json=data,
            timeout=self.timeout,
        )
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as e:
            if e.response.status_code >= 500:
                raise httpx.HTTPStatusError(
                    f"Server error ({e.response.status_code}) at {url}: {e.response.text[:200]}",
                    request=e.request,
                    response=e.response,
                )
            raise
        return response.json()


# Legacy compatibility alias for existing imports.
YoizenClient = BackendClient
