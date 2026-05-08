"""AdapterToolExecutor — executes tools via resolved adapter configurations.

Resolves adapter/endpoint via AdapterClient, executes HTTP calls, handles
errors and response truncation.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from src.utils.adapter_client import (
    AdapterClient,
    AdapterNotFoundError,
    EndpointNotFoundError,
)
from src.utils.config.agent_config import AdapterReference

logger = logging.getLogger(__name__)

_ADAPTER_TOOLS_ENABLED = True


def is_adapter_tools_enabled() -> bool:
    """Return whether adapter tools are enabled.

    Previously controlled by YOIZENCLAW_ADAPTER_TOOLS_ENABLED feature flag.
    Now permanently enabled after production validation.
    """
    return True


class _ResponseTruncator:
    """Truncates large responses to prevent LLM context overflow."""

    @staticmethod
    def truncate(data: Any, max_bytes: int) -> dict[str, Any]:
        """Truncate *data* if its serialized size exceeds *max_bytes*.

        Returns the original data unchanged when under the limit.
        For oversized responses, returns a summary dict with
        ``_truncated=True`` and size information.
        """
        serialized = json.dumps(data, default=str)
        size_bytes = len(serialized.encode("utf-8"))

        if size_bytes <= max_bytes:
            return data

        logger.info(
            "Truncating response: %d bytes exceeds limit of %d",
            size_bytes,
            max_bytes,
        )

        if isinstance(data, dict):
            keys_summary = list(data.keys())[:20]
            return {
                "_truncated": True,
                "original_size_bytes": size_bytes,
                "top_level_keys": keys_summary,
                "message": (
                    f"Response truncated: {size_bytes} bytes exceeded "
                    f"limit of {max_bytes} bytes"
                ),
            }

        if isinstance(data, list):
            return {
                "_truncated": True,
                "original_size_bytes": size_bytes,
                "item_count": len(data),
                "message": (
                    f"Response truncated: {size_bytes} bytes exceeded "
                    f"limit of {max_bytes} bytes"
                ),
            }

        return {
            "_truncated": True,
            "original_size_bytes": size_bytes,
            "message": (
                f"Response truncated: {size_bytes} bytes exceeded "
                f"limit of {max_bytes} bytes"
            ),
        }


class _HttpExecutor:
    """Handles actual HTTP calls with error mapping."""

    async def execute_request(
        self,
        client: httpx.AsyncClient,
        method: str,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        timeout_ms: int,
    ) -> dict[str, Any]:
        """Execute an HTTP request and return the parsed JSON body.

        Maps timeout and HTTP errors to error dicts with ``success=False``.
        """
        timeout_seconds = timeout_ms / 1000.0
        try:
            response = await client.request(
                method=method,
                url=url,
                headers=headers,
                json=payload,
                timeout=httpx.Timeout(timeout_seconds),
            )
        except httpx.TimeoutException:
            logger.warning("Adapter request timed out: %s %s", method, url)
            return {
                "success": False,
                "error": f"Request to {url} timed out after {timeout_ms}ms",
            }
        except httpx.RequestError as exc:
            logger.warning("Adapter request failed: %s", exc)
            return {
                "success": False,
                "error": f"Request to {url} failed: {exc}",
            }

        if response.status_code >= 400:
            logger.warning(
                "Adapter returned HTTP %d for %s %s",
                response.status_code,
                method,
                url,
            )
            return {
                "success": False,
                "error": (
                    f"Adapter returned HTTP {response.status_code} "
                    f"for {method} {url}"
                ),
            }

        return response.json()


class AdapterToolExecutor:
    """Executes tool calls via adapter-resolved HTTP requests.

    Uses ``AdapterClient`` to resolve adapter + endpoint into a concrete
    HTTP request configuration, then executes the request and returns
    the response (with optional truncation).
    """

    def __init__(
        self,
        adapter_client: AdapterClient,
        http_client: httpx.AsyncClient,
        max_response_bytes: int = 100_000,
    ) -> None:
        self._adapter_client = adapter_client
        self._http = http_client
        self._max_bytes = max_response_bytes
        self._http_executor = _HttpExecutor()

    async def execute(
        self,
        tenant_id: str,
        adapter_ref: AdapterReference,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute a tool call via adapter resolution.

        Resolves the adapter/endpoint to a concrete HTTP request,
        injects the tenant header, executes, and returns the result.
        """
        if not tenant_id:
            return {"error": "Missing tenant context", "success": False}

        try:
            resolved = await self._adapter_client.resolve_request(
                adapter_ref.adapter_id,
                adapter_ref.endpoint_id,
            )
        except AdapterNotFoundError as exc:
            logger.warning("Adapter not found: %s", exc.adapter_id)
            return {"success": False, "error": str(exc)}
        except EndpointNotFoundError as exc:
            logger.warning(
                "Endpoint not found: %s/%s",
                exc.adapter_id,
                exc.endpoint_id,
            )
            return {"success": False, "error": str(exc)}

        merged_headers = dict(resolved.headers)
        merged_headers["X-Yoizen-Tenant"] = tenant_id

        result = await self._http_executor.execute_request(
            client=self._http,
            method=resolved.method,
            url=resolved.url,
            headers=merged_headers,
            payload=payload,
            timeout_ms=resolved.timeout_ms,
        )

        if isinstance(result, dict) and result.get("success") is False:
            return result

        return _ResponseTruncator.truncate(result, self._max_bytes)
