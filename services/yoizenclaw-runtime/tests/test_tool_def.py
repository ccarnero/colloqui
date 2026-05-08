"""Tests for ToolDef dataclass functionality."""

import pytest
from src.app.tools.tool_def import ToolDef


class TestToolDef:
    """Test cases for ToolDef creation and functionality."""

    def test_tool_def_creation_valid(self) -> None:
        """Test creating a valid ToolDef."""

        def dummy_func(params: dict, config: dict) -> str:
            return f"Hello {params.get('name', 'World')}"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": [],
            },
            func=dummy_func,
            read_only=True,
            max_output_chars=1000,
        )

        assert tool_def.name == "test_tool"
        assert tool_def.description == "A test tool"
        assert tool_def.read_only is True
        assert tool_def.max_output_chars == 1000

    def test_tool_def_invalid_name(self) -> None:
        """Test ToolDef validation fails with invalid name."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        with pytest.raises(ValueError, match="Tool name must be a non-empty string"):
            ToolDef(
                name="", description="A test tool", input_schema={}, func=dummy_func
            )

    def test_tool_def_invalid_description(self) -> None:
        """Test ToolDef validation fails with invalid description."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        with pytest.raises(
            ValueError, match="Tool description must be a non-empty string"
        ):
            ToolDef(name="test_tool", description="", input_schema={}, func=dummy_func)

    def test_tool_def_invalid_schema(self) -> None:
        """Test ToolDef validation fails with invalid schema."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        with pytest.raises(ValueError, match="input_schema must be a dictionary"):
            ToolDef(
                name="test_tool",
                description="A test tool",
                input_schema="not a dict",
                func=dummy_func,
            )

    def test_tool_def_invalid_func(self) -> None:
        """Test ToolDef validation fails with invalid function."""
        with pytest.raises(ValueError, match="func must be callable"):
            ToolDef(
                name="test_tool",
                description="A test tool",
                input_schema={},
                func="not a function",
            )

    def test_tool_def_invalid_max_output(self) -> None:
        """Test ToolDef validation fails with invalid max_output_chars."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        with pytest.raises(ValueError, match="max_output_chars must be positive"):
            ToolDef(
                name="test_tool",
                description="A test tool",
                input_schema={},
                func=dummy_func,
                max_output_chars=0,
            )

    def test_get_schema_for_llm(self) -> None:
        """Test getting JSON schema for LLM."""

        def dummy_func(params: dict, config: dict) -> str:
            return "test"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={
                "type": "object",
                "properties": {"name": {"type": "string"}},
                "required": [],
            },
            func=dummy_func,
        )

        schema = tool_def.get_schema_for_llm()

        assert schema["name"] == "test_tool"
        assert schema["description"] == "A test tool"
        assert schema["input_schema"]["type"] == "object"
        assert "properties" in schema["input_schema"]

    def test_truncate_output_under_limit(self) -> None:
        """Test output truncation when under limit."""

        def dummy_func(params: dict, config: dict) -> str:
            return "Short output"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
            max_output_chars=1000,
        )

        result = tool_def.truncate_output("Short output")
        assert result == "Short output"

    def test_truncate_output_over_limit_string(self) -> None:
        """Test output truncation for strings over limit."""

        def dummy_func(params: dict, config: dict) -> str:
            return "x" * 100  # Will exceed limit of 50

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
            max_output_chars=50,
        )

        long_output = "x" * 100
        result = tool_def.truncate_output(long_output)

        assert isinstance(result, str)
        assert "[... 52 characters truncated ...]" in result
        assert len(result) < len(long_output)

    def test_truncate_output_over_limit_dict(self) -> None:
        """Test output truncation for dictionaries over limit."""

        def dummy_func(params: dict, config: dict) -> dict:
            return {"data": "x" * 100, "metadata": "y" * 50}

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
            max_output_chars=50,
        )

        large_dict = {"data": "x" * 100, "metadata": "y" * 50}
        result = tool_def.truncate_output(large_dict)

        assert isinstance(result, dict)
        assert result["_truncated"] is True
        assert "original_size_bytes" in result
        assert "truncated_content" in result
        assert "message" in result

    @pytest.mark.asyncio
    async def test_execute_success(self) -> None:
        """Test successful tool execution."""

        def dummy_func(params: dict, config: dict) -> str:
            return f"Hello {params.get('name', 'World')}"

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
        )

        result = await tool_def.execute({"name": "Alice"}, {})
        assert result == "Hello Alice"

    @pytest.mark.asyncio
    async def test_execute_with_truncation(self) -> None:
        """Test tool execution with output truncation."""

        def dummy_func(params: dict, config: dict) -> str:
            return "x" * 100

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=dummy_func,
            max_output_chars=50,
        )

        result = await tool_def.execute({}, {})
        assert "[... 52 characters truncated ...]" in str(result)

    @pytest.mark.asyncio
    async def test_execute_error_handling(self) -> None:
        """Test error handling during tool execution."""

        def error_func(params: dict, config: dict) -> str:
            raise ValueError("Test error")

        tool_def = ToolDef(
            name="test_tool",
            description="A test tool",
            input_schema={},
            func=error_func,
        )

        result = await tool_def.execute({}, {})
        assert isinstance(result, dict)
        assert result["success"] is False
        assert "Test error" in result["error"]
        assert result["tool"] == "test_tool"
