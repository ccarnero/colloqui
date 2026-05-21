"""Tests for the tools module."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.tools.registry import _MEMORY_STORE, ToolRegistry, get_tools, register_tool


class TestToolRegistry:
    """Test suite for ToolRegistry class."""

    @pytest.fixture
    def registry(self) -> ToolRegistry:
        """Create a ToolRegistry instance for testing."""

        return ToolRegistry()

    @pytest.mark.asyncio
    async def test_communicate_posts_generic_payload(self, registry: ToolRegistry) -> None:
        """Test that communicate posts to the generic backend tool."""

        with patch.object(
            registry.backend,
            "post",
            new=AsyncMock(
                return_value={
                    "success": True,
                    "data": {"delivered": True, "message_id": "msg-1"},
                }
            ),
        ) as post:
            result = await registry.communicate(
                action="send",
                target_id="conv-1",
                message="Hello",
                channel="whatsapp",
                priority="high",
                context="Need help",
            )

        post.assert_awaited_once_with(
            "/tools/communicate",
            {
                "action": "send",
                "target_id": "conv-1",
                "message": "Hello",
                "channel": "whatsapp",
                "priority": "high",
                "context": "Need help",
            },
        )
        assert result == {
            "success": True,
            "action": "send",
            "target_id": "conv-1",
            "message": "Hello",
            "channel": "whatsapp",
            "priority": "high",
            "context": "Need help",
            "delivered": True,
            "message_id": "msg-1",
        }

    @pytest.mark.asyncio
    async def test_resource_posts_generic_payload(self, registry: ToolRegistry) -> None:
        """Test that resource posts to the generic backend tool."""

        with patch.object(
            registry.backend,
            "post",
            new=AsyncMock(
                return_value={
                    "success": True,
                    "data": {
                        "id": "conv-1",
                        "messages": [],
                        "status": "active",
                    },
                }
            ),
        ) as post:
            result = await registry.resource(
                action="get",
                resource_type="conversation_context",
                resource_id="conv-1",
            )

        post.assert_awaited_once_with(
            "/tools/resource",
            {
                "action": "get",
                "resource_type": "conversation_context",
                "resource_id": "conv-1",
            },
        )
        assert result == {
            "success": True,
            "action": "get",
            "resource_type": "conversation_context",
            "resource_id": "conv-1",
            "id": "conv-1",
            "messages": [],
            "status": "active",
        }

    @pytest.mark.asyncio
    async def test_memory_put_get_search_and_delete(self, registry: ToolRegistry) -> None:
        """Test runtime-local memory lifecycle."""

        saved = await registry.memory(
            action="put",
            namespace="follow_up",
            key="conv-1",
            value={"summary": "Hello"},
            metadata={"source": "test"},
        )
        loaded = await registry.memory(
            action="get",
            namespace="follow_up",
            key="conv-1",
        )
        searched = await registry.memory(
            action="search",
            namespace="follow_up",
            query="hello",
        )
        deleted = await registry.memory(
            action="delete",
            namespace="follow_up",
            key="conv-1",
        )

        assert saved == {
            "success": True,
            "action": "put",
            "namespace": "follow_up",
            "key": "conv-1",
            "value": {"summary": "Hello"},
            "metadata": {"source": "test"},
        }
        assert loaded["value"] == {"summary": "Hello"}
        assert searched["items"] == [
            {
                "key": "conv-1",
                "value": {"summary": "Hello"},
                "metadata": {"source": "test"},
            }
        ]
        assert deleted == {
            "success": True,
            "action": "delete",
            "namespace": "follow_up",
            "key": "conv-1",
        }

    @pytest.mark.asyncio
    async def test_inspect_memory_returns_grouped_snapshot(
        self,
        registry: ToolRegistry,
    ) -> None:
        """Test grouped runtime-local memory snapshots for the demo UI."""

        _MEMORY_STORE.clear()

        await registry.memory(
            action="put",
            namespace="follow_up",
            key="conv-1",
            value={"summary": "Asked for pricing"},
            metadata={"agentId": "agent-follow-up"},
        )
        await registry.memory(
            action="put",
            namespace="recovery",
            key="conv-2",
            value={"summary": "Waiting on billing confirmation"},
            metadata={"agentId": "agent-recovery"},
        )

        snapshot = registry.inspect_memory(limit=10)

        assert snapshot["total_namespaces"] == 2
        assert snapshot["total_entries"] == 2
        assert snapshot["namespaces"] == [
            {
                "namespace": "follow_up",
                "entry_count": 1,
                "returned_entries": 1,
                "truncated": False,
                "entries": [
                    {
                        "key": "conv-1",
                        "value": {"summary": "Asked for pricing"},
                        "metadata": {"agentId": "agent-follow-up"},
                    }
                ],
            },
            {
                "namespace": "recovery",
                "entry_count": 1,
                "returned_entries": 1,
                "truncated": False,
                "entries": [
                    {
                        "key": "conv-2",
                        "value": {"summary": "Waiting on billing confirmation"},
                        "metadata": {"agentId": "agent-recovery"},
                    }
                ],
            },
        ]

    @pytest.mark.asyncio
    async def test_communicate_requires_action_and_target_id(
        self,
        registry: ToolRegistry,
    ) -> None:
        """Test validation for communicate input."""

        result = await registry.communicate(action="", target_id="conv-1")

        assert result["success"] is False
        assert result["error"] == "action and target_id are required"

    @pytest.mark.asyncio
    async def test_resource_requires_action_and_resource_type(
        self,
        registry: ToolRegistry,
    ) -> None:
        """Test validation for resource input."""

        result = await registry.resource(action="", resource_type="")

        assert result["success"] is False
        assert result["error"] == "action and resource_type are required"

    def test_yoizen_aliases_backend_client(self, registry: ToolRegistry) -> None:
        """Test the legacy alias for the backend client."""

        assert registry.yoizen is registry.backend


class TestBackendClient:
    """Test suite for BackendClient HTTP methods."""

    @pytest.mark.asyncio
    async def test_get_request_builds_correct_url(self) -> None:
        """Test that GET request builds the correct URL."""

        from src.tools.yoizen import BackendClient

        client = BackendClient()
        client.base_url = "http://localhost:3000"

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"status": "ok"}
        mock_response.raise_for_status.return_value = None
        mock_client.get.return_value = mock_response

        with patch("src.tools.yoizen.get_http_client", return_value=mock_client):
            await client.get("/conversations")

        mock_client.get.assert_called_once()
        call_args = mock_client.get.call_args
        assert "http://localhost:3000/conversations" in str(call_args)

    @pytest.mark.asyncio
    async def test_post_request_sends_json_data(self) -> None:
        """Test that POST request sends JSON data correctly."""

        from src.tools.yoizen import BackendClient

        client = BackendClient()
        client.base_url = "http://localhost:3000"

        mock_client = AsyncMock()
        mock_response = MagicMock()
        mock_response.json.return_value = {"success": True}
        mock_response.raise_for_status.return_value = None
        mock_client.post.return_value = mock_response

        with patch("src.tools.yoizen.get_http_client", return_value=mock_client):
            await client.post("/messages", {"content": "Hello"})

        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args.kwargs["json"] == {"content": "Hello"}

    def test_yoizen_client_aliases_backend_client(self) -> None:
        """Test that YoizenClient remains a compatibility alias."""

        from src.tools.yoizen import BackendClient, YoizenClient

        assert YoizenClient is BackendClient

    def test_package_exports_backend_client(self) -> None:
        """Test that the package exports the neutral backend client."""

        from src.tools import BackendClient, YoizenClient

        assert BackendClient is YoizenClient


class TestGlobalRegistryFunctions:
    """Test suite for global registry functions."""

    def test_get_tools_returns_list(self) -> None:
        """Test that get_tools returns a list."""

        tools = get_tools()
        assert isinstance(tools, list)

    def test_register_tool_adds_to_global_registry(self) -> None:
        """Test that register_tool adds tools to global registry."""

        original_count = len(get_tools())
        tool = MagicMock()
        tool.name = "test_global_tool"
        register_tool(tool)

        assert len(get_tools()) == original_count + 1

    def test_register_tool_requires_name_attribute(self) -> None:
        """Test that register_tool raises error without name attribute."""

        tool = MagicMock(spec=[])

        with pytest.raises(ValueError, match="must have a 'name'"):
            register_tool(tool)
