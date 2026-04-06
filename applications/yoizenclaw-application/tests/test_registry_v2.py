"""Tests for the refactored ToolRegistry with ToolDef support."""

import pytest
from unittest.mock import Mock, patch

from src.app.tools.tool_def import ToolDef
from src.app.tools.registry import ToolRegistry


class TestToolRegistryV2:
    """Test cases for the refactored ToolRegistry."""

    def test_registry_initialization(self) -> None:
        """Test registry initializes with empty collections."""
        registry = ToolRegistry()
        assert len(registry._tools) == 0
        assert len(registry._legacy_tools) == 0

    def test_register_tool_def(self) -> None:
        """Test registering a ToolDef instance."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
        )

        registry = ToolRegistry()
        registry.register_tool_def(tool_def)

        assert "test_tool" in registry._tools
        assert registry._tools["test_tool"] is tool_def

    def test_register_tool_def_overwrite(self) -> None:
        """Test that registering ToolDef with same name overwrites."""

        def func1(params: dict, config: dict) -> str:
            return "func1"

        def func2(params: dict, config: dict) -> str:
            return "func2"

        tool_def1 = ToolDef(
            name="test_tool", description="First tool", input_schema={}, func=func1
        )

        tool_def2 = ToolDef(
            name="test_tool", description="Second tool", input_schema={}, func=func2
        )

        registry = ToolRegistry()
        registry.register_tool_def(tool_def1)
        registry.register_tool_def(tool_def2)

        assert len(registry._tools) == 1
        assert registry._tools["test_tool"].description == "Second tool"

    def test_register_tool_with_tooldef(self) -> None:
        """Test register_tool method accepts ToolDef instances."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
        )

        registry = ToolRegistry()
        registry.register_tool(tool_def)

        assert "test_tool" in registry._tools

    def test_register_legacy_tool(self) -> None:
        """Test registering legacy tool objects."""
        legacy_tool = Mock()
        legacy_tool.name = "legacy_tool"

        registry = ToolRegistry()
        registry.register_tool(legacy_tool)

        assert len(registry._legacy_tools) == 1
        assert registry._legacy_tools[0] is legacy_tool

    def test_register_legacy_tool_no_name(self) -> None:
        """Test legacy tool registration fails without name attribute."""
        legacy_tool = Mock()
        del legacy_tool.name  # Remove name attribute

        registry = ToolRegistry()
        with pytest.raises(ValueError, match="Tool must have a 'name' attribute"):
            registry.register_tool(legacy_tool)

    def test_get_tool_found(self) -> None:
        """Test getting a ToolDef by name."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
        )

        registry = ToolRegistry()
        registry.register_tool_def(tool_def)

        result = registry.get_tool("test_tool")
        assert result is tool_def

    def test_get_tool_not_found(self) -> None:
        """Test getting a non-existent tool returns None."""
        registry = ToolRegistry()
        result = registry.get_tool("nonexistent")
        assert result is None

    def test_get_all_schemas(self) -> None:
        """Test getting JSON schemas for all ToolDef tools."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        tool_def1 = ToolDef(
            name="tool1",
            description="First tool",
            input_schema={"type": "object"},
            func=dummy_func,
        )

        tool_def2 = ToolDef(
            name="tool2",
            description="Second tool",
            input_schema={"type": "object"},
            func=dummy_func,
        )

        registry = ToolRegistry()
        registry.register_tool_def(tool_def1)
        registry.register_tool_def(tool_def2)

        schemas = registry.get_all_schemas()
        assert len(schemas) == 2
        assert schemas[0]["name"] in ["tool1", "tool2"]
        assert schemas[1]["name"] in ["tool1", "tool2"]
        assert schemas[0]["name"] != schemas[1]["name"]

    @pytest.mark.asyncio
    async def test_execute_tool_def_success(self) -> None:
        """Test executing a ToolDef tool successfully."""

        def dummy_func(params: dict, config: dict) -> str:
            return f"Hello {params.get('name', 'World')}"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
        )

        registry = ToolRegistry()
        registry.register_tool_def(tool_def)

        result = await registry.execute_tool("test_tool", {"name": "Alice"}, {})
        assert result == "Hello Alice"

    def test_execute_tool_def_not_found(self) -> None:
        """Test executing a non-existent tool raises error."""
        registry = ToolRegistry()
        with pytest.raises(ValueError, match="Tool 'nonexistent' not found"):
            registry.execute_tool("nonexistent", {}, {})

    def test_execute_legacy_tool_success(self) -> None:
        """Test executing a legacy tool successfully."""
        legacy_tool = Mock()
        legacy_tool.name = "legacy_tool"
        legacy_tool.return_value = "legacy result"

        registry = ToolRegistry()
        registry.register_tool(legacy_tool)

        result = registry.execute_tool("legacy_tool", {"param": "value"}, {})
        legacy_tool.assert_called_once_with({"param": "value"}, {})
        assert result == "legacy result"

    def test_execute_legacy_tool_not_callable(self) -> None:
        """Test executing a legacy tool that's not callable."""

        # Create a legacy tool that's not callable
        class NotCallableTool:
            def __init__(self):
                self.name = "legacy_tool"

        legacy_tool = NotCallableTool()

        registry = ToolRegistry()
        registry.register_tool(legacy_tool)

        with pytest.raises(
            ValueError, match="Legacy tool 'legacy_tool' is not callable"
        ):
            registry.execute_tool("legacy_tool", {}, {})

    def test_get_tools_mixed_format(self) -> None:
        """Test get_tools returns mixed legacy and ToolDef tools."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        tool_def = ToolDef(
            name="tool_def",
            description="A ToolDef tool",
            input_schema={},
            func=dummy_func,
            read_only=True,
            max_output_chars=1000,
        )

        # Create a simple legacy tool object
        class LegacyTool:
            def __init__(self, name: str):
                self.name = name

        legacy_tool = LegacyTool("legacy_tool")

        registry = ToolRegistry()
        registry.register_tool_def(tool_def)
        registry.register_tool(legacy_tool)

        tools = registry.get_tools()
        assert len(tools) == 2

        # Check legacy tool is included (should be the actual object)
        legacy_found = any(
            hasattr(tool, "name") and tool.name == "legacy_tool" for tool in tools
        )
        assert legacy_found

        # Check ToolDef is converted to legacy format
        tool_def_found = any(
            isinstance(tool, dict)
            and tool.get("name") == "tool_def"
            and tool.get("read_only") is True
            and tool.get("max_output_chars") == 1000
            for tool in tools
        )
        assert tool_def_found

    def test_clear_all_tools(self) -> None:
        """Test clearing all tools from registry."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
        )

        legacy_tool = Mock()
        legacy_tool.name = "legacy_tool"

        registry = ToolRegistry()
        registry.register_tool_def(tool_def)
        registry.register_tool(legacy_tool)

        assert len(registry._tools) == 1
        assert len(registry._legacy_tools) == 1

        registry.clear()

        assert len(registry._tools) == 0
        assert len(registry._legacy_tools) == 0

    @patch("src.app.tools.registry.logger")
    def test_logging_on_registration(self, mock_logger: Mock) -> None:
        """Test that registration is logged."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
        )

        legacy_tool = Mock()
        legacy_tool.name = "legacy_tool"

        registry = ToolRegistry()
        registry.register_tool_def(tool_def)
        registry.register_tool(legacy_tool)

        # Check ToolDef registration was logged
        mock_logger.info.assert_any_call("Registered ToolDef: test_tool")
        # Check legacy tool registration was logged
        mock_logger.info.assert_any_call("Registered legacy tool: legacy_tool")

    @patch("src.app.tools.registry.logger")
    def test_logging_on_clear(self, mock_logger: Mock) -> None:
        """Test that clearing is logged."""
        registry = ToolRegistry()
        registry.clear()

        mock_logger.info.assert_called_once_with("Cleared all tools from registry")
