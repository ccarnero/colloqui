"""Tests for AdapterToolExecutor — execute, truncation, dispatch, feature flag.

Phase 3 of yoizenclaw-adapter-tools change.
TDD: RED (all tests) → GREEN (implementation) → REFACTOR.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from src.shared.adapter_client import (
    AdapterNotFoundError,
    EndpointNotFoundError,
    ResolvedAdapterRequest,
)
from src.shared.config.agent_config import AdapterReference


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------


def _resolved_request(
    url: str = "https://api.example.com/v1/data",
    method: str = "POST",
    headers: dict[str, str] | None = None,
    timeout_ms: int = 5000,
    max_retries: int = 0,
    retry_backoff_ms: int = 200,
) -> ResolvedAdapterRequest:
    """Build a sample ResolvedAdapterRequest."""
    return ResolvedAdapterRequest(
        url=url,
        method=method,
        headers=headers or {"Authorization": "Bearer tok-123"},
        timeout_ms=timeout_ms,
        max_retries=max_retries,
        retry_backoff_ms=retry_backoff_ms,
    )


def _make_httpx_response(
    status_code: int = 200,
    json_data: Any = None,
) -> httpx.Response:
    """Create an httpx.Response with the given status and JSON body."""
    if json_data is None:
        json_data = {"status": "ok"}
    request = httpx.Request("POST", "https://api.example.com/v1/data")
    return httpx.Response(
        status_code=status_code,
        json=json_data,
        request=request,
    )


# ===========================================================================
# Group A: Tool Executor Integration (Tasks 3.1-3.3)
# ===========================================================================


class TestAdapterToolExecutorExecuteSuccess:
    """Task 3.1 [RED]: execute() success path."""

    @pytest.mark.asyncio
    async def test_execute_calls_resolve_request(self) -> None:
        """execute() should call adapter_client.resolve_request()."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = _resolved_request()

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            json_data={"result": "success"},
        )

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        adapter_ref = AdapterReference(
            adapter_id="adapter-1",
            endpoint_id="ep-get-data",
        )

        await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=adapter_ref,
            payload={"query": "test"},
        )

        adapter_client.resolve_request.assert_awaited_once_with(
            "adapter-1", "ep-get-data",
        )

    @pytest.mark.asyncio
    async def test_execute_sends_http_with_correct_url_and_headers(
        self,
    ) -> None:
        """execute() should send HTTP request with correct URL, headers, and tenant."""
        from src.tools.adapter_executor import AdapterToolExecutor

        resolved = _resolved_request(
            url="https://api.example.com/v1/data",
            method="POST",
            headers={"Authorization": "Bearer tok-123"},
        )
        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = resolved

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            json_data={"result": "success"},
        )

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        adapter_ref = AdapterReference(
            adapter_id="adapter-1",
            endpoint_id="ep-get-data",
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=adapter_ref,
            payload={"query": "test"},
        )

        # Verify HTTP request was made with correct parameters
        http_client.request.assert_awaited_once()
        call_kwargs = http_client.request.call_args
        assert call_kwargs.kwargs["method"] == "POST"
        assert call_kwargs.kwargs["url"] == "https://api.example.com/v1/data"

        # Verify X-Yoizen-Tenant header is added
        sent_headers = call_kwargs.kwargs["headers"]
        assert sent_headers["X-Yoizen-Tenant"] == "tenant-abc"
        assert sent_headers["Authorization"] == "Bearer tok-123"

        # Verify payload is sent as JSON body
        assert call_kwargs.kwargs["json"] == {"query": "test"}

    @pytest.mark.asyncio
    async def test_execute_returns_response_body(self) -> None:
        """execute() should return a dict with the response body."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = _resolved_request()

        expected_body = {"users": [{"id": 1, "name": "Alice"}]}
        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            json_data=expected_body,
        )

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-users",
            ),
            payload={},
        )

        assert isinstance(result, dict)
        assert result["users"] == [{"id": 1, "name": "Alice"}]

    @pytest.mark.asyncio
    async def test_execute_uses_timeout_from_resolved_request(self) -> None:
        """execute() should respect timeout_ms from the resolved request."""
        from src.tools.adapter_executor import AdapterToolExecutor

        resolved = _resolved_request(timeout_ms=3000)
        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = resolved

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response()

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-slow",
            ),
            payload={},
        )

        call_kwargs = http_client.request.call_args.kwargs
        assert call_kwargs["timeout"] == httpx.Timeout(3.0)

    @pytest.mark.asyncio
    async def test_execute_handles_4xx_error(self) -> None:
        """execute() should return sanitized error for 4xx responses."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = _resolved_request()

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            status_code=400,
            json_data={"error": "Invalid parameter"},
        )

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-data",
            ),
            payload={"bad": "data"},
        )

        assert result.get("success") is False
        assert "error" in result

    @pytest.mark.asyncio
    async def test_execute_handles_5xx_error(self) -> None:
        """execute() should return sanitized error for 5xx responses."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = _resolved_request()

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            status_code=500,
            json_data={"message": "Internal Server Error"},
        )

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-data",
            ),
            payload={},
        )

        assert result.get("success") is False
        assert "error" in result

    @pytest.mark.asyncio
    async def test_execute_handles_timeout_error(self) -> None:
        """execute() should handle httpx.TimeoutException gracefully."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = _resolved_request()

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.side_effect = httpx.TimeoutException(
            "Request timed out",
        )

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-slow",
            ),
            payload={},
        )

        assert result.get("success") is False
        assert "timed out" in result.get("error", "").lower()

    @pytest.mark.asyncio
    async def test_execute_handles_adapter_not_found(self) -> None:
        """execute() should return error when adapter is not found."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.side_effect = AdapterNotFoundError(
            "adapter-missing",
        )

        http_client = AsyncMock(spec=httpx.AsyncClient)

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-missing",
                endpoint_id="ep-data",
            ),
            payload={},
        )

        assert result.get("success") is False
        assert "adapter-missing" in result.get("error", "")

    @pytest.mark.asyncio
    async def test_execute_handles_endpoint_not_found(self) -> None:
        """execute() should return error when endpoint is not found."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.side_effect = EndpointNotFoundError(
            "adapter-1", "ep-missing",
        )

        http_client = AsyncMock(spec=httpx.AsyncClient)

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-missing",
            ),
            payload={},
        )

        assert result.get("success") is False
        assert "ep-missing" in result.get("error", "")

    @pytest.mark.asyncio
    async def test_execute_returns_error_on_empty_tenant(self) -> None:
        """execute() should return error when tenant_id is empty."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        http_client = AsyncMock(spec=httpx.AsyncClient)

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
        )

        result = await executor.execute(
            tenant_id="",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-data",
            ),
            payload={},
        )

        assert result.get("success") is False
        assert "tenant" in result.get("error", "").lower()


# ===========================================================================
# Group B: Response Handling (Tasks 3.4-3.6)
# ===========================================================================


class TestResponseTruncation:
    """Task 3.4 [RED]: response truncation over 100KB."""

    @pytest.mark.asyncio
    async def test_truncate_large_response(self) -> None:
        """Responses over 100KB should be truncated."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = _resolved_request()

        # Build a response body larger than 100KB
        large_data = {"items": ["x" * 1000 for _ in range(150)]}
        large_json = json.dumps(large_data)
        assert len(large_json.encode("utf-8")) > 100_000

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            json_data=large_data,
        )

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
            max_response_bytes=100_000,
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-large",
            ),
            payload={},
        )

        assert result.get("_truncated") is True
        assert "original_size_bytes" in result or "original_size" in result

    @pytest.mark.asyncio
    async def test_no_truncation_for_small_response(self) -> None:
        """Responses under the limit should pass through unchanged."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = _resolved_request()

        small_data = {"result": "ok", "count": 5}

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            json_data=small_data,
        )

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
            max_response_bytes=100_000,
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-small",
            ),
            payload={},
        )

        assert result.get("_truncated") is None
        assert result["result"] == "ok"
        assert result["count"] == 5

    @pytest.mark.asyncio
    async def test_truncated_response_includes_original_size(self) -> None:
        """Truncated responses should include the original size."""
        from src.tools.adapter_executor import AdapterToolExecutor

        adapter_client = AsyncMock()
        adapter_client.resolve_request.return_value = _resolved_request()

        # Build large response
        large_data = {"items": ["x" * 500 for _ in range(300)]}
        serialized = json.dumps(large_data).encode("utf-8")
        assert len(serialized) > 100_000

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            json_data=large_data,
        )

        executor = AdapterToolExecutor(
            adapter_client=adapter_client,
            http_client=http_client,
            max_response_bytes=100_000,
        )

        result = await executor.execute(
            tenant_id="tenant-abc",
            adapter_ref=AdapterReference(
                adapter_id="adapter-1",
                endpoint_id="ep-large",
            ),
            payload={},
        )

        assert result.get("_truncated") is True
        # Should have original_size_bytes or original_size
        size_key = "original_size_bytes" if "original_size_bytes" in result else "original_size"
        assert result[size_key] > 100_000


class TestResponseTruncator:
    """Task 3.6 [REFACTOR]: standalone _ResponseTruncator."""

    def test_truncate_returns_original_when_under_limit(self) -> None:
        """Data under limit should pass through unchanged."""
        from src.tools.adapter_executor import _ResponseTruncator

        data = {"key": "value", "count": 42}
        result = _ResponseTruncator.truncate(data, 100_000)
        assert result == data

    def test_truncate_adds_flag_for_dict(self) -> None:
        """Large dicts should be truncated with _truncated flag."""
        from src.tools.adapter_executor import _ResponseTruncator

        large_dict = {f"key_{i}": "x" * 1000 for i in range(200)}
        serialized = json.dumps(large_dict).encode("utf-8")
        assert len(serialized) > 100_000

        result = _ResponseTruncator.truncate(large_dict, 100_000)
        assert result["_truncated"] is True
        assert "original_size_bytes" in result
        assert result["original_size_bytes"] == len(serialized)

    def test_truncate_adds_flag_for_list(self) -> None:
        """Large lists should be truncated with _truncated flag."""
        from src.tools.adapter_executor import _ResponseTruncator

        large_list = [{"id": i, "data": "x" * 500} for i in range(300)]
        serialized = json.dumps(large_list).encode("utf-8")
        assert len(serialized) > 100_000

        result = _ResponseTruncator.truncate(large_list, 100_000)
        assert result["_truncated"] is True
        assert result["original_size_bytes"] == len(serialized)

    def test_truncate_preserves_dict_top_keys(self) -> None:
        """Truncated dicts should include top_level_keys summary."""
        from src.tools.adapter_executor import _ResponseTruncator

        large_dict = {f"key_{i}": "x" * 1000 for i in range(200)}
        result = _ResponseTruncator.truncate(large_dict, 100_000)
        assert "top_level_keys" in result
        assert len(result["top_level_keys"]) > 0


# ===========================================================================
# Group C: Tool Dispatch Integration (Tasks 3.7-3.10)
# ===========================================================================


class TestToolExecutorAdapterDispatch:
    """Task 3.7 [RED]: ToolExecutor routes to AdapterToolExecutor."""

    @pytest.mark.asyncio
    async def test_adapter_ref_routes_to_adapter_executor(self) -> None:
        """Tool with adapterRef should delegate to AdapterToolExecutor."""
        from src.application.agents.tool_executor import ToolExecutor
        from src.tools.adapter_executor import AdapterToolExecutor

        mock_adapter_executor = AsyncMock(spec=AdapterToolExecutor)
        mock_adapter_executor.execute.return_value = {
            "result": "from-adapter",
            "success": True,
        }

        tool_registry = MagicMock()
        tool_registry.backend = AsyncMock()

        tools = [
            {
                "name": "adapter-tool-1",
                "enabled": True,
                "endpoint": None,
                "adapterRef": {
                    "adapterId": "adapter-1",
                    "endpointId": "ep-data",
                },
            },
        ]

        executor = ToolExecutor(
            tools=tools,
            tool_registry=tool_registry,
            adapter_tool_executor=mock_adapter_executor,
        )

        state = {"tenant_id": "tenant-abc"}

        with patch(
            "src.tools.adapter_executor._ADAPTER_TOOLS_ENABLED",
            True,
        ):
            result = await executor._execute_configured_tool(
                tool_definition=tools[0],
                payload={"query": "test"},
                state=state,
            )

        mock_adapter_executor.execute.assert_awaited_once()
        call_kwargs = mock_adapter_executor.execute.call_args.kwargs
        assert call_kwargs["tenant_id"] == "tenant-abc"
        assert call_kwargs["payload"] == {"query": "test"}

        # Verify AdapterReference was passed correctly
        adapter_ref = call_kwargs["adapter_ref"]
        assert adapter_ref.adapter_id == "adapter-1"
        assert adapter_ref.endpoint_id == "ep-data"

        assert result["result"] == "from-adapter"


class TestFeatureFlagDisabled:
    """Task 3.9 [RED]: feature flag disabling adapter tools."""

    @pytest.mark.asyncio
    async def test_adapter_tools_disabled_returns_error(self) -> None:
        """When feature flag is off, adapter tools should return error."""
        from src.application.agents.tool_executor import ToolExecutor
        from src.tools.adapter_executor import AdapterToolExecutor

        mock_adapter_executor = AsyncMock(spec=AdapterToolExecutor)

        tool_registry = MagicMock()
        tool_registry.backend = AsyncMock()

        tools = [
            {
                "name": "adapter-tool-1",
                "enabled": True,
                "endpoint": None,
                "adapterRef": {
                    "adapterId": "adapter-1",
                    "endpointId": "ep-data",
                },
            },
        ]

        executor = ToolExecutor(
            tools=tools,
            tool_registry=tool_registry,
            adapter_tool_executor=mock_adapter_executor,
        )

        state = {"tenant_id": "tenant-abc"}

        with patch(
            "src.tools.adapter_executor._ADAPTER_TOOLS_ENABLED",
            False,
        ):
            result = await executor._execute_configured_tool(
                tool_definition=tools[0],
                payload={"query": "test"},
                state=state,
            )

        assert result.get("success") is False
        assert "disabled" in result.get("error", "").lower()

        # Adapter executor should NOT have been called
        mock_adapter_executor.execute.assert_not_awaited()


# ===========================================================================
# Group A continued: _HttpExecutor helper (Task 3.3 REFACTOR)
# ===========================================================================


class TestHttpExecutor:
    """Task 3.3 [REFACTOR]: _HttpExecutor helper."""

    @pytest.mark.asyncio
    async def test_execute_request_makes_http_call(self) -> None:
        """_HttpExecutor should make HTTP request and return parsed body."""
        from src.tools.adapter_executor import _HttpExecutor

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            json_data={"status": "ok"},
        )

        executor = _HttpExecutor()
        result = await executor.execute_request(
            client=http_client,
            method="POST",
            url="https://api.example.com/v1/data",
            headers={"Authorization": "Bearer tok"},
            payload={"query": "test"},
            timeout_ms=5000,
        )

        http_client.request.assert_awaited_once_with(
            method="POST",
            url="https://api.example.com/v1/data",
            headers={"Authorization": "Bearer tok"},
            json={"query": "test"},
            timeout=httpx.Timeout(5.0),
        )
        assert result["status"] == "ok"

    @pytest.mark.asyncio
    async def test_execute_request_handles_timeout(self) -> None:
        """_HttpExecutor should map TimeoutException to error dict."""
        from src.tools.adapter_executor import _HttpExecutor

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.side_effect = httpx.TimeoutException("timeout")

        executor = _HttpExecutor()
        result = await executor.execute_request(
            client=http_client,
            method="GET",
            url="https://api.example.com/slow",
            headers={},
            payload={},
            timeout_ms=1000,
        )

        assert result.get("success") is False
        assert "timed out" in result.get("error", "").lower()

    @pytest.mark.asyncio
    async def test_execute_request_handles_http_error(self) -> None:
        """_HttpExecutor should map HTTP error status to error dict."""
        from src.tools.adapter_executor import _HttpExecutor

        http_client = AsyncMock(spec=httpx.AsyncClient)
        http_client.request.return_value = _make_httpx_response(
            status_code=422,
            json_data={"error": "Validation failed"},
        )

        executor = _HttpExecutor()
        result = await executor.execute_request(
            client=http_client,
            method="POST",
            url="https://api.example.com/data",
            headers={},
            payload={"bad": "data"},
            timeout_ms=5000,
        )

        assert result.get("success") is False
        assert "422" in result.get("error", "")
