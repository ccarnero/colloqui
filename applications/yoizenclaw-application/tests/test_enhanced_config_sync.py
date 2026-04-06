"""Tests for enhanced config sync functionality."""

import pytest
from unittest.mock import AsyncMock, patch

from src.messaging.handlers.config import handle_config_sync, _handle_enhanced_agent_sync, _migrate_legacy_skill
from src.utils.config.agent_config import EnhancedAgentSyncRequest, AgentSyncRequest


class TestEnhancedConfigSync:
    """Test enhanced configuration sync via NATS."""

    @pytest.mark.asyncio
    async def test_handle_enhanced_agent_config_sync(self) -> None:
        """Test handling of enhanced agent configuration."""
        # Mock message
        mock_message = AsyncMock()
        
        # Enhanced agent config
        enhanced_config = {
            "name": "Enhanced Test Agent",
            "description": "Test enhanced agent",
            "role": {
                "name": "Enhanced Test Agent",
                "systemPrompt": "You are an enhanced test assistant",
                "temperature": 0.7,
                "maxTokens": 500
            },
            "skills": [
                {
                    "id": "test-skill",
                    "name": "test_skill",
                    "description": "Test skill",
                    "instructions": "Process $COMPONENT in $ENV",
                    "when_to_use": "Use when processing",
                    "triggers": ["/test"],
                    "arguments": ["component", "env"],
                    "context_mode": "inline",
                    "priority": 10
                }
            ],
            "enableEnhancedSkills": True,
            "enableSkillRouting": True,
            "enableDiscoveryTools": True
        }
        
        data = {"agent_config": enhanced_config}
        
        with patch('src.messaging.handlers.config._handle_enhanced_agent_sync') as mock_handler:
            await handle_config_sync(mock_message, data, {})
            
            mock_handler.assert_called_once_with(enhanced_config)

    @pytest.mark.asyncio
    async def test_handle_legacy_file_sync(self) -> None:
        """Test that legacy file sync still works."""
        mock_message = AsyncMock()
        
        # Legacy file format
        files = [
            {
                "path": "agents/runtime/test-agent.yaml",
                "content": "name: Test Agent\nrole:\n  systemPrompt: Test"
            }
        ]
        
        with patch('src.messaging.handlers.config._apply_config_sync') as mock_apply:
            await handle_config_sync(mock_message, files, {})
            
            mock_apply.assert_called_once_with(files, None)

    @pytest.mark.asyncio
    async def test_handle_mixed_format_sync(self) -> None:
        """Test handling of mixed format with files and delete paths."""
        mock_message = AsyncMock()
        
        # Mixed format
        data = {
            "files": [
                {
                    "path": "agents/runtime/test-agent.yaml",
                    "content": "name: Test Agent"
                }
            ],
            "delete_paths": ["agents/runtime/old-agent.yaml"]
        }
        
        with patch('src.messaging.handlers.config._apply_config_sync') as mock_apply:
            await handle_config_sync(mock_message, data, {})
            
            mock_apply.assert_called_once_with(data["files"], data["delete_paths"])

    @pytest.mark.asyncio
    async def test_enhanced_agent_sync_validation(self) -> None:
        """Test enhanced agent config validation."""
        enhanced_config = {
            "name": "Test Agent",
            "role": {"systemPrompt": "Test prompt"},
            "skills": [
                {
                    "id": "skill1",
                    "name": "skill1",
                    "instructions": "Do something with $ARGUMENTS",
                    "triggers": ["/do"],
                    "arguments": ["arg1"],
                    "when_to_use": "Use when needed"
                }
            ],
            "enableEnhancedSkills": True
        }
        
        with patch('src.utils.utils.runtime_config.RuntimeConfigRepository') as mock_repo, \
             patch('src.app.agents.agent_manager.get_agent_manager') as mock_manager:
            
            # Mock repository
            mock_repo_instance = AsyncMock()
            mock_repo_instance.save_agent_config.return_value = {"name": "Test Agent"}
            mock_repo.return_value = mock_repo_instance
            
            # Mock agent manager
            mock_manager_instance = AsyncMock()
            mock_manager.return_value = mock_manager_instance
            
            await _handle_enhanced_agent_sync(enhanced_config)
            
            # Verify validation and saving
            mock_repo_instance.save_agent_config.assert_called_once()
            mock_manager_instance.update_agent_config.assert_called_once()

    @pytest.mark.asyncio
    async def test_legacy_agent_sync_fallback(self) -> None:
        """Test fallback to legacy agent processing."""
        legacy_config = {
            "name": "Legacy Agent",
            "role": {"systemPrompt": "Legacy prompt"},
            "skills": [
                {
                    "id": "legacy-skill",
                    "name": "legacy_skill",
                    "instructions": "Do something"
                }
            ],
            "enableEnhancedSkills": False
        }
        
        with patch('src.utils.utils.runtime_config.RuntimeConfigRepository') as mock_repo, \
             patch('src.app.agents.agent_manager.get_agent_manager') as mock_manager:
            
            # Mock repository
            mock_repo_instance = AsyncMock()
            mock_repo_instance.save_agent_config.return_value = {"name": "Legacy Agent"}
            mock_repo.return_value = mock_repo_instance
            
            # Mock agent manager
            mock_manager_instance = AsyncMock()
            mock_manager.return_value = mock_manager_instance
            
            await _handle_enhanced_agent_sync(legacy_config)
            
            # Verify legacy processing
            mock_repo_instance.save_agent_config.assert_called_once()
            mock_manager_instance.update_agent_config.assert_called_once()

    def test_migrate_legacy_skill(self) -> None:
        """Test legacy skill migration to enhanced format."""
        legacy_skill = {
            "id": "legacy-skill",
            "name": "legacy_skill",
            "description": "Legacy skill",
            "instructions": "Do something",
            "allowedTools": ["tool1", "tool2"]
        }
        
        migrated = _migrate_legacy_skill(legacy_skill)
        
        # Verify enhanced fields were added
        assert migrated["when_to_use"] == ""
        assert migrated["triggers"] == []
        assert migrated["arguments"] == []
        assert migrated["context_mode"] == "inline"
        assert migrated["priority"] == 0
        
        # Verify original fields preserved
        assert migrated["id"] == "legacy-skill"
        assert migrated["name"] == "legacy_skill"
        assert migrated["instructions"] == "Do something"
        assert migrated["allowed_tools"] == ["tool1", "tool2"]  # Alias handled

    def test_migrate_legacy_skill_with_alias(self) -> None:
        """Test legacy skill migration with allowedTools alias."""
        legacy_skill = {
            "id": "legacy-skill",
            "name": "legacy_skill",
            "instructions": "Do something",
            "allowedTools": ["tool1"]  # Legacy alias
        }
        
        migrated = _migrate_legacy_skill(legacy_skill)
        
        # Verify alias was converted
        assert "allowedTools" not in migrated
        assert migrated["allowed_tools"] == ["tool1"]

    @pytest.mark.asyncio
    async def test_auto_migration_of_mixed_skills(self) -> None:
        """Test auto-migration when mixing legacy and enhanced skills."""
        mixed_config = {
            "name": "Mixed Agent",
            "role": {"systemPrompt": "Mixed prompt"},
            "skills": [
                # Legacy skill
                {
                    "id": "legacy-skill",
                    "name": "legacy_skill",
                    "instructions": "Legacy instruction"
                },
                # Enhanced skill
                {
                    "id": "enhanced-skill",
                    "name": "enhanced_skill",
                    "instructions": "Enhanced instruction",
                    "triggers": ["/enhanced"],
                    "when_to_use": "Use when enhanced"
                }
            ],
            "enableEnhancedSkills": True
        }
        
        with patch('src.utils.utils.runtime_config.RuntimeConfigRepository') as mock_repo, \
             patch('src.app.agents.agent_manager.get_agent_manager') as mock_manager:
            
            # Mock repository
            mock_repo_instance = AsyncMock()
            mock_repo_instance.save_agent_config.return_value = {"name": "Mixed Agent"}
            mock_repo.return_value = mock_repo_instance
            
            # Mock agent manager
            mock_manager_instance = AsyncMock()
            mock_manager.return_value = mock_manager_instance
            
            await _handle_enhanced_agent_sync(mixed_config)
            
            # Get the call arguments to verify migration
            call_args = mock_repo_instance.save_agent_config.call_args
            saved_config = call_args[0][0]  # First positional argument
            
            # Verify legacy skill was migrated
            legacy_skill = next(s for s in saved_config.skills if s["id"] == "legacy-skill")
            assert legacy_skill["when_to_use"] == ""
            assert legacy_skill["triggers"] == []
            assert legacy_skill["arguments"] == []
            
            # Verify enhanced skill was preserved
            enhanced_skill = next(s for s in saved_config.skills if s["id"] == "enhanced-skill")
            assert enhanced_skill["triggers"] == ["/enhanced"]
            assert enhanced_skill["when_to_use"] == "Use when enhanced"

    @pytest.mark.asyncio
    async def test_enhanced_config_validation_error(self) -> None:
        """Test handling of invalid enhanced configurations."""
        invalid_config = {
            "name": "",  # Invalid: empty name
            "role": {"systemPrompt": "Test"},
            "skills": [],
            "enableEnhancedSkills": True
        }
        
        with patch('src.utils.utils.runtime_config.RuntimeConfigRepository') as mock_repo:
            mock_repo_instance = AsyncMock()
            mock_repo.return_value = mock_repo_instance
            
            # Should raise validation error
            with pytest.raises(Exception):  # Pydantic validation error
                await _handle_enhanced_agent_sync(invalid_config)

    @pytest.mark.asyncio
    async def test_config_sync_error_handling(self) -> None:
        """Test error handling in config sync."""
        mock_message = AsyncMock()
        
        # Invalid data that should cause an error
        invalid_data = {"invalid": "data"}
        
        # Should raise exception (not swallow it)
        with pytest.raises(Exception):
            await handle_config_sync(mock_message, invalid_data, {})
