"""Tests for SkillExecutor with argument substitution and fork mode."""

import pytest
from unittest.mock import Mock, AsyncMock, patch

from src.app.skills.skill_def import SkillDefinition
from src.app.skills.executor import SkillExecutor


class TestSkillExecutor:
    """Test cases for SkillExecutor."""

    def create_test_skill(self, **overrides) -> SkillDefinition:
        """Create a test skill with default values."""
        defaults = {
            "id": "test-skill",
            "name": "test_skill",
            "description": "A test skill",
            "instructions": "Process $COMPONENT in $ENV environment",
            "arguments": ["component", "env"],
            "allowed_tools": ["test_tool"],
            "context_mode": "inline",
            "priority": 0,
        }
        defaults.update(overrides)
        return SkillDefinition(**defaults)

    def test_executor_initialization(self) -> None:
        """Test executor initialization."""
        executor = SkillExecutor()

        assert executor.default_llm_config == {}
        assert executor.default_tools == []
        assert executor.tool_registry is None

    def test_executor_initialization_with_config(self) -> None:
        """Test executor initialization with configuration."""
        llm_config = {"model": "test-model", "temperature": 0.5}
        tools = [{"name": "tool1"}, {"name": "tool2"}]
        tool_registry = Mock()

        executor = SkillExecutor(
            default_llm_config=llm_config,
            default_tools=tools,
            tool_registry=tool_registry,
        )

        assert executor.default_llm_config == llm_config
        assert executor.default_tools == tools
        assert executor.tool_registry is tool_registry

    @pytest.mark.asyncio
    async def test_execute_inline_mode(self) -> None:
        """Test execution in inline mode."""
        skill = self.create_test_skill()
        executor = SkillExecutor()

        result = await executor.execute(
            skill, "user message", {"context": "value"}, skill_args="frontend staging"
        )

        assert result["success"] is True
        assert result["execution_mode"] == "inline"
        assert "processed_instructions" in result

    @pytest.mark.asyncio
    async def test_execute_inline_mode_async(self) -> None:
        """Test async execution in inline mode."""
        skill = self.create_test_skill()
        executor = SkillExecutor()

        result = await executor.execute(
            skill, "user message", {"context": "value"}, skill_args="frontend staging"
        )

        assert result["success"] is True
        assert result["skill_name"] == "test_skill"
        assert result["execution_mode"] == "inline"
        assert "processed_instructions" in result
        assert (
            result["processed_instructions"]
            == "Process frontend in staging environment"
        )

    @pytest.mark.asyncio
    async def test_execute_fork_mode(self) -> None:
        """Test execution in fork mode."""
        skill = self.create_test_skill(
            context_mode="fork", model_override="claude-3-haiku"
        )
        executor = SkillExecutor(default_llm_config={"model": "default-model"})

        result = await executor.execute(
            skill, "user message", {"context": "value"}, skill_args="frontend staging"
        )

        assert result["success"] is True
        assert result["skill_name"] == "test_skill"
        assert result["execution_mode"] == "fork"
        assert "isolated_result" in result
        assert result["model_used"] == "claude-3-haiku"

    @pytest.mark.asyncio
    async def test_argument_substitution_inline(self) -> None:
        """Test argument substitution in inline mode."""
        skill = self.create_test_skill(
            instructions="Deploy $VERSION to $ENV. Component: $COMPONENT. Args: $ARGUMENTS",
            arguments=["component", "env", "version"],
        )
        executor = SkillExecutor()

        result = await executor.execute(
            skill,
            "deploy request",
            {},
            skill_args="webapp production 2.1.0",
            COMPONENT="database",  # Override positional
        )

        assert result["success"] is True
        # COMPONENT should override positional, VERSION from positional, ENV from positional
        assert "Deploy 2.1.0 to production" in result["processed_instructions"]
        assert "Component: database" in result["processed_instructions"]
        assert "Args: webapp production 2.1.0" in result["processed_instructions"]

    @pytest.mark.asyncio
    async def test_argument_substitution_with_key_value_args(self) -> None:
        """Test argument substitution with key=value format."""
        skill = self.create_test_skill(
            instructions="Deploy $COMPONENT to $ENV with version $VERSION",
            arguments=["component", "env", "version"],
        )
        executor = SkillExecutor()

        result = await executor.execute(
            skill,
            "deploy request",
            {},
            skill_args="component=backend env=staging version=1.5.0",
        )

        assert result["success"] is True
        assert (
            "Deploy backend to staging with version 1.5.0"
            in result["processed_instructions"]
        )

    @pytest.mark.asyncio
    async def test_fork_mode_error_handling(self) -> None:
        """Test error handling in fork mode."""
        skill = self.create_test_skill(context_mode="fork")

        # Mock the fork execution to raise an exception
        executor = SkillExecutor()
        with patch.object(
            executor, "_create_forked_agent", side_effect=Exception("Test error")
        ):
            result = await executor.execute(skill, "message", {})

            assert result["success"] is False
            assert result["execution_mode"] == "fork"
            assert "Test error" in result["error"]

    @pytest.mark.asyncio
    async def test_substitute_instructions(self) -> None:
        """Test instruction substitution."""
        skill = self.create_test_skill(
            instructions="Process $COMPONENT in $ENV. Args: $ARGUMENTS",
            arguments=["component", "env"],
        )
        executor = SkillExecutor()

        result = executor._substitute_instructions(
            skill,
            "frontend staging",
            COMPONENT="database",  # Override
        )

        # COMPONENT overrides positional, ENV from positional
        assert result == "Process database in staging. Args: frontend staging"

    def test_filter_tools_with_allowed_tools(self) -> None:
        """Test tool filtering based on allowed_tools."""
        skill = self.create_test_skill(allowed_tools=["tool1", "tool2"])

        # Mock tool registry
        tool_registry = Mock()
        tool_registry.get_tool.side_effect = lambda name: {
            "tool1": Mock(name="tool1"),
            "tool2": Mock(name="tool2"),
            "tool3": Mock(name="tool3"),
        }.get(name)

        executor = SkillExecutor(tool_registry=tool_registry)
        filtered = executor._filter_tools(skill.allowed_tools)

        assert len(filtered) == 2
        assert any(getattr(tool, "name", None) == "tool1" for tool in filtered)
        assert any(getattr(tool, "name", None) == "tool2" for tool in filtered)

    def test_filter_tools_no_allowed_tools(self) -> None:
        """Test tool filtering when no allowed_tools specified."""
        skill = self.create_test_skill(allowed_tools=[])
        default_tools = [{"name": "default1"}, {"name": "default2"}]

        executor = SkillExecutor(default_tools=default_tools)
        filtered = executor._filter_tools(skill.allowed_tools)

        assert filtered == default_tools

    def test_filter_tools_no_registry(self) -> None:
        """Test tool filtering when no registry available."""
        skill = self.create_test_skill(allowed_tools=["tool1"])
        default_tools = [{"name": "default1"}]

        executor = SkillExecutor(default_tools=default_tools, tool_registry=None)
        filtered = executor._filter_tools(skill.allowed_tools)

        assert filtered == default_tools

    @pytest.mark.asyncio
    async def test_validate_skill_execution_valid(self) -> None:
        """Test skill execution validation with valid skill."""
        skill = self.create_test_skill()
        executor = SkillExecutor()

        is_valid, warnings = executor.validate_skill_execution(
            skill, "frontend staging"
        )

        assert is_valid is True
        assert len(warnings) == 0

    @pytest.mark.asyncio
    async def test_validate_skill_execution_invalid_template(self) -> None:
        """Test skill execution validation with invalid template."""
        skill = self.create_test_skill(
            instructions="Process $UNDEFINED_VAR", arguments=["component", "env"]
        )
        executor = SkillExecutor()

        is_valid, warnings = executor.validate_skill_execution(
            skill, "frontend staging"
        )

        assert is_valid is False
        assert any("undefined argument: $UNDEFINED_VAR" in w for w in warnings)

    @pytest.mark.asyncio
    async def test_validate_skill_execution_missing_tools_fork(self) -> None:
        """Test skill execution validation with missing tools in fork mode."""
        skill = self.create_test_skill(
            context_mode="fork", allowed_tools=["missing_tool"]
        )

        # Mock tool registry that doesn't have the required tool
        tool_registry = Mock()
        tool_registry.get_tool.return_value = None

        executor = SkillExecutor(tool_registry=tool_registry)

        is_valid, warnings = executor.validate_skill_execution(skill)

        assert is_valid is False
        assert any("not available for fork mode" in w for w in warnings)

    @pytest.mark.asyncio
    async def test_create_forked_agent(self) -> None:
        """Test creation of forked agent."""
        skill = self.create_test_skill(
            context_mode="fork",
            model_override="claude-3-haiku",
            allowed_tools=["tool1"],
        )

        # Mock dependencies
        tool_registry = Mock()
        tool_registry.get_tool.return_value = Mock(name="tool1")

        executor = SkillExecutor(
            default_llm_config={"model": "default-model"}, tool_registry=tool_registry
        )

        forked_agent = executor._create_forked_agent(skill, "Test instructions")

        assert forked_agent is not None
        assert forked_agent.system_prompt == "Test instructions"
        # The agent should have the model override applied
        # (This would depend on the actual Agent implementation)

    @pytest.mark.asyncio
    async def test_execute_with_complex_arguments(self) -> None:
        """Test execution with complex argument scenarios."""
        skill = self.create_test_skill(
            instructions="""
            Task: Deploy $COMPONENT
            Environment: $ENV  
            Version: $VERSION
            Contact: $CONTACT
            All Args: $ARGUMENTS
            Priority: $PRIORITY
            """,
            arguments=["component", "env", "version", "contact", "priority"],
        )
        executor = SkillExecutor()

        result = await executor.execute(
            skill,
            "deploy request",
            {},
            skill_args="webapp production 2.1.0 admin@company.com high",
            CONTACT="devops@company.com",  # Override
        )

        instructions = result["processed_instructions"]
        assert "Task: webapp" in instructions
        assert "Environment: production" in instructions
        assert "Version: 2.1.0" in instructions
        assert "Contact: devops@company.com" in instructions  # Overridden
        assert (
            "All Args: webapp production 2.1.0 admin@company.com high" in instructions
        )
        assert "Priority: high" in instructions

    @pytest.mark.asyncio
    async def test_execute_metadata(self) -> None:
        """Test execution metadata is properly set."""
        skill = self.create_test_skill(arguments=["test"])
        executor = SkillExecutor()

        result = await executor.execute(skill, "message", {}, skill_args="value")

        metadata = result["metadata"]
        assert metadata["substitution_applied"] is True
        assert metadata["has_arguments"] is True
        assert metadata["raw_args"] == "value"

    @pytest.mark.asyncio
    async def test_execute_no_arguments(self) -> None:
        """Test execution with skills that have no arguments."""
        skill = self.create_test_skill(
            instructions="Simple instruction without arguments", arguments=[]
        )
        executor = SkillExecutor()

        result = await executor.execute(skill, "message", {}, skill_args="ignored")

        assert result["success"] is True
        assert (
            result["processed_instructions"] == "Simple instruction without arguments"
        )
        assert result["metadata"]["has_arguments"] is False
