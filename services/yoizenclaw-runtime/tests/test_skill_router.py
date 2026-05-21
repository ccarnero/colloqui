"""Tests for SkillRouter intelligent selection logic."""

import pytest
from src.app.skills.skill_def import SkillDefinition
from src.app.skills.router import SkillRouter, SkillContext


class TestSkillRouter:
    """Test cases for SkillRouter."""

    def create_test_skills(self) -> list[SkillDefinition]:
        """Create a set of test skills for routing."""
        return [
            SkillDefinition(
                id="sales",
                name="sales_assistant",
                description="Helps with sales inquiries",
                when_to_use="Use when customer asks about pricing or products",
                triggers=["/sales", "/pricing"],
                priority=10,
            ),
            SkillDefinition(
                id="support",
                name="support_agent",
                description="Helps with technical support",
                when_to_use="Use when customer reports technical issues",
                triggers=["/support", "/help"],
                priority=5,
            ),
            SkillDefinition(
                id="general",
                name="general_assistant",
                description="General purpose assistant",
                when_to_use="Use for general inquiries",
                priority=1,
            ),
            SkillDefinition(
                id="disabled",
                name="disabled_skill",
                description="This skill is disabled",
                enabled=False,
                priority=100,
            ),
        ]

    def test_router_initialization(self) -> None:
        """Test router initialization with skills."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        assert len(router.enabled_skills) == 3  # Disabled skill excluded
        assert len(router._skill_by_name) == 3
        assert len(router._skills_by_priority) == 3

        # Check priority sorting
        priorities = [skill.priority for skill in router._skills_by_priority]
        assert priorities == [10, 5, 1]

    def test_resolve_by_trigger_exact_match(self) -> None:
        """Test resolving skill by exact trigger match."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        context = SkillContext(user_message="/sales")
        skill = router.resolve(context)

        assert skill is not None
        assert skill.name == "sales_assistant"
        assert skill.id == "sales"

    def test_resolve_by_trigger_with_args(self) -> None:
        """Test resolving skill by trigger with arguments."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        context = SkillContext(user_message="/pricing product=laptop")
        skill = router.resolve(context)

        assert skill is not None
        assert skill.name == "sales_assistant"

    def test_resolve_by_trigger_whitespace(self) -> None:
        """Test resolving skill by trigger with whitespace."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        context = SkillContext(user_message="  /help  ")
        skill = router.resolve(context)

        assert skill is not None
        assert skill.name == "support_agent"

    def test_resolve_by_explicit_name(self) -> None:
        """Test resolving skill by explicit name."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        context = SkillContext(
            user_message="some message", explicit_skill_name="support_agent"
        )
        skill = router.resolve(context)

        assert skill is not None
        assert skill.name == "support_agent"

    def test_resolve_by_explicit_name_not_found(self) -> None:
        """Test resolving skill by explicit name that doesn't exist."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        context = SkillContext(
            user_message="some message", explicit_skill_name="nonexistent_skill"
        )
        skill = router.resolve(context)

        # Should fall back to priority-based selection
        assert skill is not None
        assert skill.name == "sales_assistant"  # Highest priority
        assert "not found" in " ".join(context.warnings)

    def test_resolve_by_priority_fallback(self) -> None:
        """Test resolving skill by priority when no trigger or name matches."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        context = SkillContext(user_message="random message without trigger")
        skill = router.resolve(context)

        assert skill is not None
        assert skill.name == "sales_assistant"  # Highest priority
        assert "priority fallback" in " ".join(context.warnings)

    def test_resolve_multiple_triggers_same_priority(self) -> None:
        """Test resolving when multiple skills have same trigger priority."""
        skills = [
            SkillDefinition(
                id="skill1",
                name="skill1",
                description="First skill",
                triggers=["/common"],
                priority=5,
            ),
            SkillDefinition(
                id="skill2",
                name="skill2",
                description="Second skill",
                triggers=["/common"],
                priority=10,  # Higher priority
            ),
        ]
        router = SkillRouter(skills)

        context = SkillContext(user_message="/common")
        skill = router.resolve(context)

        assert skill is not None
        assert skill.name == "skill2"  # Higher priority wins
        assert "Multiple triggers matched" in " ".join(context.warnings)

    def test_resolve_no_enabled_skills(self) -> None:
        """Test resolving when no skills are enabled."""
        skills = [
            SkillDefinition(
                id="disabled",
                name="disabled_skill",
                description="Disabled",
                enabled=False,
            )
        ]
        router = SkillRouter(skills)

        context = SkillContext(user_message="/anything")
        skill = router.resolve(context)

        assert skill is None
        assert "No enabled skills" in " ".join(context.warnings)

    def test_get_skill_summaries_for_llm(self) -> None:
        """Test getting skill summaries for LLM."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        summaries = router.get_skill_summaries_for_llm()

        assert "**sales_assistant**" in summaries
        assert "**support_agent**" in summaries
        assert "**general_assistant**" in summaries
        assert "Use when customer asks about pricing" in summaries
        assert "Use when customer reports technical" in summaries
        assert "disabled_skill" not in summaries  # Disabled skills excluded

    def test_get_skill_summaries_no_skills(self) -> None:
        """Test getting summaries when no skills available."""
        router = SkillRouter([])

        summaries = router.get_skill_summaries_for_llm()

        assert summaries == "No skills available."

    def test_list_available_skills(self) -> None:
        """Test listing available skills with metadata."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        skill_list = router.list_available_skills()

        assert len(skill_list) == 3  # Disabled skill excluded

        # Check structure of returned skills
        for skill_info in skill_list:
            assert "id" in skill_info
            assert "name" in skill_info
            assert "description" in skill_info
            assert "when_to_use" in skill_info
            assert "triggers" in skill_info
            assert "arguments" in skill_info
            assert "priority" in skill_info

    def test_validate_skill_selection_valid(self) -> None:
        """Test validating a valid skill selection."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        skill, warnings = router.validate_skill_selection("sales_assistant")

        assert skill is not None
        assert skill.name == "sales_assistant"
        assert len(warnings) == 0

    def test_validate_skill_selection_invalid(self) -> None:
        """Test validating an invalid skill selection."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        skill, warnings = router.validate_skill_selection("nonexistent_skill")

        assert skill is None
        assert len(warnings) > 0
        assert "not found" in " ".join(warnings)
        assert "Available skills:" in " ".join(warnings)

    def test_trigger_overrides_name(self) -> None:
        """Test that trigger takes precedence over explicit name."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        context = SkillContext(
            user_message="/sales",  # Trigger for sales_assistant
            explicit_skill_name="support_agent",  # Different skill
        )
        skill = router.resolve(context)

        assert skill is not None
        assert skill.name == "sales_assistant"  # Trigger wins

    def test_context_warning_accumulation(self) -> None:
        """Test that warnings are accumulated in context."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        context = SkillContext(
            user_message="random message",
            explicit_skill_name="nonexistent",
            warnings=["initial warning"],
        )

        skill = router.resolve(context)

        assert len(context.warnings) >= 2
        assert "initial warning" in context.warnings
        assert "not found" in " ".join(context.warnings)
        assert "priority fallback" in " ".join(context.warnings)

    def test_resolve_by_semantics_matches_spanish_price_terms(self) -> None:
        """Semantic routing should map Spanish pricing terms to sales skill."""
        skills = self.create_test_skills()
        router = SkillRouter(skills)

        context = SkillContext(
            user_message="Necesito precio y presupuesto para el plan",
        )
        skill = router.resolve(context)

        assert skill is not None
        assert skill.name == "sales_assistant"
        assert "semantic match" in " ".join(context.warnings)
