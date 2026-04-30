"""Tests for agent configuration migration from legacy to enhanced format."""

import pytest
from src.utils.config.agent_config import (
    AgentSyncRequest,
    EnhancedAgentSyncRequest,
    EnhancedAgentSkillPayload,
    AgentSkillPayload
)


class TestAgentConfigMigration:
    """Test migration between legacy and enhanced agent configurations."""

    def test_legacy_config_parsing(self) -> None:
        """Test parsing of legacy agent configuration."""
        legacy_config = {
            "name": "legacy-agent",
            "description": "Legacy agent description",
            "role": {
                "name": "Legacy Role",
                "description": "Legacy role description",
                "systemPrompt": "You are a helpful assistant",
                "temperature": 0.7,
                "maxTokens": 1000
            },
            "rules": ["Be helpful"],
            "responseStyle": "Friendly",
            "llm": {
                "provider": "openai",
                "model": "gpt-4"
            },
            "skills": [
                {
                    "id": "skill1",
                    "name": "skill1",
                    "description": "First skill",
                    "enabled": True,
                    "instructions": "Do something",
                    "allowedTools": ["tool1"]
                }
            ],
            "tools": []
        }
        
        # Parse as legacy config
        legacy_parsed = AgentSyncRequest(**legacy_config)
        
        assert legacy_parsed.name == "legacy-agent"
        assert len(legacy_parsed.skills) == 1
        assert isinstance(legacy_parsed.skills[0], AgentSkillPayload)

    def test_enhanced_config_parsing(self) -> None:
        """Test parsing of enhanced agent configuration."""
        enhanced_config = {
            "name": "enhanced-agent",
            "description": "Enhanced agent description",
            "role": {
                "name": "Enhanced Role",
                "systemPrompt": "You are an enhanced assistant",
                "temperature": 0.5,
                "maxTokens": 2000
            },
            "rules": ["Be helpful", "Be accurate"],
            "responseStyle": "Professional",
            "llm": {
                "provider": "anthropic",
                "model": "claude-3-opus"
            },
            "skills": [
                {
                    "id": "enhanced-skill",
                    "name": "enhanced_skill",
                    "description": "Enhanced skill",
                    "enabled": True,
                    "instructions": "Process $COMPONENT in $ENV",
                    "when_to_use": "Use when processing components",
                    "triggers": ["/process", "/component"],
                    "arguments": ["component", "env"],
                    "allowedTools": ["processor"],
                    "context_mode": "fork",
                    "model_override": "claude-3-haiku",
                    "priority": 10
                }
            ],
            "tools": [],
            "enableEnhancedSkills": True,
            "enableSkillRouting": True,
            "enableDiscoveryTools": True
        }
        
        # Parse as enhanced config
        enhanced_parsed = EnhancedAgentSyncRequest(**enhanced_config)
        
        assert enhanced_parsed.name == "enhanced-agent"
        assert enhanced_parsed.enable_enhanced_skills is True
        assert enhanced_parsed.enable_skill_routing is True
        assert enhanced_parsed.enable_discovery_tools is True
        
        assert len(enhanced_parsed.skills) == 1
        skill = enhanced_parsed.skills[0]
        assert isinstance(skill, EnhancedAgentSkillPayload)
        assert skill.when_to_use == "Use when processing components"
        assert skill.triggers == ["/process", "/component"]
        assert skill.arguments == ["component", "env"]
        assert skill.context_mode == "fork"
        assert skill.model_override == "claude-3-haiku"
        assert skill.priority == 10

    def test_legacy_to_enhanced_migration(self) -> None:
        """Test automatic migration of legacy skills to enhanced format."""
        legacy_config = {
            "name": "migrating-agent",
            "description": "Agent with legacy skills",
            "role": {
                "name": "Migration Role",
                "systemPrompt": "You are a migrating assistant"
            },
            "skills": [
                {
                    "id": "legacy-skill-1",
                    "name": "legacy_skill_1",
                    "description": "First legacy skill",
                    "enabled": True,
                    "instructions": "Legacy instruction 1",
                    "allowedTools": ["tool1", "tool2"]
                },
                {
                    "id": "legacy-skill-2",
                    "name": "legacy_skill_2", 
                    "description": "Second legacy skill",
                    "enabled": False,
                    "instructions": "Legacy instruction 2"
                }
            ],
            "tools": [],
            "enableEnhancedSkills": True
        }
        
        # Parse as enhanced config (should migrate legacy skills)
        enhanced_parsed = EnhancedAgentSyncRequest(**legacy_config)
        
        assert len(enhanced_parsed.skills) == 2
        
        # Check first skill migration
        skill1 = enhanced_parsed.skills[0]
        assert isinstance(skill1, EnhancedAgentSkillPayload)
        assert skill1.id == "legacy-skill-1"
        assert skill1.name == "legacy_skill_1"
        assert skill1.instructions == "Legacy instruction 1"
        # New fields should have defaults
        assert skill1.when_to_use == ""
        assert skill1.triggers == []
        assert skill1.arguments == []
        assert skill1.context_mode == "inline"
        assert skill1.priority == 0
        assert skill1.allowed_tools == ["tool1", "tool2"]
        
        # Check second skill migration
        skill2 = enhanced_parsed.skills[1]
        assert skill2.enabled is False  # Should preserve disabled state

    def test_mixed_legacy_and_enhanced_skills(self) -> None:
        """Test configuration with both legacy and enhanced skills."""
        mixed_config = {
            "name": "mixed-agent",
            "role": {
                "name": "Mixed Role",
                "systemPrompt": "You are a mixed agent"
            },
            "skills": [
                # Legacy skill
                {
                    "id": "legacy-skill",
                    "name": "legacy_skill",
                    "description": "Legacy skill",
                    "instructions": "Legacy instruction"
                },
                # Enhanced skill
                {
                    "id": "enhanced-skill",
                    "name": "enhanced_skill",
                    "description": "Enhanced skill",
                    "instructions": "Process $COMPONENT",
                    "when_to_use": "Use when processing",
                    "triggers": ["/process"],
                    "arguments": ["component"]
                }
            ],
            "tools": [],
            "enableEnhancedSkills": True
        }
        
        enhanced_parsed = EnhancedAgentSyncRequest(**mixed_config)
        
        assert len(enhanced_parsed.skills) == 2
        
        # Legacy skill should be migrated
        legacy_skill = enhanced_parsed.skills[0]
        assert legacy_skill.name == "legacy_skill"
        assert legacy_skill.when_to_use == ""  # Default
        assert legacy_skill.triggers == []  # Default
        
        # Enhanced skill should keep its properties
        enhanced_skill = enhanced_parsed.skills[1]
        assert enhanced_skill.name == "enhanced_skill"
        assert enhanced_skill.when_to_use == "Use when processing"
        assert enhanced_skill.triggers == ["/process"]
        assert enhanced_skill.arguments == ["component"]

    def test_field_normalization(self) -> None:
        """Test field normalization and alias handling."""
        config_with_aliases = {
            "name": "alias-test-agent",
            "role": {
                "name": "Alias Role",
                "systemPrompt": "Test agent"
            },
            "skills": [
                {
                    "id": "alias-skill",
                    "name": "alias_skill",
                    "description": "Skill with aliases",
                    "instructions": "Test instruction",
                    "allowedTools": ["tool1"],  # CamelCase alias
                    "modelOverride": "claude-3-haiku"  # CamelCase alias
                }
            ],
            "tools": [],
            "enableEnhancedSkills": True,
            "enableSkillRouting": False,  # CamelCase alias
            "enableDiscoveryTools": True
        }
        
        enhanced_parsed = EnhancedAgentSyncRequest(**config_with_aliases)
        
        skill = enhanced_parsed.skills[0]
        assert skill.allowed_tools == ["tool1"]  # Should be normalized
        assert skill.model_override == "claude-3-haiku"  # Should be normalized
        
        assert enhanced_parsed.enable_skill_routing is False  # Should be normalized
        assert enhanced_parsed.enable_discovery_tools is True

    def test_response_style_normalization(self) -> None:
        """Test response style field normalization."""
        config_with_legacy_styles = {
            "name": "style-test-agent",
            "role": {
                "name": "Style Role",
                "systemPrompt": "Test agent"
            },
            "soul": "Friendly and helpful",  # Legacy field
            "skills": [],
            "tools": []
        }
        
        enhanced_parsed = EnhancedAgentSyncRequest(**config_with_legacy_styles)
        assert enhanced_parsed.response_style == "Friendly and helpful"

    def test_llm_field_normalization(self) -> None:
        """Test LLM field normalization."""
        config_with_legacy_llm = {
            "name": "llm-test-agent",
            "role": {
                "name": "LLM Role",
                "systemPrompt": "Test agent"
            },
            "llm_provider": "openai",  # Legacy field
            "llm_model": "gpt-4",      # Legacy field
            "skills": [],
            "tools": []
        }
        
        enhanced_parsed = EnhancedAgentSyncRequest(**config_with_legacy_llm)
        
        # Should normalize to nested llm object
        assert enhanced_parsed.llm.provider == "openai"
        assert enhanced_parsed.llm.model == "gpt-4"

    def test_runtime_dict_conversion(self) -> None:
        """Test conversion to runtime dictionary format."""
        enhanced_config = {
            "name": "runtime-test-agent",
            "description": "Test runtime conversion",
            "role": {
                "name": "Runtime Role",
                "systemPrompt": "Test agent"
            },
            "skills": [
                {
                    "id": "runtime-skill",
                    "name": "runtime_skill",
                    "description": "Runtime skill",
                    "instructions": "Runtime instruction",
                    "when_to_use": "Use for testing",
                    "triggers": ["/test"],
                    "arguments": ["param1"]
                }
            ],
            "tools": [],
            "enableEnhancedSkills": True
        }
        
        enhanced_parsed = EnhancedAgentSyncRequest(**enhanced_config)
        runtime_dict = enhanced_parsed.to_runtime_dict()
        
        # Should contain all fields in runtime format
        assert runtime_dict["name"] == "runtime-test-agent"
        assert runtime_dict["enableEnhancedSkills"] is True
        assert len(runtime_dict["skills"]) == 1
        
        skill_dict = runtime_dict["skills"][0]
        assert skill_dict["when_to_use"] == "Use for testing"
        assert skill_dict["triggers"] == ["/test"]
        assert skill_dict["arguments"] == ["param1"]

    def test_feature_flags_default_values(self) -> None:
        """Test that feature flags have correct default values."""
        minimal_config = {
            "name": "minimal-agent",
            "role": {
                "name": "Minimal Role",
                "systemPrompt": "Minimal agent"
            },
            "skills": [],
            "tools": []
        }
        
        enhanced_parsed = EnhancedAgentSyncRequest(**minimal_config)
        
        # Feature flags should default to True
        assert enhanced_parsed.enable_enhanced_skills is True
        assert enhanced_parsed.enable_skill_routing is True
        assert enhanced_parsed.enable_discovery_tools is True

    def test_invalid_enhanced_config_handling(self) -> None:
        """Test handling of invalid enhanced configurations."""
        invalid_config = {
            "name": "invalid-agent",
            "role": {
                "name": "Invalid Role",
                "systemPrompt": "Invalid agent"
            },
            "skills": [
                {
                    "id": "invalid-skill",
                    "name": "invalid_skill",
                    # Missing required fields
                    "description": "Invalid skill"
                }
            ],
            "tools": []
        }
        
        # Should raise validation error
        with pytest.raises(Exception):
            EnhancedAgentSyncRequest(**invalid_config)

    def test_empty_skills_handling(self) -> None:
        """Test handling of empty skills list."""
        config_no_skills = {
            "name": "no-skills-agent",
            "role": {
                "name": "No Skills Role",
                "systemPrompt": "Agent without skills"
            },
            "skills": [],
            "tools": []
        }
        
        enhanced_parsed = EnhancedAgentSyncRequest(**config_no_skills)
        
        assert len(enhanced_parsed.skills) == 0
        assert enhanced_parsed.enable_enhanced_skills is True  # Should still default to True

    def test_config_edge_cases(self) -> None:
        """Test various edge cases in configuration."""
        edge_case_config = {
            "name": "edge-case-agent",
            "description": "",  # Empty description
            "role": {
                "name": "Edge Case Role",
                "systemPrompt": "Edge case agent",
                "temperature": 0.0,  # Edge temperature
                "maxTokens": 1      # Minimal tokens
            },
            "rules": [],  # Empty rules
            "responseStyle": "",  # Empty style
            "skills": [
                {
                    "id": "edge-skill",
                    "name": "edge_skill",
                    "description": "",
                    "enabled": True,
                    "instructions": "",  # Empty instructions
                    "when_to_use": "",   # Empty when_to_use
                    "triggers": [],      # Empty triggers
                    "arguments": [],     # Empty arguments
                    "allowedTools": [],  # Empty tools
                    "priority": -1       # Negative priority
                }
            ],
            "tools": [],
            "enableEnhancedSkills": False  # Disabled enhanced
        }
        
        enhanced_parsed = EnhancedAgentSyncRequest(**edge_case_config)
        
        assert enhanced_parsed.name == "edge-case-agent"
        assert enhanced_parsed.description == ""
        assert len(enhanced_parsed.rules) == 0
        assert enhanced_parsed.response_style == ""
        assert enhanced_parsed.enable_enhanced_skills is False
        
        skill = enhanced_parsed.skills[0]
        assert skill.description == ""
        assert skill.instructions == ""
        assert skill.when_to_use == ""
        assert len(skill.triggers) == 0
        assert len(skill.arguments) == 0
        assert len(skill.allowed_tools) == 0
        assert skill.priority == -1
