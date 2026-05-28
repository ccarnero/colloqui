"""Handler for configuration sync NATS messages."""

from __future__ import annotations

import logging
from typing import Any

from nats.aio.msg import Msg
from opentelemetry import trace

from src.messaging._nats_tracing import TracedNatsHandler
from src.services.domain.entities import JobDefinition, JobSyncPayload
from src.services.scheduler import get_job_scheduler
from src.messaging.utils import coerce_sync_files, coerce_delete_paths
from src.utils.config.settings import bootstrap_settings

import subjects as shared_subjects

logger = logging.getLogger(__name__)
_tracer = trace.get_tracer(__name__)


def build_subject(action: str) -> str:
    """Build NATS subject for tenant."""
    return shared_subjects.build_subject(bootstrap_settings.TENANT_ID, action)


async def handle_config_sync(
    message: Msg,
    data: Any,
    _envelope: dict[str, Any],
) -> None:
    """Handle configuration sync events with enhanced skills support.

    Supports three payload formats:
    - List: [{path, content}, ...] -> sync files only (legacy)
    - Dict: {files: [...], delete_paths: [...]} -> sync + delete (legacy)
    - Dict: {agent_config: {...}} -> enhanced agent config (NEW)

    Enhanced features:
    - Auto-migration of legacy skills to enhanced format
    - Validation of enhanced agent configurations
    - Backward compatibility with existing admin console
    """
    subject = build_subject("config_sync")
    logger.info(
        "Handling config_sync on subject %s with data type %s",
        subject,
        type(data).__name__,
    )

    with TracedNatsHandler(_tracer, "nats.consume", subject, message) as handler:
        try:
            # Check for enhanced agent config format
            if isinstance(data, dict) and "agent_config" in data:
                await _handle_enhanced_agent_sync(data["agent_config"])
                logger.info("Enhanced agent config sync completed successfully")
                return

            # Legacy file sync formats
            if isinstance(data, list):
                files = data
                delete_paths = None
                logger.info("Config sync: list format with %d files", len(files))
            elif isinstance(data, dict):
                files = data.get("files", [])
                delete_paths = data.get("delete_paths")
                logger.info(
                    "Config sync: dict format with %d files and %s delete_paths",
                    len(files),
                    delete_paths,
                )
            else:
                files = data
                delete_paths = None
                logger.warning(
                    "Config sync: unexpected data type %s", type(data).__name__
                )

            await _apply_config_sync(files, delete_paths)
            logger.info("Config sync completed successfully")
        except Exception as error:
            logger.exception("Failed to handle config sync event: %s", error)
            raise


async def _handle_enhanced_agent_sync(agent_config: dict[str, Any]) -> None:
    """Handle enhanced agent configuration sync."""
    try:
        payload_agent_id = agent_config.get("id")
        resolved_agent_id = (
            payload_agent_id.strip()
            if isinstance(payload_agent_id, str) and payload_agent_id.strip()
            else None
        )

        # Try to validate as enhanced agent config first
        from src.utils.config.agent_config import (
            EnhancedAgentSyncRequest,
            AgentSyncRequest,
        )

        # Check if enhanced features are enabled
        enable_enhanced = agent_config.get("enableEnhancedSkills", True)

        if enable_enhanced:
            # Validate and process enhanced config
            validated_config = EnhancedAgentSyncRequest(**agent_config)
            logger.info(f"Processing enhanced agent config: {validated_config.name}")

            # Check for legacy skills that need migration
            enhanced_skills = []
            for skill in validated_config.skills:
                if not any(
                    key in skill for key in ["when_to_use", "triggers", "arguments"]
                ):
                    # Auto-migrate legacy skill
                    enhanced_skill = _migrate_legacy_skill(skill)
                    enhanced_skills.append(enhanced_skill)
                    logger.info(f"Auto-migrated legacy skill: {skill.name}")
                else:
                    enhanced_skills.append(skill)

            # Update with migrated skills
            validated_config.skills = enhanced_skills
        else:
            # Process as legacy config
            validated_config = AgentSyncRequest(**agent_config)
            logger.info(f"Processing legacy agent config: {validated_config.name}")

        # Save to runtime storage
        from src.utils.utils.runtime_config import RuntimeConfigRepository
        from src.utils.config.settings import bootstrap_settings

        repo = RuntimeConfigRepository()

        saved_config = await repo.save_agent_config(validated_config)

        # Trigger runtime reload
        from src.app.agents.agent_manager import get_agent_manager

        await get_agent_manager().update_agent_config(
            saved_config,
            resolved_agent_id,
        )

        logger.info(f"Enhanced agent '{saved_config.get('name')}' synced successfully")

    except Exception as e:
        logger.error(f"Failed to process enhanced agent config: {e}")
        raise


def _migrate_legacy_skill(legacy_skill: dict[str, Any]) -> dict[str, Any]:
    """Migrate a legacy skill to enhanced format."""
    enhanced_skill = dict(legacy_skill)

    # Add enhanced fields with defaults
    enhanced_skill.setdefault("when_to_use", "")
    enhanced_skill.setdefault("triggers", [])
    enhanced_skill.setdefault("arguments", [])
    enhanced_skill.setdefault("context_mode", "inline")
    enhanced_skill.setdefault("priority", 0)

    # Handle field aliases
    if "allowedTools" in enhanced_skill and "allowed_tools" not in enhanced_skill:
        enhanced_skill["allowed_tools"] = enhanced_skill.pop("allowedTools")

    return enhanced_skill


async def _apply_config_sync(files: Any, delete_paths: Any) -> None:
    """Apply configuration sync to runtime."""
    from src.app.memory.memory_sync import apply_runtime_config_sync

    await apply_runtime_config_sync(
        files=coerce_sync_files(files),
        delete_paths=coerce_delete_paths(delete_paths),
    )


async def handle_jobs_sync(
    message: Msg,
    data: dict[str, Any],
    _envelope: dict[str, Any],
) -> None:
    """Handle jobs sync events."""
    subject = build_subject("jobs_sync")

    with TracedNatsHandler(_tracer, "nats.consume", subject, message) as handler:
        try:
            jobs = [
                JobDefinition(**job_data)
                for job_data in data.get("payload", {}).get("jobs", [])
            ]
            scheduler = get_job_scheduler()
            if scheduler:
                scheduler.sync_jobs(jobs)
                logger.info("Synced %d job definitions", len(jobs))
            else:
                logger.warning("Cannot sync jobs: scheduler not initialized")
        except Exception as error:
            logger.exception("Failed to handle jobs sync event: %s", error)
            raise
