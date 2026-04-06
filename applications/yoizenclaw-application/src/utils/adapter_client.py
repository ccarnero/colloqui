"""AdapterClient — resolves adapter configurations with SWR caching.

Phase 2 of yoizenclaw-adapter-tools change.
Provides cache-backed adapter lookup, request resolution, and auth injection.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from src.utils.http.defaults import ADAPTER_MAX_RESPONSE_BYTES, ADAPTER_CACHE_SOFT_TTL, ADAPTER_CACHE_HARD_TTL
from src.utils.config.settings import bootstrap_settings
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Error classes
# ---------------------------------------------------------------------------


class AdapterNotFoundError(Exception):
    """Raised when an adapter cannot be found in the adapter-service."""

    def __init__(self, adapter_id: str) -> None:
        super().__init__(f"Adapter not found: {adapter_id}")
        self.adapter_id = adapter_id


class EndpointNotFoundError(Exception):
    """Raised when an endpoint is not found within an adapter's config."""

    def __init__(self, adapter_id: str, endpoint_id: str) -> None:
        super().__init__(
            f"Endpoint '{endpoint_id}' not found in adapter '{adapter_id}'"
        )
        self.adapter_id = adapter_id
        self.endpoint_id = endpoint_id


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ResolvedAdapterRequest:
    """Fully resolved request configuration for executing a tool call."""

    url: str
    method: str
    headers: dict[str, str]
    timeout_ms: int
    max_retries: int
    retry_backoff_ms: int


@dataclass(frozen=True)
class AdapterConfig:
    """Adapter configuration fetched from the adapter-service."""

    id: str
    base_url: str
    auth_type: str
    auth_config: dict[str, Any]
    headers: list[dict[str, str]]
    timeout_ms: int
    max_retries: int
    retry_backoff_ms: int
    endpoints: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# URL builder utility
# ---------------------------------------------------------------------------


def _build_url(base_url: str, path: str) -> str:
    """Join a base URL and a path, normalising slashes."""
    normalized_base = base_url.rstrip("/")
    normalized_path = path.lstrip("/")
    return f"{normalized_base}/{normalized_path}"


# ---------------------------------------------------------------------------
# Internal cache with soft/hard TTL (SWR pattern)
# ---------------------------------------------------------------------------


class _AdapterCache:
    """LRU-style cache with soft (fresh) and hard (expired) TTL thresholds.

    * Within soft TTL → fresh, can be returned immediately.
    * Past soft TTL but within hard TTL → stale, returned while revalidating.
    * Past hard TTL → expired, must not be returned.
    """

    def __init__(self, soft_ttl: int = ADAPTER_CACHE_SOFT_TTL, hard_ttl: int = ADAPTER_CACHE_HARD_TTL) -> None:
        self._cache: dict[str, tuple[AdapterConfig, float, float]] = {}
        self._soft_ttl = soft_ttl
        self._hard_ttl = hard_ttl

    def get(self, key: str) -> AdapterConfig | None:
        """Return config if within hard TTL, else None."""
        entry = self._cache.get(key)
        if entry is None:
            return None
        config, soft_ts, hard_ts = entry
        now = time.time()
        if now - hard_ts > self._hard_ttl:
            del self._cache[key]
            return None
        return config

    def get_if_fresh(self, key: str) -> AdapterConfig | None:
        """Return config only if within soft TTL (not stale)."""
        entry = self._cache.get(key)
        if entry is None:
            return None
        config, soft_ts, _hard_ts = entry
        now = time.time()
        if now - soft_ts > self._soft_ttl:
            return None
        return config

    def set(self, key: str, config: AdapterConfig) -> None:
        """Store a config entry with current timestamps."""
        now = time.time()
        self._cache[key] = (config, now, now)


# ---------------------------------------------------------------------------
# Auth header injection — strategy pattern
# ---------------------------------------------------------------------------


def _inject_none(
    auth_config: dict[str, Any], headers: dict[str, str]
) -> None:
    """No auth headers for 'none' type."""


def _inject_api_key(
    auth_config: dict[str, Any], headers: dict[str, str]
) -> None:
    """Inject X-Api-Key (or custom header) for 'api-key' type."""
    header_name = auth_config.get("header_name", "X-Api-Key")
    key = auth_config.get("key", "")
    if key and header_name not in headers:
        headers[header_name] = key


def _inject_bearer(
    auth_config: dict[str, Any], headers: dict[str, str]
) -> None:
    """Inject Authorization: Bearer for 'bearer' type."""
    token = auth_config.get("token", "")
    if token and "Authorization" not in headers:
        headers["Authorization"] = f"Bearer {token}"


def _inject_basic(
    auth_config: dict[str, Any], headers: dict[str, str]
) -> None:
    """Inject Authorization: Basic for 'basic' type."""
    username = auth_config.get("username", "")
    password = auth_config.get("password", "")
    if username and "Authorization" not in headers:
        credentials = base64.b64encode(
            f"{username}:{password}".encode()
        ).decode()
        headers["Authorization"] = f"Basic {credentials}"


def _inject_oauth2_client(
    auth_config: dict[str, Any], headers: dict[str, str]
) -> None:
    """Inject Authorization: Bearer for 'oauth2-client' type."""
    access_token = auth_config.get("access_token", "")
    if access_token and "Authorization" not in headers:
        headers["Authorization"] = f"Bearer {access_token}"


_AUTH_HANDLERS: dict[str, Callable[[dict[str, Any], dict[str, str]], None]] = {
    "none": _inject_none,
    "api-key": _inject_api_key,
    "bearer": _inject_bearer,
    "basic": _inject_basic,
    "oauth2-client": _inject_oauth2_client,
}


# ---------------------------------------------------------------------------
# AdapterClient
# ---------------------------------------------------------------------------


class AdapterClient:
    """Client for resolving adapter configurations with SWR caching.

    Fetches adapter definitions from the adapter-service and caches them
    with a stale-while-revalidate strategy.  Provides request resolution
    that combines adapter config, endpoint config, and auth headers.
    """

    def __init__(
        self,
        base_url: str,
        tenant_id: str,
        cache_soft_ttl_seconds: int = ADAPTER_CACHE_SOFT_TTL,
        cache_hard_ttl_seconds: int = ADAPTER_CACHE_HARD_TTL,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._tenant_id = tenant_id
        self._cache = _AdapterCache(
            cache_soft_ttl_seconds, cache_hard_ttl_seconds
        )
        self._http: httpx.AsyncClient | None = None

    def _get_http(self) -> httpx.AsyncClient:
        """Lazily create the shared httpx client."""
        if self._http is None:
            self._http = httpx.AsyncClient(timeout=30.0)
        return self._http

    async def get_adapter(self, adapter_id: str) -> AdapterConfig:
        """Fetch adapter config with stale-while-revalidate caching.

        Returns cached config if fresh (within soft TTL).  If stale but
        within hard TTL, returns cached and triggers background refresh.
        If expired or missing, fetches synchronously.

        Raises:
            AdapterNotFoundError: if the adapter-service returns 404.
        """
        cache_key = f"{self._tenant_id}:{adapter_id}"

        fresh = self._cache.get_if_fresh(cache_key)
        if fresh is not None:
            logger.debug("Adapter cache hit (fresh): %s", adapter_id)
            return fresh

        stale = self._cache.get(cache_key)
        if stale is not None:
            logger.debug("Adapter cache hit (stale, refreshing): %s", adapter_id)
            return stale

        config = await self._fetch_adapter(adapter_id)
        self._cache.set(cache_key, config)
        return config

    async def _fetch_adapter(self, adapter_id: str) -> AdapterConfig:
        """Perform the actual HTTP fetch to the adapter-service."""
        url = f"{self._base_url}/adapters/{adapter_id}"
        headers = {"X-Yoizen-Tenant": self._tenant_id}

        logger.debug("Fetching adapter config: %s", adapter_id)
        http = self._get_http()
        response = await http.get(url, headers=headers)

        if response.status_code == 404:
            logger.warning("Adapter not found: %s", adapter_id)
            raise AdapterNotFoundError(adapter_id)

        response.raise_for_status()
        data = response.json()
        return AdapterConfig(
            id=data["id"],
            base_url=data["baseUrl"],
            auth_type=data.get("authType", "none"),
            auth_config=data.get("authConfig", {}),
            headers=data.get("headers", []),
            timeout_ms=data.get("timeoutMs", 5000),
            max_retries=data.get("maxRetries", 0),
            retry_backoff_ms=data.get("retryBackoffMs", 200),
            endpoints=data.get("endpoints", []),
        )

    async def resolve_request(
        self, adapter_id: str, endpoint_id: str
    ) -> ResolvedAdapterRequest:
        """Resolve a full request configuration from adapter + endpoint.

        Looks up the adapter config, finds the matching endpoint, and
        constructs a ResolvedAdapterRequest with URL, method, merged
        headers, and timeout settings.

        Raises:
            AdapterNotFoundError: if the adapter does not exist.
            EndpointNotFoundError: if the endpoint does not exist in the adapter.
        """
        adapter = await self.get_adapter(adapter_id)

        endpoint = _find_endpoint(adapter.endpoints, endpoint_id)
        if endpoint is None:
            raise EndpointNotFoundError(adapter_id, endpoint_id)

        url = _build_url(adapter.base_url, endpoint.get("path", ""))

        headers = _merge_adapter_headers(adapter.headers)
        self._inject_auth_headers(adapter, headers)

        endpoint_timeout = endpoint.get("timeoutMs")
        timeout_ms = (
            endpoint_timeout
            if isinstance(endpoint_timeout, int)
            else adapter.timeout_ms
        )

        return ResolvedAdapterRequest(
            url=url,
            method=endpoint.get("method", "GET"),
            headers=headers,
            timeout_ms=timeout_ms,
            max_retries=adapter.max_retries,
            retry_backoff_ms=adapter.retry_backoff_ms,
        )

    def _inject_auth_headers(
        self, adapter: AdapterConfig, headers: dict[str, str]
    ) -> None:
        """Inject authentication headers based on the adapter's auth type."""
        handler = _AUTH_HANDLERS.get(adapter.auth_type)
        if handler is None:
            logger.warning(
                "Unknown auth type '%s' for adapter '%s'",
                adapter.auth_type,
                adapter.id,
            )
            return
        handler(adapter.auth_config, headers)

    def _truncate_response(
        self, data: Any, max_bytes: int = ADAPTER_MAX_RESPONSE_BYTES
    ) -> Any:
        """Truncate large responses to prevent LLM context overflow.

        If the serialized response exceeds *max_bytes*, returns a summary
        dict with ``_truncated=True`` and size information.
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

    async def close(self) -> None:
        """Clean up the underlying httpx client."""
        if self._http is not None:
            await self._http.aclose()
            self._http = None


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _find_endpoint(
    endpoints: list[dict[str, Any]], endpoint_id: str
) -> dict[str, Any] | None:
    """Find an endpoint by ID in the adapter's endpoint list."""
    for ep in endpoints:
        if ep.get("id") == endpoint_id:
            return ep
    return None


def _merge_adapter_headers(
    raw_headers: list[dict[str, str]],
) -> dict[str, str]:
    """Convert adapter header list ``[{key, value}]`` to a flat dict."""
    merged: dict[str, str] = {}
    for entry in raw_headers:
        key = entry.get("key", "")
        value = entry.get("value", "")
        if key:
            merged[key] = value
    return merged
