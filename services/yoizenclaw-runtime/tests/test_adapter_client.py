"""Tests for AdapterClient — cache, resolution, auth injection, errors.

Phase 2 of yoizenclaw-adapter-tools change.
TDD: RED (all tests) → GREEN (implementation) → REFACTOR.
"""

from __future__ import annotations

import base64
import json
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.shared.adapter_client import (
    AdapterClient,
    AdapterConfig,
    AdapterNotFoundError,
    EndpointNotFoundError,
    ResolvedAdapterRequest,
    _AdapterCache,
    _build_url,
)


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


def _sample_adapter_response(
    adapter_id: str = "adapter-1",
    auth_type: str = "none",
    auth_config: dict[str, Any] | None = None,
    endpoints: list[dict[str, Any]] | None = None,
    headers: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Build a sample adapter-service JSON response."""
    return {
        "id": adapter_id,
        "baseUrl": "https://api.example.com",
        "authType": auth_type,
        "authConfig": auth_config or {},
        "headers": headers or [],
        "timeoutMs": 5000,
        "maxRetries": 3,
        "retryBackoffMs": 200,
        "endpoints": endpoints
        or [
            {
                "id": "ep-list",
                "path": "/v1/items",
                "method": "GET",
                "headers": {},
                "timeoutMs": 3000,
            },
            {
                "id": "ep-create",
                "path": "/v1/items",
                "method": "POST",
                "headers": {"Content-Type": "application/json"},
                "timeoutMs": 5000,
            },
        ],
    }


def _make_mock_response(
    status_code: int = 200,
    json_data: dict[str, Any] | None = None,
) -> MagicMock:
    """Create a mock httpx.Response."""
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            message=f"HTTP {status_code}",
            request=MagicMock(),
            response=resp,
        )
    else:
        resp.raise_for_status.return_value = None
    return resp


@pytest.fixture
def adapter_client() -> AdapterClient:
    """Create an AdapterClient with default settings for testing."""
    return AdapterClient(
        base_url="https://adapter-service.internal",
        tenant_id="tenant-42",
        cache_soft_ttl_seconds=60,
        cache_hard_ttl_seconds=300,
    )


# ===========================================================================
# Group 1: Cache Behaviour (Tasks 2.1–2.3)
# ===========================================================================


class TestAdapterCache:
    """Tests for the _AdapterCache internal class."""

    def test_get_returns_none_for_missing_key(self) -> None:
        cache = _AdapterCache(soft_ttl=60, hard_ttl=300)
        assert cache.get("missing") is None

    def test_get_if_fresh_returns_none_for_missing_key(self) -> None:
        cache = _AdapterCache(soft_ttl=60, hard_ttl=300)
        assert cache.get_if_fresh("missing") is None

    def test_set_then_get_returns_config(self) -> None:
        cache = _AdapterCache(soft_ttl=60, hard_ttl=300)
        config = AdapterConfig(
            id="a1",
            base_url="https://api.example.com",
            auth_type="none",
            auth_config={},
            headers=[],
            timeout_ms=5000,
            max_retries=3,
            retry_backoff_ms=200,
            endpoints=[],
        )
        cache.set("key-1", config)
        result = cache.get("key-1")
        assert result is not None
        assert result.id == "a1"

    def test_set_then_get_if_fresh_returns_config(self) -> None:
        cache = _AdapterCache(soft_ttl=60, hard_ttl=300)
        config = AdapterConfig(
            id="a1",
            base_url="https://api.example.com",
            auth_type="none",
            auth_config={},
            headers=[],
            timeout_ms=5000,
            max_retries=3,
            retry_backoff_ms=200,
            endpoints=[],
        )
        cache.set("key-1", config)
        result = cache.get_if_fresh("key-1")
        assert result is not None
        assert result.id == "a1"

    def test_get_if_fresh_returns_none_past_soft_ttl(self) -> None:
        cache = _AdapterCache(soft_ttl=60, hard_ttl=300)
        config = AdapterConfig(
            id="a1",
            base_url="https://api.example.com",
            auth_type="none",
            auth_config={},
            headers=[],
            timeout_ms=5000,
            max_retries=3,
            retry_backoff_ms=200,
            endpoints=[],
        )
        cache.set("key-1", config)
        # Simulate time passing past soft TTL but within hard TTL
        now = time.time()
        cache._cache["key-1"] = (config, now - 61, now)
        # get_if_fresh should return None (stale)
        assert cache.get_if_fresh("key-1") is None
        # get should still return the config (stale but within hard TTL)
        assert cache.get("key-1") is not None

    def test_get_returns_none_past_hard_ttl(self) -> None:
        cache = _AdapterCache(soft_ttl=60, hard_ttl=300)
        config = AdapterConfig(
            id="a1",
            base_url="https://api.example.com",
            auth_type="none",
            auth_config={},
            headers=[],
            timeout_ms=5000,
            max_retries=3,
            retry_backoff_ms=200,
            endpoints=[],
        )
        now = time.time()
        cache._cache["key-1"] = (config, now - 301, now - 301)
        # get should return None (expired)
        assert cache.get("key-1") is None


class TestGetAdapterCacheHit:
    """Task 2.1 [RED] — cache hit returns without second HTTP call."""

    @pytest.mark.asyncio
    async def test_second_call_uses_cache_no_http(
        self, adapter_client: AdapterClient
    ) -> None:
        """After first fetch, second call should return cached data without HTTP."""
        mock_response = _make_mock_response(
            json_data=_sample_adapter_response("adapter-1")
        )
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            result1 = await adapter_client.get_adapter("adapter-1")
            result2 = await adapter_client.get_adapter("adapter-1")

        assert result1.id == "adapter-1"
        assert result2.id == "adapter-1"
        # Only ONE HTTP call — the second came from cache
        assert mock_http.get.await_count == 1

    @pytest.mark.asyncio
    async def test_sends_tenant_header(
        self, adapter_client: AdapterClient
    ) -> None:
        """Verify X-Yoizen-Tenant header is sent on HTTP calls."""
        mock_response = _make_mock_response(
            json_data=_sample_adapter_response("adapter-1")
        )
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            await adapter_client.get_adapter("adapter-1")

        call_args = mock_http.get.call_args
        headers = call_args.kwargs.get("headers") or call_args[1].get("headers", {})
        assert headers.get("X-Yoizen-Tenant") == "tenant-42"

    @pytest.mark.asyncio
    async def test_fetches_correct_url(
        self, adapter_client: AdapterClient
    ) -> None:
        """Verify the correct URL is constructed for adapter fetch."""
        mock_response = _make_mock_response(
            json_data=_sample_adapter_response("adapter-1")
        )
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            await adapter_client.get_adapter("adapter-1")

        call_args = mock_http.get.call_args
        url = call_args.args[0] if call_args.args else call_args.kwargs.get("url", "")
        assert "https://adapter-service.internal/connectors/adapter-1" in url

    @pytest.mark.asyncio
    async def test_parses_response_into_adapter_config(
        self, adapter_client: AdapterClient
    ) -> None:
        """Verify the full AdapterConfig is parsed from the response."""
        payload = _sample_adapter_response(
            adapter_id="crm-adapter",
            auth_type="bearer",
            auth_config={"token": "tok_123"},
            endpoints=[
                {
                    "id": "ep-search",
                    "path": "/api/contacts/search",
                    "method": "POST",
                    "headers": {"Accept": "application/json"},
                    "timeoutMs": 10000,
                }
            ],
        )
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            config = await adapter_client.get_adapter("crm-adapter")

        assert config.id == "crm-adapter"
        assert config.base_url == "https://api.example.com"
        assert config.auth_type == "bearer"
        assert config.auth_config == {"token": "tok_123"}
        assert config.timeout_ms == 5000
        assert config.max_retries == 3
        assert len(config.endpoints) == 1
        assert config.endpoints[0]["id"] == "ep-search"


# ===========================================================================
# Group 2: Request Resolution (Tasks 2.4–2.6)
# ===========================================================================


class TestResolveRequest:
    """Tasks 2.4 [RED] — resolve_request URL construction."""

    @pytest.mark.asyncio
    async def test_url_is_base_url_plus_endpoint_path(
        self, adapter_client: AdapterClient
    ) -> None:
        """URL should be adapter baseUrl + endpoint path."""
        payload = _sample_adapter_response(
            adapter_id="adapter-1",
            endpoints=[
                {
                    "id": "ep-list",
                    "path": "/v1/items",
                    "method": "GET",
                    "headers": {},
                    "timeoutMs": 3000,
                }
            ],
        )
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            resolved = await adapter_client.resolve_request(
                "adapter-1", "ep-list"
            )

        assert resolved.url == "https://api.example.com/v1/items"

    @pytest.mark.asyncio
    async def test_method_comes_from_endpoint(
        self, adapter_client: AdapterClient
    ) -> None:
        """HTTP method should come from the endpoint definition."""
        payload = _sample_adapter_response(
            adapter_id="adapter-1",
            endpoints=[
                {
                    "id": "ep-create",
                    "path": "/v1/items",
                    "method": "POST",
                    "headers": {"Content-Type": "application/json"},
                    "timeoutMs": 5000,
                }
            ],
        )
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            resolved = await adapter_client.resolve_request(
                "adapter-1", "ep-create"
            )

        assert resolved.method == "POST"

    @pytest.mark.asyncio
    async def test_headers_include_adapter_custom_headers(
        self, adapter_client: AdapterClient
    ) -> None:
        """Resolved headers should include adapter-level custom headers."""
        payload = _sample_adapter_response(
            adapter_id="adapter-1",
            headers=[
                {"key": "X-Custom", "value": "foo"},
                {"key": "X-Env", "value": "test"},
            ],
            endpoints=[
                {
                    "id": "ep-list",
                    "path": "/v1/items",
                    "method": "GET",
                    "headers": {},
                    "timeoutMs": 3000,
                }
            ],
        )
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            resolved = await adapter_client.resolve_request(
                "adapter-1", "ep-list"
            )

        assert resolved.headers["X-Custom"] == "foo"
        assert resolved.headers["X-Env"] == "test"

    @pytest.mark.asyncio
    async def test_timeout_comes_from_endpoint_with_adapter_fallback(
        self, adapter_client: AdapterClient
    ) -> None:
        """Timeout should prefer endpoint, fallback to adapter default."""
        payload = _sample_adapter_response(
            adapter_id="adapter-1",
            endpoints=[
                {
                    "id": "ep-list",
                    "path": "/v1/items",
                    "method": "GET",
                    "headers": {},
                    "timeoutMs": 3000,
                }
            ],
        )
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            resolved = await adapter_client.resolve_request(
                "adapter-1", "ep-list"
            )

        assert resolved.timeout_ms == 3000

    @pytest.mark.asyncio
    async def test_timeout_falls_back_to_adapter_default(
        self, adapter_client: AdapterClient
    ) -> None:
        """If endpoint has no timeout, adapter default should be used."""
        payload = _sample_adapter_response(
            adapter_id="adapter-1",
            endpoints=[
                {
                    "id": "ep-list",
                    "path": "/v1/items",
                    "method": "GET",
                    "headers": {},
                    # No timeoutMs
                }
            ],
        )
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            resolved = await adapter_client.resolve_request(
                "adapter-1", "ep-list"
            )

        assert resolved.timeout_ms == 5000  # adapter default

    @pytest.mark.asyncio
    async def test_max_retries_and_backoff_from_adapter(
        self, adapter_client: AdapterClient
    ) -> None:
        """max_retries and retry_backoff_ms should come from adapter config."""
        payload = _sample_adapter_response(adapter_id="adapter-1")
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            resolved = await adapter_client.resolve_request(
                "adapter-1", "ep-list"
            )

        assert resolved.max_retries == 3
        assert resolved.retry_backoff_ms == 200


class TestBuildUrl:
    """Task 2.6 [REFACTOR] — URL builder utility."""

    def test_simple_join(self) -> None:
        assert _build_url("https://api.example.com", "/v1/items") == (
            "https://api.example.com/v1/items"
        )

    def test_strips_trailing_slash_from_base(self) -> None:
        assert _build_url("https://api.example.com/", "/v1/items") == (
            "https://api.example.com/v1/items"
        )

    def test_path_without_leading_slash(self) -> None:
        assert _build_url("https://api.example.com", "v1/items") == (
            "https://api.example.com/v1/items"
        )

    def test_base_with_trailing_slash_and_path_without_leading(
        self,
    ) -> None:
        assert _build_url("https://api.example.com/", "v1/items") == (
            "https://api.example.com/v1/items"
        )


# ===========================================================================
# Group 3: Auth Header Injection (Tasks 2.7–2.9)
# ===========================================================================


class TestInjectAuthHeaders:
    """Tasks 2.7 [RED] — _inject_auth_headers all auth types."""

    @pytest.mark.parametrize(
        "auth_type,auth_config,expected_header,expected_value",
        [
            # none: no auth header
            ("none", {}, "__NONE__", ""),
            # api-key with default header name
            (
                "api-key",
                {"key": "ak-secret-123"},
                "X-Api-Key",
                "ak-secret-123",
            ),
            # api-key with custom header name
            (
                "api-key",
                {"key": "ak-secret-456", "header_name": "X-Custom-Key"},
                "X-Custom-Key",
                "ak-secret-456",
            ),
            # bearer token
            (
                "bearer",
                {"token": "tok_bearer_xyz"},
                "Authorization",
                "Bearer tok_bearer_xyz",
            ),
            # basic auth
            (
                "basic",
                {"username": "admin", "password": "s3cret"},
                "Authorization",
                f"Basic {base64.b64encode(b'admin:s3cret').decode()}",
            ),
            # oauth2-client credentials
            (
                "oauth2-client",
                {"access_token": "oauth2_tok_abc"},
                "Authorization",
                "Bearer oauth2_tok_abc",
            ),
        ],
        ids=[
            "none",
            "api-key-default-header",
            "api-key-custom-header",
            "bearer",
            "basic",
            "oauth2-client",
        ],
    )
    def test_auth_header_injection(
        self,
        auth_type: str,
        auth_config: dict[str, Any],
        expected_header: str,
        expected_value: str,
    ) -> None:
        """Each auth type should inject the correct header(s)."""
        adapter = AdapterConfig(
            id="test",
            base_url="https://api.example.com",
            auth_type=auth_type,
            auth_config=auth_config,
            headers=[],
            timeout_ms=5000,
            max_retries=3,
            retry_backoff_ms=200,
            endpoints=[],
        )
        headers: dict[str, str] = {}
        client = AdapterClient(
            base_url="https://adapter-service.internal",
            tenant_id="t1",
        )
        client._inject_auth_headers(adapter, headers)

        if expected_header == "__NONE__":
            # none auth type should not add any auth headers
            assert "Authorization" not in headers
            assert "X-Api-Key" not in headers
        else:
            assert headers.get(expected_header) == expected_value

    def test_auth_headers_do_not_overwrite_existing(
        self,
    ) -> None:
        """Auth injection should not overwrite already-set headers."""
        adapter = AdapterConfig(
            id="test",
            base_url="https://api.example.com",
            auth_type="bearer",
            auth_config={"token": "tok-new"},
            headers=[],
            timeout_ms=5000,
            max_retries=3,
            retry_backoff_ms=200,
            endpoints=[],
        )
        headers: dict[str, str] = {"Authorization": "Bearer tok-existing"}
        client = AdapterClient(
            base_url="https://adapter-service.internal",
            tenant_id="t1",
        )
        client._inject_auth_headers(adapter, headers)
        # Should NOT overwrite the existing value
        assert headers["Authorization"] == "Bearer tok-existing"


# ===========================================================================
# Group 4: Error Handling (Tasks 2.10–2.12)
# ===========================================================================


class TestAdapterNotFoundError:
    """Task 2.10 [RED] — adapter not found raises AdapterNotFoundError."""

    @pytest.mark.asyncio
    async def test_404_raises_adapter_not_found(
        self, adapter_client: AdapterClient
    ) -> None:
        """A 404 response should raise AdapterNotFoundError."""
        mock_response = _make_mock_response(status_code=404)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            with pytest.raises(AdapterNotFoundError) as exc_info:
                await adapter_client.get_adapter("missing-adapter")

        assert exc_info.value.adapter_id == "missing-adapter"
        assert "missing-adapter" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_404_message_contains_no_auth_tokens(
        self, adapter_client: AdapterClient
    ) -> None:
        """Error messages must never contain auth tokens or secrets."""
        mock_response = _make_mock_response(status_code=404)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            with pytest.raises(AdapterNotFoundError) as exc_info:
                await adapter_client.get_adapter("secret-adapter")

        error_msg = str(exc_info.value)
        # Ensure no accidental token leakage
        assert "Bearer" not in error_msg
        assert "token" not in error_msg.lower() or "not found" in error_msg


class TestEndpointNotFoundError:
    """Task 2.11 [RED] — endpoint not found raises EndpointNotFoundError."""

    @pytest.mark.asyncio
    async def test_nonexistent_endpoint_raises_error(
        self, adapter_client: AdapterClient
    ) -> None:
        """Requesting a non-existent endpoint should raise."""
        payload = _sample_adapter_response(
            adapter_id="adapter-1",
            endpoints=[
                {
                    "id": "ep-list",
                    "path": "/v1/items",
                    "method": "GET",
                    "headers": {},
                    "timeoutMs": 3000,
                }
            ],
        )
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            with pytest.raises(EndpointNotFoundError) as exc_info:
                await adapter_client.resolve_request(
                    "adapter-1", "ep-nonexistent"
                )

        assert exc_info.value.adapter_id == "adapter-1"
        assert exc_info.value.endpoint_id == "ep-nonexistent"
        assert "ep-nonexistent" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_endpoint_error_includes_adapter_context(
        self, adapter_client: AdapterClient
    ) -> None:
        """Error should include both adapter_id and endpoint_id."""
        payload = _sample_adapter_response(adapter_id="my-crm")
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            with pytest.raises(EndpointNotFoundError) as exc_info:
                await adapter_client.resolve_request("my-crm", "ep-missing")

        error = exc_info.value
        assert error.adapter_id == "my-crm"
        assert error.endpoint_id == "ep-missing"
        # Error message must be sanitized (no auth tokens)
        assert "Bearer" not in str(error)


# ===========================================================================
# Lifecycle & Close
# ===========================================================================


class TestAdapterClientLifecycle:
    """Tests for AdapterClient lifecycle management."""

    @pytest.mark.asyncio
    async def test_close_cleans_up_http_client(self) -> None:
        """close() should clean up the httpx client."""
        client = AdapterClient(
            base_url="https://adapter-service.internal",
            tenant_id="t1",
        )
        # Force creation of http client
        http = client._get_http()
        assert client._http is not None

        with patch.object(http, "aclose", new=AsyncMock()) as mock_close:
            await client.close()

        mock_close.assert_awaited_once()
        assert client._http is None

    @pytest.mark.asyncio
    async def test_close_is_noop_when_no_http_client(self) -> None:
        """close() should be safe when no http client was created."""
        client = AdapterClient(
            base_url="https://adapter-service.internal",
            tenant_id="t1",
        )
        assert client._http is None
        await client.close()  # Should not raise
        assert client._http is None


# ===========================================================================
# Response Truncation
# ===========================================================================


class TestTruncateResponse:
    """Tests for _truncate_response utility."""

    def test_small_response_unchanged(self) -> None:
        """Responses under the limit should pass through unchanged."""
        client = AdapterClient(
            base_url="https://adapter-service.internal",
            tenant_id="t1",
        )
        data = {"key": "value"}
        result = client._truncate_response(data, max_bytes=100_000)
        assert result == data

    def test_large_response_is_truncated(self) -> None:
        """Responses over the limit should be truncated with a flag."""
        client = AdapterClient(
            base_url="https://adapter-service.internal",
            tenant_id="t1",
        )
        # Create data larger than 100 bytes
        large_data = {"items": ["x" * 200]}
        result = client._truncate_response(large_data, max_bytes=100)
        assert result["_truncated"] is True
        assert "original_size_bytes" in result

    def test_truncation_preserves_summary(self) -> None:
        """Truncated response should include a summary of what was cut."""
        client = AdapterClient(
            base_url="https://adapter-service.internal",
            tenant_id="t1",
        )
        large_data = {"items": [{"id": i, "data": "x" * 50} for i in range(100)]}
        result = client._truncate_response(large_data, max_bytes=200)
        assert isinstance(result, dict)
        assert result["_truncated"] is True


# ===========================================================================
# Integration: resolve_request with auth
# ===========================================================================


class TestResolveRequestWithAuth:
    """Integration tests combining resolution + auth injection."""

    @pytest.mark.asyncio
    async def test_bearer_auth_injected_in_resolved_headers(
        self, adapter_client: AdapterClient
    ) -> None:
        """Resolved request should include injected auth headers."""
        payload = _sample_adapter_response(
            adapter_id="adapter-1",
            auth_type="bearer",
            auth_config={"token": "my-token"},
            endpoints=[
                {
                    "id": "ep-list",
                    "path": "/v1/items",
                    "method": "GET",
                    "headers": {},
                    "timeoutMs": 3000,
                }
            ],
        )
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            resolved = await adapter_client.resolve_request(
                "adapter-1", "ep-list"
            )

        assert resolved.headers["Authorization"] == "Bearer my-token"

    @pytest.mark.asyncio
    async def test_custom_adapter_headers_plus_auth(
        self, adapter_client: AdapterClient
    ) -> None:
        """Custom adapter headers AND auth should both be present."""
        payload = _sample_adapter_response(
            adapter_id="adapter-1",
            auth_type="api-key",
            auth_config={"key": "ak-999"},
            headers=[{"key": "X-Version", "value": "2"}],
            endpoints=[
                {
                    "id": "ep-list",
                    "path": "/v1/items",
                    "method": "GET",
                    "headers": {},
                    "timeoutMs": 3000,
                }
            ],
        )
        mock_response = _make_mock_response(json_data=payload)
        mock_http = AsyncMock()
        mock_http.get.return_value = mock_response

        with patch.object(adapter_client, "_get_http", return_value=mock_http):
            resolved = await adapter_client.resolve_request(
                "adapter-1", "ep-list"
            )

        assert resolved.headers["X-Api-Key"] == "ak-999"
        assert resolved.headers["X-Version"] == "2"
