"""Tests for SkillDefinition model."""

import pytest
from src.app.skills.skill_def import SkillDefinition


class TestSkillDefinition:
    """Test cases for SkillDefinition model."""

    def test_skill_definition_creation_minimal(self) -> None:
        """Test creating a minimal skill definition."""
        skill = SkillDefinition(
            id="test-skill", name="Test Skill", description="A test skill"
        )

        assert skill.id == "test-skill"
        assert skill.name == "Test Skill"
        assert skill.description == "A test skill"
        assert skill.enabled is True
        assert skill.instructions == ""
        assert skill.when_to_use == ""
        assert skill.triggers == []
        assert skill.arguments == []
        assert skill.allowed_tools == []
        assert skill.context_mode == "inline"
        assert skill.model_override is None
        assert skill.priority == 0
        assert skill.config == {}

    def test_skill_definition_full(self) -> None:
        """Test creating a full skill definition."""
        skill = SkillDefinition(
            id="sales-assistant",
            name="Sales Assistant",
            description="Helps with sales inquiries",
            enabled=True,
            instructions="Always be helpful and professional",
            when_to_use="Use when customer asks about pricing or products",
            triggers=["/sales", "/pricing"],
            arguments=["product", "quantity"],
            allowed_tools=["price_calculator", "product_search"],
            context_mode="fork",
            model_override="claude-3-haiku",
            priority=10,
            config={"custom_field": "custom_value"},
        )

        assert skill.id == "sales-assistant"
        assert skill.name == "Sales Assistant"
        assert skill.when_to_use == "Use when customer asks about pricing or products"
        assert skill.triggers == ["/sales", "/pricing"]
        assert skill.arguments == ["product", "quantity"]
        assert skill.context_mode == "fork"
        assert skill.model_override == "claude-3-haiku"
        assert skill.priority == 10

    def test_trigger_matching(self) -> None:
        """Test trigger matching functionality."""
        skill = SkillDefinition(
            id="test",
            name="Test Skill",
            description="Test",
            triggers=["/help", "/sales", "support"],
        )

        assert skill.has_trigger("/help") is True
        assert skill.has_trigger("/help now") is True
        assert skill.has_trigger(" /help") is True
        assert skill.has_trigger("/sales") is True
        assert skill.has_trigger("/pricing") is False
        assert skill.has_trigger("help") is False

    def test_get_trigger_used(self) -> None:
        """Test getting the trigger that was used."""
        skill = SkillDefinition(
            id="test",
            name="Test Skill",
            description="Test",
            triggers=["/help", "/sales"],
        )

        assert skill.get_trigger_used("/help") == "/help"
        assert skill.get_trigger_used("/help now") == "/help"
        assert skill.get_trigger_used("/sales") == "/sales"
        assert skill.get_trigger_used("/pricing") is None

    def test_priority_comparison(self) -> None:
        """Test priority comparison between skills."""
        skill1 = SkillDefinition(id="1", name="Skill1", description="Test", priority=5)
        skill2 = SkillDefinition(id="2", name="Skill2", description="Test", priority=10)
        skill3 = SkillDefinition(id="3", name="Skill3", description="Test", priority=1)

        assert skill2.is_higher_priority(skill1) is True
        assert skill1.is_higher_priority(skill3) is True
        assert skill1.is_higher_priority(skill2) is False
        assert skill3.is_higher_priority(skill1) is False

    def test_get_summary_for_llm(self) -> None:
        """Test getting LLM-friendly summary."""
        skill = SkillDefinition(
            id="test",
            name="Test Skill",
            description="A helpful test skill",
            when_to_use="Use when testing is needed",
            triggers=["/test"],
            arguments=["param1", "param2"],
        )

        summary = skill.get_summary_for_llm()

        assert "Use when: Use when testing is needed" in summary
        assert "Triggers: /test" in summary
        assert "Arguments: param1, param2" in summary
        assert "Description: A helpful test skill" in summary

    def test_get_summary_for_llm_minimal(self) -> None:
        """Test getting summary for minimal skill."""
        skill = SkillDefinition(
            id="test", name="Test Skill", description="A test skill"
        )

        summary = skill.get_summary_for_llm()

        assert "Description: A test skill" in summary

    def test_field_validation(self) -> None:
        """Test field validation and normalization."""
        skill = SkillDefinition(
            id="test-id",
            name="  Test Skill  ",
            description="  Test description  ",
            when_to_use="  Use when needed  ",
            triggers=["  /trigger1  ", "  /trigger2  "],
            arguments=["  arg1  ", "  arg2  "],
            allowed_tools=["  tool1  ", "  tool2  "],
        )

        assert skill.id == "test-id"
        assert skill.when_to_use == "Use when needed"
        assert skill.triggers == ["/trigger1", "/trigger2"]
        assert skill.arguments == ["arg1", "arg2"]
        assert skill.allowed_tools == ["tool1", "tool2"]

    def test_empty_field_filtering(self) -> None:
        """Test filtering of empty fields."""
        skill = SkillDefinition(
            id="test",
            name="Test",
            description="Test",
            triggers=["/valid", "", "  ", "/another"],
            arguments=["arg1", "", "  ", "arg2"],
            allowed_tools=["tool1", "", "  ", "tool2"],
        )

        assert skill.triggers == ["/valid", "/another"]
        assert skill.arguments == ["arg1", "arg2"]
        assert skill.allowed_tools == ["tool1", "tool2"]

    def test_context_mode_validation(self) -> None:
        """Test context_mode field validation."""
        # Valid modes
        skill1 = SkillDefinition(
            id="1", name="Test", description="Test", context_mode="inline"
        )
        skill2 = SkillDefinition(
            id="2", name="Test", description="Test", context_mode="fork"
        )

        assert skill1.context_mode == "inline"
        assert skill2.context_mode == "fork"

        # Invalid mode should raise validation error
        with pytest.raises(ValueError):
            SkillDefinition(
                id="3", name="Test", description="Test", context_mode="invalid"
            )

    def test_extra_fields_allowed(self) -> None:
        """Test that extra fields are allowed for backward compatibility."""
        skill_data = {
            "id": "test",
            "name": "Test",
            "description": "Test",
            "extra_field": "extra_value",
            "another_extra": {"nested": "value"},
        }

        skill = SkillDefinition(**skill_data)

        assert skill.id == "test"
        assert skill.extra_field == "extra_value"
        assert skill.another_extra == {"nested": "value"}
