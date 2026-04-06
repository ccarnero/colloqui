"""Tests for skill discovery tools (SelectSkill, ListSkills)."""

import pytest
from unittest.mock import Mock, patch

from src.app.skills.skill_def import SkillDefinition
from src.app.skills.router import SkillRouter
from src.app.skills.discovery_tools import SkillDiscoveryTools, create_discovery_tools


class TestSkillDiscoveryTools:
    """Test cases for skill discovery tools."""

    def create_test_router(self) -> SkillRouter:
        """Create a test router with sample skills."""
        skills = [
            SkillDefinition(
                id="sales",
                name="sales_assistant",
                description="Helps with sales inquiries",
                when_to_use="Use when customer asks about pricing or products",
                triggers=["/sales", "/pricing"],
                arguments=["product", "quantity"],
                allowed_tools=["price_calculator"],
                priority=10,
            ),
            SkillDefinition(
                id="support",
                name="support_agent",
                description="Technical support assistance",
                when_to_use="Use when customer reports technical issues",
                triggers=["/support"],
                arguments=["issue_type"],
                allowed_tools=["ticket_system"],
                priority=5,
            ),
            SkillDefinition(
                id="general",
                name="general_assistant",
                description="General purpose assistance",
                when_to_use="Use for general inquiries",
                priority=1,
            ),
        ]
        return SkillRouter(skills)

    def test_create_select_skill_tool(self) -> None:
        """Test creation of SelectSkill tool."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        tool = discovery.create_select_skill_tool()

        assert tool.name == "SelectSkill"
        assert "Select and activate a skill" in tool.description
        assert tool.read_only is True

        schema = tool.input_schema
        assert schema["type"] == "object"
        assert "skill_name" in schema["properties"]
        assert "reasoning" in schema["properties"]
        assert "user_intent" in schema["properties"]
        assert schema["required"] == ["skill_name"]

    def test_create_list_skills_tool(self) -> None:
        """Test creation of ListSkills tool."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        tool = discovery.create_list_skills_tool()

        assert tool.name == "ListSkills"
        assert "List all available skills" in tool.description
        assert tool.read_only is True

        schema = tool.input_schema
        assert schema["type"] == "object"
        assert "filter_by_trigger" in schema["properties"]
        assert "include_disabled" in schema["properties"]

    @pytest.mark.asyncio
    async def test_select_skill_success(self) -> None:
        """Test successful skill selection."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = await discovery.create_select_skill_tool().execute(
            {
                "skill_name": "sales_assistant",
                "reasoning": "Customer is asking about pricing",
                "user_intent": "Customer wants to know product prices",
            },
            {},
        )

        assert result["success"] is True
        assert result["skill_name"] == "sales_assistant"
        assert result["skill_id"] == "sales"
        assert result["description"] == "Helps with sales inquiries"
        assert (
            result["when_to_use"] == "Use when customer asks about pricing or products"
        )
        assert result["triggers"] == ["/sales", "/pricing"]
        assert result["arguments"] == ["product", "quantity"]
        assert result["allowed_tools"] == ["price_calculator"]
        assert result["llm_reasoning"] == "Customer is asking about pricing"

    @pytest.mark.asyncio
    async def test_select_skill_missing_name(self) -> None:
        """Test skill selection with missing skill name."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = await discovery.create_select_skill_tool().execute(
            {"reasoning": "Some reasoning"}, {}
        )

        assert result["success"] is False
        assert "skill_name is required" in result["error"]

    @pytest.mark.asyncio
    async def test_select_skill_not_found(self) -> None:
        """Test skill selection with non-existent skill."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = await discovery.create_select_skill_tool().execute(
            {"skill_name": "nonexistent_skill", "reasoning": "Some reasoning"}, {}
        )

        assert result["success"] is False
        assert "not found" in result["error"]

    @pytest.mark.asyncio
    async def test_select_skill_validation_failure(self) -> None:
        """Test skill selection when validation would fail."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        with patch.object(router, "resolve", return_value=None):
            result = await discovery.create_select_skill_tool().execute(
                {"skill_name": "sales_assistant", "reasoning": "Some reasoning"}, {}
            )

        assert result["success"] is False
        assert "validation failed" in result["error"]

    @pytest.mark.asyncio
    async def test_list_skills_all(self) -> None:
        """Test listing all available skills."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = await discovery.create_list_skills_tool().execute({}, {})

        assert result["success"] is True
        assert result["total_count"] == 3
        assert len(result["skills"]) == 3

        # Check skill structure
        skill_names = [skill["name"] for skill in result["skills"]]
        assert "sales_assistant" in skill_names
        assert "support_agent" in skill_names
        assert "general_assistant" in skill_names

        # Check priority sorting (highest first)
        priorities = [skill["priority"] for skill in result["skills"]]
        assert priorities == [10, 5, 1]

        # Check routing summary is included
        assert "routing_summary" in result
        assert "**sales_assistant**" in result["routing_summary"]

    @pytest.mark.asyncio
    async def test_list_skills_filter_by_trigger(self) -> None:
        """Test listing skills filtered by trigger."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = await discovery.create_list_skills_tool().execute(
            {"filter_by_trigger": "/sales"}, {}
        )

        assert result["success"] is True
        assert result["total_count"] == 1
        assert len(result["skills"]) == 1
        assert result["skills"][0]["name"] == "sales_assistant"
        assert result["filter_by_trigger"] == "/sales"

    @pytest.mark.asyncio
    async def test_list_skills_include_disabled(self) -> None:
        """Test listing skills including disabled ones."""
        skills = self.create_test_router().skills + [
            SkillDefinition(
                id="disabled",
                name="disabled_skill",
                description="Disabled skill",
                enabled=False,
                priority=100,
            )
        ]
        router = SkillRouter(skills)
        discovery = SkillDiscoveryTools(router)

        result = await discovery.create_list_skills_tool().execute(
            {"include_disabled": True}, {}
        )

        assert result["success"] is True
        assert result["total_count"] == 4
        assert len(result["skills"]) == 4

        disabled_skill = next(
            s for s in result["skills"] if s["name"] == "disabled_skill"
        )
        assert disabled_skill["enabled"] is False

    @pytest.mark.asyncio
    async def test_list_skills_optional_fields(self) -> None:
        """Test that optional fields are only included when they have values."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = await discovery.create_list_skills_tool().execute({}, {})

        # Sales skill has all optional fields
        sales_skill = next(
            s for s in result["skills"] if s["name"] == "sales_assistant"
        )
        assert "when_to_use" in sales_skill
        assert "triggers" in sales_skill
        assert "arguments" in sales_skill
        assert "allowed_tools" in sales_skill

        # General skill has minimal fields
        general_skill = next(
            s for s in result["skills"] if s["name"] == "general_assistant"
        )
        assert "when_to_use" in general_skill
        assert "triggers" not in general_skill  # Empty list omitted
        assert "arguments" not in general_skill  # Empty list omitted
        assert "allowed_tools" not in general_skill  # Empty list omitted

    def test_get_all_discovery_tools(self) -> None:
        """Test getting all discovery tools."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        tools = discovery.get_all_discovery_tools()

        assert len(tools) == 2
        tool_names = [tool.name for tool in tools]
        assert "SelectSkill" in tool_names
        assert "ListSkills" in tool_names

    def test_create_discovery_tools_convenience(self) -> None:
        """Test the convenience function for creating discovery tools."""
        router = self.create_test_router()

        tools = create_discovery_tools(router)

        assert len(tools) == 2
        assert all(hasattr(tool, "name") for tool in tools)
        assert all(hasattr(tool, "execute") for tool in tools)

    @pytest.mark.asyncio
    async def test_select_skill_with_context_mode(self) -> None:
        """Test skill selection includes context mode when not inline."""
        skills = [
            SkillDefinition(
                id="fork_skill",
                name="fork_assistant",
                description="Fork mode skill",
                context_mode="fork",
                model_override="claude-3-haiku",
            )
        ]
        router = SkillRouter(skills)
        discovery = SkillDiscoveryTools(router)

        result = await discovery.create_select_skill_tool().execute(
            {"skill_name": "fork_assistant", "reasoning": "Need isolated execution"}, {}
        )

        assert result["success"] is True
        assert result["context_mode"] == "fork"
        assert result["model_override"] == "claude-3-haiku"

    @pytest.mark.asyncio
    async def test_tool_error_handling(self) -> None:
        """Test error handling in discovery tools."""
        router = Mock()
        router.enabled_skills = []
        router.validate_skill_selection.return_value = (None, ["Skill not found"])
        discovery = SkillDiscoveryTools(router)

        result = await discovery.create_select_skill_tool().execute(
            {"skill_name": "test"}, {}
        )

        assert result["success"] is False
        assert "error" in result
