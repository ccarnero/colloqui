"""Config sync handlers for YoizenClaw API."""

import logging
from typing import Literal
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.shared.config.config_files import ConfigFileSyncError
from src.shared.config.agent_config import AgentSyncRequest
from src.application.memory.memory_sync import apply_runtime_config_sync
from src.application.agents.agent_manager import get_agent_manager

router = APIRouter()

logger = logging.getLogger(__name__)


class SyncRequest(BaseModel):
    """Request model for config sync endpoint."""
    agent: AgentSyncRequest
    action: Literal["publish", "unpublish"]


class SyncResponse(BaseModel):
    """Response model for config sync endpoint."""
    success: bool
    status: str
    message: str


class ConfigFilePayload(BaseModel):
    """Single config file payload pushed from backend seed."""
    path: str
    content: str


class ConfigFilesSyncRequest(BaseModel):
    """Batch of config files to persist under the runtime config dir."""
    files: list[ConfigFilePayload] = []
    deletePaths: list[str] = []


class ConfigFilesSyncResponse(BaseModel):
    """Response model for config file sync endpoint."""
    success: bool
    status: str
    written_paths: list[str]
    deleted_paths: list[str]


@router.post("/config/sync", response_model=SyncResponse)
async def sync_config(request: SyncRequest) -> SyncResponse:
    """Receive agent configuration from backend and apply it.

    Args:
        request: Contains agent config and action (publish/unpublish)

    Returns:
        Success status and message
    """
    try:
        if request.action == "publish":
            await get_agent_manager().update_agent_config(
                request.agent.model_dump(by_alias=False, exclude_none=True)
            )
            return SyncResponse(
                success=True,
                status="applied",
                message=f"Agent '{request.agent.name}' config synced"
            )
        elif request.action == "unpublish":
            await get_agent_manager().remove_agent_config()
            return SyncResponse(
                success=True,
                status="removed",
                message="Agent config removed"
            )
        else:
            return SyncResponse(
                success=False,
                status="error",
                message=f"Unknown action: {request.action}"
            )
    except Exception as e:
        logger.exception("config/sync failed: %s", e)
        raise HTTPException(status_code=500, detail={"error": "CONFIG_SYNC_ERROR", "message": str(e)})


@router.post("/config/files/sync", response_model=ConfigFilesSyncResponse)
async def sync_config_files(
    request: ConfigFilesSyncRequest,
) -> ConfigFilesSyncResponse:
    """Persist backend-managed seed files into the runtime config dir."""
    try:
        written_paths, deleted_paths = await apply_runtime_config_sync(
            files=[file.model_dump() for file in request.files],
            delete_paths=request.deletePaths,
        )
        return ConfigFilesSyncResponse(
            success=True,
            status="applied",
            written_paths=written_paths,
            deleted_paths=deleted_paths,
        )
    except ConfigFileSyncError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except Exception as error:
        logger.exception("config/files/sync failed: %s", error)
        raise HTTPException(status_code=500, detail=str(error))
