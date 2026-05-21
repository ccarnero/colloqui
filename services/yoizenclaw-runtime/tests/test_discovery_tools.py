"""Tests for skill discovery tools (ActivateSkill, ListSkills)."""

import pytest
from unittest.mock import Mock

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
                instructions="You are a sales assistant. Help the customer with pricing.",
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
                instructions="You are tech support. Help resolve technical issues.",
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
                instructions="You are a general assistant.",
                when_to_use="Use for general inquiries",
                priority=1,
            ),
        ]
        return SkillRouter(skills)

    def test_create_activate_skill_tool(self) -> None:
        """Test creation of ActivateSkill tool."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        tool = discovery.create_activate_skill_tool()

        assert tool.name == "ActivateSkill"
        assert "Activate a skill" in tool.description
        assert tool.read_only is True

        schema = tool.input_schema
        assert schema["type"] == "object"
        assert "skill_name" in schema["properties"]
        assert "reasoning" in schema["properties"]
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

    def test_activate_skill_success(self) -> None:
        """Test successful skill activation returns full instructions."""
        router = self.create_test_router()
        activated_skills = []
        discovery = SkillDiscoveryTools(
            router, on_activate=lambda s: activated_skills.append(s)
        )

        tool = discovery.create_activate_skill_tool()
        result = tool.func(
            {
                "skill_name": "sales_assistant",
                "reasoning": "Customer is asking about pricing",
            },
            {},
        )

        assert result["success"] is True
        assert result["skill_name"] == "sales_assistant"
        assert result["skill_id"] == "sales"
        assert (
            result["instructions"]
            == "You are a sales assistant. Help the customer with pricing."
        )
        assert result["allowed_tools"] == ["price_calculator"]
        assert result["arguments"] == ["product", "quantity"]
        assert "guidance" in result

        # Callback was invoked
        assert len(activated_skills) == 1
        assert activated_skills[0].name == "sales_assistant"

    def test_activate_skill_missing_name(self) -> None:
        """Test skill activation with missing skill name."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = discovery.create_activate_skill_tool().func(
            {"reasoning": "Some reasoning"}, {}
        )

        assert result["success"] is False
        assert "skill_name is required" in result["error"]

    def test_activate_skill_not_found(self) -> None:
        """Test skill activation with non-existent skill."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = discovery.create_activate_skill_tool().func(
            {"skill_name": "nonexistent_skill", "reasoning": "Some reasoning"}, {}
        )

        assert result["success"] is False
        assert "not found" in result["error"]
        assert "available_skills" in result

    def test_activate_skill_no_callback(self) -> None:
        """Test skill activation works without callback."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)  # no on_activate

        result = discovery.create_activate_skill_tool().func(
            {"skill_name": "support_agent"}, {}
        )

        assert result["success"] is True
        assert result["skill_name"] == "support_agent"
        assert "resolve technical issues" in result["instructions"]

    def test_list_skills_all(self) -> None:
        """Test listing all available skills."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = discovery.create_list_skills_tool().func({}, {})

        assert result["success"] is True
        assert result["total_count"] == 3
        assert len(result["skills"]) == 3

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

    def test_list_skills_filter_by_trigger(self) -> None:
        """Test listing skills filtered by trigger."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = discovery.create_list_skills_tool().func(
            {"filter_by_trigger": "/sales"}, {}
        )

        assert result["success"] is True
        assert result["total_count"] == 1
        assert len(result["skills"]) == 1
        assert result["skills"][0]["name"] == "sales_assistant"
        assert result["filter_by_trigger"] == "/sales"

    def test_list_skills_include_disabled(self) -> None:
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

        result = discovery.create_list_skills_tool().func(
            {"include_disabled": True}, {}
        )

        assert result["success"] is True
        assert result["total_count"] == 4
        assert len(result["skills"]) == 4

        disabled_skill = next(
            s for s in result["skills"] if s["name"] == "disabled_skill"
        )
        assert disabled_skill["enabled"] is False

    def test_list_skills_optional_fields(self) -> None:
        """Test that optional fields are only included when they have values."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        result = discovery.create_list_skills_tool().func({}, {})

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
        assert "triggers" not in general_skill
        assert "arguments" not in general_skill
        assert "allowed_tools" not in general_skill

    def test_get_all_discovery_tools(self) -> None:
        """Test getting all discovery tools."""
        router = self.create_test_router()
        discovery = SkillDiscoveryTools(router)

        tools = discovery.get_all_discovery_tools()

        assert len(tools) == 2
        tool_names = [tool.name for tool in tools]
        assert "ActivateSkill" in tool_names
        assert "ListSkills" in tool_names

    def test_create_discovery_tools_convenience(self) -> None:
        """Test the convenience function for creating discovery tools."""
        router = self.create_test_router()

        tools = create_discovery_tools(router)

        assert len(tools) == 2
        assert all(hasattr(tool, "name") for tool in tools)

    def test_create_discovery_tools_with_callback(self) -> None:
        """Test convenience function passes callback through."""
        router = self.create_test_router()
        activated = []

        tools = create_discovery_tools(router, on_activate=lambda s: activated.append(s))

        activate_tool = next(t for t in tools if t.name == "ActivateSkill")
        activate_tool.func({"skill_name": "sales_assistant"}, {})

        assert len(activated) == 1

    def test_activate_skill_error_handling(self) -> None:
        """Test error handling in ActivateSkill tool."""
        router = Mock()
        router.enabled_skills = []
        router.validate_skill_selection.return_value = (None, ["Skill not found"])
        discovery = SkillDiscoveryTools(router)

        result = discovery.create_activate_skill_tool().func(
            {"skill_name": "test"}, {}
        )

        assert result["success"] is False
        assert "error" in result
