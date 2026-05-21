"""Default HTTP client configuration constants."""

from __future__ import annotations

import httpx

# Default HTTP client settings
HTTP_DEFAULT_TIMEOUT = 30.0
HTTP_MAX_KEEPALIVE_CONNECTIONS = 20
HTTP_MAX_CONNECTIONS = 100

# Adapter response size limit
ADAPTER_MAX_RESPONSE_BYTES = 100_000

# Adapter cache TTL settings
ADAPTER_CACHE_SOFT_TTL = 60  # seconds
ADAPTER_CACHE_HARD_TTL = 300  # seconds


def create_default_http_client() -> httpx.AsyncClient:
    """Create an HTTP client with default configuration.
    
    Returns:
        Configured httpx.AsyncClient with standard timeouts and limits.
    """
    return httpx.AsyncClient(
        timeout=HTTP_DEFAULT_TIMEOUT,
        limits=httpx.Limits(
            max_keepalive_connections=HTTP_MAX_KEEPALIVE_CONNECTIONS,
            max_connections=HTTP_MAX_CONNECTIONS,
        ),
    )
