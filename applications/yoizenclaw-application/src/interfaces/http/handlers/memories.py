"""Memory inspection handlers for the YoizenClaw API."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from src.tools.registry import get_registry

router = APIRouter()


class MemoryInspectQuery(BaseModel):
    """Query options for runtime memory inspection."""

    namespace: str | None = None
    query: str = ""
    limit: int = 25


class MemoryMutationRequest(BaseModel):
    """Request model for runtime-local memory mutations."""

    action: str
    namespace: str
    key: str = ""
    value: Any = None
    query: str = ""
    limit: int = 10
    metadata: dict[str, Any] | None = None


@router.get("/memories")
async def inspect_memories(
    namespace: str | None = None,
    query: str = "",
    limit: int = 25,
) -> dict[str, Any]:
    """Return a filtered snapshot of runtime-local memory."""

    options = MemoryInspectQuery(namespace=namespace, query=query, limit=limit)
    return get_registry().inspect_memory(
        namespace=options.namespace,
        query=options.query,
        limit=options.limit,
    )


@router.post("/memories")
async def mutate_memory(request: MemoryMutationRequest) -> dict[str, Any]:
    """Proxy memory tool mutations over HTTP for the demo UI."""

    return await get_registry().memory(
        action=request.action,
        namespace=request.namespace,
        key=request.key,
        value=request.value,
        query=request.query,
        limit=request.limit,
        metadata=request.metadata,
    )
