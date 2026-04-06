"""End-to-end tests for the enhanced agent system.

Tests the complete flow from configuration to execution with
enhanced skills, routing, and argument substitution.
"""

import pytest
from unittest.mock import AsyncMock, Mock, patch

from src.utils.config.agent_config import EnhancedAgentSyncRequest, EnhancedAgentSkillPayload
from src.app.agents.enhanced_agent import EnhancedAgent
from src.app.skills.skill_def import SkillDefinition
from src.app.skills.router import SkillRouter, SkillContext
from src.app.skills.executor import SkillExecutor


class TestEnhancedAgentE2E:
    """End-to-end tests for enhanced agent functionality."""

    def create_enhanced_skill_payload(self, **overrides) -> dict:
        """Create an enhanced skill payload for testing."""
        defaults = {
            "id": "test-skill",
            "name": "test_skill",
            "description": "A test skill with arguments",
            "enabled": True,
            "instructions": "Process $COMPONENT in $ENV environment. Args: $ARGUMENTS",
            "when_to_use": "Use when processing components",
            "triggers": ["/test", "/process"],
            "arguments": ["component", "env"],
            "allowed_tools": ["test_tool"],
            "context_mode": "inline",
            "priority": 10
        }
        defaults.update(overrides)
        return defaults

    def create_enhanced_agent_config(self, skills: list[dict] | None = None) -> dict:
        """Create an enhanced agent configuration."""
        return {
            "name": "test-agent",
            "description": "Test enhanced agent",
            "role": {
                "name": "Test Role",
                "description": "Test role description",
                "systemPrompt": "You are a helpful test assistant",
                "temperature": 0.7,
                "maxTokens": 1000
            },
            "rules": ["Be helpful", "Be accurate"],
            "responseStyle": "Friendly and professional",
            "llm": {
                "provider": "openai",
                "model": "gpt-4",
                "credentialMode": "runtime-default"
            },
            "skills": skills or [self.create_enhanced_skill_payload()],
            "tools": [],
            "enableEnhancedSkills": True,
            "enableSkillRouting": True,
            "enableDiscoveryTools": True
        }

    @pytest.mark.asyncio
    async def test_enhanced_agent_creation_and_routing(self) -> None:
        """Test creating an enhanced agent and basic skill routing."""
        config = self.create_enhanced_agent_config()
        
        # Create enhanced agent
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=Mock()
        )
        
        # Verify skill definitions were created
        assert len(agent.skill_definitions) == 1
        skill = agent.skill_definitions[0]
        assert isinstance(skill, SkillDefinition)
        assert skill.name == "test_skill"
        assert skill.when_to_use == "Use when processing components"
        assert skill.triggers == ["/test", "/process"]
        assert skill.arguments == ["component", "env"]

    @pytest.mark.asyncio
    async def test_trigger_based_skill_selection(self) -> None:
        """Test skill selection via trigger commands."""
        config = self.create_enhanced_agent_config()
        
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=Mock()
        )
        
        # Test trigger selection
        context = SkillContext(
            user_message="/test frontend staging",
            available_skills=agent.skill_definitions
        )
        
        selected_skill = agent.skill_router.resolve(context)
        assert selected_skill is not None
        assert selected_skill.name == "test_skill"
        assert selected_skill.get_trigger_used("/test frontend staging") == "/test"

    @pytest.mark.asyncio
    async def test_argument_substitution_in_execution(self) -> None:
        """Test argument substitution during skill execution."""
        config = self.create_enhanced_agent_config()
        
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=Mock()
        )
        
        # Mock the LLM execution to focus on argument substitution
        with patch.object(agent, 'run') as mock_run:
            mock_run.return_value = "Mock response"
            
            # Execute with arguments
            result = await agent.run_with_enhanced_skill(
                user_message="/test frontend staging",
                skill_args="frontend staging",
                component="database",  # Override positional
                ENV="production"       # Override with kwargs
            )
            
            # Check that the call was made with substituted instructions
            mock_run.assert_called_once()
            call_args = mock_run.call_args
            
            # The system prompt should contain substituted instructions
            system_prompt = call_args[0][0]  # First positional argument
            assert "Process database in production environment" in system_prompt
            assert "Args: frontend staging" in system_prompt

    @pytest.mark.asyncio
    async def test_fork_mode_execution(self) -> None:
        """Test fork mode skill execution."""
        fork_skill = self.create_enhanced_skill_payload(
            context_mode="fork",
            model_override="claude-3-haiku"
        )
        config = self.create_enhanced_agent_config(skills=[fork_skill])
        
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=Mock()
        )
        
        # Mock fork execution
        with patch.object(agent.skill_executor, 'execute') as mock_execute:
            mock_execute.return_value = {
                "success": True,
                "execution_mode": "fork",
                "isolated_result": {"response": "Fork execution result"},
                "model_used": "claude-3-haiku"
            }
            
            result = await agent.run_with_enhanced_skill(
                user_message="/test component",
                skill_args="component"
            )
            
            assert result["execution_mode"] == "fork"
            assert result["skill_used"] == "test_skill"
            assert result["model_used"] == "claude-3-haiku"

    @pytest.mark.asyncio
    async def test_discovery_tools_integration(self) -> None:
        """Test that discovery tools are properly integrated."""
        config = self.create_enhanced_agent_config()
        
        # Mock tool registry
        tool_registry = Mock()
        tool_registry.register_tool_def = Mock()
        
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=tool_registry
        )
        
        # Verify discovery tools were registered
        assert tool_registry.register_tool_def.call_count >= 2  # SelectSkill and ListSkills

    @pytest.mark.asyncio
    async def test_legacy_skill_migration(self) -> None:
        """Test migration of legacy skills to enhanced format."""
        legacy_skill = {
            "id": "legacy-skill",
            "name": "legacy_skill",
            "description": "Legacy skill",
            "enabled": True,
            "instructions": "Legacy instruction",
            "allowedTools": ["tool1"]
        }
        
        config = self.create_enhanced_agent_config(skills=[legacy_skill])
        
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=Mock()
        )
        
        # Verify migration
        assert len(agent.skill_definitions) == 1
        skill = agent.skill_definitions[0]
        assert skill.name == "legacy_skill"
        assert skill.when_to_use == ""  # Default value
        assert skill.triggers == []  # Default value
        assert skill.arguments == []  # Default value
        assert skill.context_mode == "inline"  # Default value
        assert skill.priority == 0  # Default value

    @pytest.mark.asyncio
    async def test_priority_based_fallback(self) -> None:
        """Test priority-based fallback when no trigger matches."""
        skills = [
            self.create_enhanced_skill_payload(
                id="low-priority",
                name="low_priority",
                priority=1,
                triggers=["/low"]
            ),
            self.create_enhanced_skill_payload(
                id="high-priority", 
                name="high_priority",
                priority=10,
                triggers=["/high"]
            )
        ]
        config = self.create_enhanced_agent_config(skills=skills)
        
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=Mock()
        )
        
        # Test fallback with no trigger match
        context = SkillContext(
            user_message="random message without trigger",
            available_skills=agent.skill_definitions
        )
        
        selected_skill = agent.skill_router.resolve(context)
        assert selected_skill is not None
        assert selected_skill.name == "high_priority"  # Should pick highest priority

    @pytest.mark.asyncio
    async def test_enhanced_config_parsing(self) -> None:
        """Test parsing of enhanced agent configuration."""
        config_dict = self.create_enhanced_agent_config()
        
        # Parse as enhanced config
        enhanced_config = EnhancedAgentSyncRequest(**config_dict)
        
        assert enhanced_config.enable_enhanced_skills is True
        assert enhanced_config.enable_skill_routing is True
        assert enhanced_config.enable_discovery_tools is True
        assert len(enhanced_config.skills) == 1
        
        skill = enhanced_config.skills[0]
        assert isinstance(skill, EnhancedAgentSkillPayload)
        assert skill.when_to_use == "Use when processing components"
        assert skill.triggers == ["/test", "/process"]
        assert skill.arguments == ["component", "env"]

    @pytest.mark.asyncio
    async def test_system_prompt_injection(self) -> None:
        """Test that when_to_use is injected into system prompt."""
        config = self.create_enhanced_agent_config()
        
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=Mock()
        )
        
        # Get the available skills summary
        summary = agent.skill_router.get_skill_summaries_for_llm()
        
        assert "Use when: Use when processing components" in summary
        assert "Triggers: /test, /process" in summary
        assert "Arguments: component, env" in summary

    @pytest.mark.asyncio
    async def test_complex_argument_substitution(self) -> None:
        """Test complex argument substitution scenarios."""
        complex_skill = self.create_enhanced_skill_payload(
            instructions="""
            Task: Deploy $COMPONENT
            Environment: $ENV
            Version: $VERSION
            Contact: $CONTACT
            All Args: $ARGUMENTS
            Priority: $PRIORITY
            """,
            arguments=["component", "env", "version", "contact", "priority"]
        )
        config = self.create_enhanced_agent_config(skills=[complex_skill])
        
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=Mock()
        )
        
        with patch.object(agent, 'run') as mock_run:
            mock_run.return_value = "Mock response"
            
            await agent.run_with_enhanced_skill(
                user_message="/test",
                skill_args="webapp production 2.1.0 admin@company.com high",
                CONTACT="devops@company.com"  # Override
            )
            
            # Check substitution
            call_args = mock_run.call_args
            system_prompt = call_args[0][0]
            
            assert "Task: Deploy webapp" in system_prompt
            assert "Environment: production" in system_prompt
            assert "Version: 2.1.0" in system_prompt
            assert "Contact: devops@company.com" in system_prompt  # Overridden
            assert "Priority: high" in system_prompt
            assert "All Args: webapp production 2.1.0 admin@company.com high" in system_prompt

    @pytest.mark.asyncio
    async def test_error_handling_and_fallback(self) -> None:
        """Test error handling and graceful fallback."""
        config = self.create_enhanced_agent_config()
        
        agent = EnhancedAgent(
            system_prompt=config["role"]["systemPrompt"],
            llm_config=config["llm"],
            tools=config["tools"],
            skills=config["skills"],
            tool_registry=Mock()
        )
        
        # Mock execution failure
        with patch.object(agent.skill_executor, 'execute') as mock_execute:
            mock_execute.return_value = {
                "success": False,
                "error": "Execution failed",
                "execution_mode": "inline"
            }
            
            result = await agent.run_with_enhanced_skill(
                user_message="/test",
                skill_args="test"
            )
            
            assert result["execution_mode"] == "inline"
            assert "error" in result

    @pytest.mark.asyncio
    async def test_backward_compatibility(self) -> None:
        """Test backward compatibility with legacy configurations."""
        # Create config without enhanced features
        legacy_config = {
            "name": "legacy-agent",
            "description": "Legacy agent",
            "role": {
                "name": "Legacy Role",
                "systemPrompt": "You are a legacy assistant",
                "temperature": 0.7,
                "maxTokens": 1000
            },
            "skills": [self.create_enhanced_skill_payload()],
            "tools": [],
            "enableEnhancedSkills": False  # Disable enhanced features
        }
        
        # Should still work but fall back to legacy behavior
        agent = EnhancedAgent(
            system_prompt=legacy_config["role"]["systemPrompt"],
            llm_config={},
            tools=[],
            skills=legacy_config["skills"],
            tool_registry=Mock()
        )
        
        # Should have skill definitions but enhanced features disabled
        assert len(agent.skill_definitions) == 1
        assert hasattr(agent, 'skill_router')
        assert hasattr(agent, 'skill_executor')
