"""Tests for built-in tools migration to ToolDef format."""

import pytest
from unittest.mock import patch, Mock, AsyncMock

from src.app.tools.builtin_tools import (
    create_communicate_tool,
    create_resource_tool,
    create_memory_tool,
    register_builtin_tools,
)
from src.app.tools.registry import ToolRegistry


class TestBuiltinTools:
    """Test cases for built-in tools migration."""

    def test_create_communicate_tool(self) -> None:
        """Test creation of communicate tool."""
        tool = create_communicate_tool()

        assert tool.name == "communicate"
        assert "Send, reply, notify, or escalate" in tool.description
        assert tool.read_only is False
        assert tool.max_output_chars == 16_384

        # Check schema structure
        schema = tool.input_schema
        assert schema["type"] == "object"
        assert "action" in schema["properties"]
        assert "target_id" in schema["properties"]
        assert schema["properties"]["action"]["enum"] == [
            "send",
            "reply",
            "notify",
            "escalate",
        ]
        assert schema["required"] == ["action", "target_id"]

    def test_create_resource_tool(self) -> None:
        """Test creation of resource tool."""
        tool = create_resource_tool()

        assert tool.name == "resource"
        assert "Read or update external resources" in tool.description
        assert tool.read_only is False
        assert tool.max_output_chars == 32_768

        # Check schema structure
        schema = tool.input_schema
        assert schema["type"] == "object"
        assert "action" in schema["properties"]
        assert "resource_type" in schema["properties"]
        assert schema["properties"]["action"]["enum"] == [
            "read",
            "list",
            "create",
            "update",
            "delete",
        ]
        assert schema["required"] == ["action", "resource_type"]

    def test_create_memory_tool(self) -> None:
        """Test creation of memory tool."""
        tool = create_memory_tool()

        assert tool.name == "memory"
        assert "Store or retrieve scoped runtime memory" in tool.description
        assert tool.read_only is False
        assert tool.max_output_chars == 16_384

        # Check schema structure
        schema = tool.input_schema
        assert schema["type"] == "object"
        assert "action" in schema["properties"]
        assert "namespace" in schema["properties"]
        assert schema["properties"]["action"]["enum"] == [
            "put",
            "get",
            "search",
            "delete",
            "propose",
        ]
        assert schema["required"] == ["action"]

    @pytest.mark.asyncio
    @patch("src.app.tools.builtin_tools.ToolRegistry")
    async def test_communicate_tool_execution(self, mock_registry_class: Mock) -> None:
        """Test communicate tool execution calls registry method."""
        mock_registry = Mock()
        mock_registry.communicate = AsyncMock(return_value={"success": True})
        mock_registry_class.return_value = mock_registry

        tool = create_communicate_tool()

        result = await tool.execute(
            {
                "action": "send",
                "target_id": "user123",
                "message": "Hello World",
                "channel": "whatsapp",
                "priority": "high",
            },
            {},
        )

        mock_registry.communicate.assert_called_once_with(
            action="send",
            target_id="user123",
            message="Hello World",
            channel="whatsapp",
            priority="high",
            context="",
            metadata=None,
        )

    @pytest.mark.asyncio
    @patch("src.app.tools.builtin_tools.ToolRegistry")
    async def test_resource_tool_execution(self, mock_registry_class: Mock) -> None:
        """Test resource tool execution calls registry method."""
        mock_registry = Mock()
        mock_registry.resource = AsyncMock(return_value={"data": {"id": "123"}})
        mock_registry_class.return_value = mock_registry

        tool = create_resource_tool()

        result = await tool.execute(
            {"action": "read", "resource_type": "user", "resource_id": "123"}, {}
        )

        mock_registry.resource.assert_called_once_with(
            action="read",
            resource_type="user",
            resource_id="123",
            filters=None,
            patch=None,
        )

    @pytest.mark.asyncio
    @patch("src.app.tools.builtin_tools.ToolRegistry")
    async def test_memory_tool_execution(self, mock_registry_class: Mock) -> None:
        """Test memory tool execution calls registry method."""
        mock_registry = Mock()
        mock_registry.memory = AsyncMock(return_value={"success": True})
        mock_registry_class.return_value = mock_registry

        tool = create_memory_tool()

        result = await tool.execute(
            {
                "action": "put",
                "namespace": "test",
                "key": "test_key",
                "value": "test_value",
            },
            {},
        )

        mock_registry.memory.assert_called_once_with(
            action="put",
            namespace="test",
            key="test_key",
            value="test_value",
            query="",
            limit=10,
            metadata=None,
            scope=None,
            kind=None,
            subject_id=None,
            title=None,
            content=None,
            source_chat_id=None,
        )

    def test_register_builtin_tools(self) -> None:
        """Test registering all built-in tools."""
        mock_registry = Mock()
        mock_registry.register_tool_def = Mock()

        register_builtin_tools(mock_registry)

        # Should register 3 tools
        assert mock_registry.register_tool_def.call_count == 3

        # Check the tool names that were registered
        call_args = [
            call[0][0].name for call in mock_registry.register_tool_def.call_args_list
        ]
        assert "communicate" in call_args
        assert "resource" in call_args
        assert "memory" in call_args

    def test_tool_schemas_for_llm(self) -> None:
        """Test that built-in tools provide proper schemas for LLM."""
        tools = [
            create_communicate_tool(),
            create_resource_tool(),
            create_memory_tool(),
        ]

        for tool in tools:
            schema = tool.get_schema_for_llm()

            # Check required schema fields
            assert "name" in schema
            assert "description" in schema
            assert "input_schema" in schema

            # Check input schema structure
            input_schema = schema["input_schema"]
            assert input_schema["type"] == "object"
            assert "properties" in input_schema
            assert "required" in input_schema

    @pytest.mark.asyncio
    async def test_tool_error_handling(self) -> None:
        """Test that built-in tools handle execution errors properly."""

        def error_func(params: dict, config: dict) -> str:
            raise ValueError("Test error")

        tool = create_communicate_tool()
        tool.func = error_func

        result = await tool.execute({}, {})

        assert isinstance(result, dict)
        assert result["success"] is False
        assert "Test error" in result["error"]
        assert result["tool"] == "communicate"

    @pytest.mark.asyncio
    async def test_tool_output_truncation(self) -> None:
        """Test that built-in tools truncate large outputs."""

        def large_output_func(params: dict, config: dict) -> dict:
            return {"data": "x" * 10000, "metadata": "y" * 5000}

        tool = create_communicate_tool()
        tool.func = large_output_func
        tool.max_output_chars = 1000

        result = await tool.execute({}, {})

        assert isinstance(result, dict)
        assert result["_truncated"] is True
        assert "original_size_bytes" in result
