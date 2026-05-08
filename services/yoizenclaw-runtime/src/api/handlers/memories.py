"""Memory inspection handlers for the YoizenClaw API."""

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from src.app.memory.scoped_service import default_tenant_id, get_scoped_memory_service
from src.app.tools.registry import get_registry

router = APIRouter()


class MemoryInspectQuery(BaseModel):
    """Query options for runtime memory inspection."""

    namespace: str | None = None
    query: str = ""
    limit: int = 25
    scope: str | None = None
    kind: str | None = None
    subject_id: str | None = None


class MemoryMutationRequest(BaseModel):
    """Request model for runtime-local memory mutations."""

    action: str
    namespace: str = ""
    key: str = ""
    value: Any = None
    query: str = ""
    limit: int = 10
    metadata: dict[str, Any] | None = None
    scope: str | None = None
    kind: str | None = None
    subject_id: str | None = None
    title: str | None = None
    content: str | None = None
    source_chat_id: str | None = None


class ProposalListQuery(BaseModel):
    """Query options for tenant proposal listing."""

    status: str = "proposed"
    kind: str | None = None
    limit: int = 50


class ProposalDecisionRequest(BaseModel):
    """Payload for proposal approval and rejection."""

    actor: str | None = None
    reason: str | None = None


@router.get("/memories")
async def inspect_memories(
    namespace: str | None = None,
    query: str = "",
    limit: int = 25,
    scope: str | None = None,
    kind: str | None = None,
    subject_id: str | None = None,
) -> dict[str, Any]:
    """Return a filtered snapshot of runtime memory."""

    options = MemoryInspectQuery(
        namespace=namespace,
        query=query,
        limit=limit,
        scope=scope,
        kind=kind,
        subject_id=subject_id,
    )
    return await get_registry().inspect_memory(
        namespace=options.namespace,
        query=options.query,
        limit=options.limit,
        scope=options.scope,
        kind=options.kind,
        subject_id=options.subject_id,
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
        scope=request.scope,
        kind=request.kind,
        subject_id=request.subject_id,
        title=request.title,
        content=request.content,
        source_chat_id=request.source_chat_id,
    )


@router.get("/memories/proposals")
async def list_memory_proposals(
    status: str = "proposed",
    kind: str | None = None,
    limit: int = 50,
) -> dict[str, Any]:
    """List tenant memory proposals for admin approval flows."""

    query = ProposalListQuery(status=status, kind=kind, limit=limit)
    service = get_scoped_memory_service()
    items = await service.list_proposals(
        tenant_id=default_tenant_id(),
        status=query.status,
        kind=query.kind,
        limit=query.limit,
    )
    return {
        "success": True,
        "items": [service.serialize_record(item) for item in items],
    }


@router.post("/memories/proposals/{memory_id}/approve")
async def approve_memory_proposal(
    memory_id: str,
    request: ProposalDecisionRequest,
) -> dict[str, Any]:
    """Approve a tenant memory proposal."""

    service = get_scoped_memory_service()
    record = await service.approve_proposal(
        tenant_id=default_tenant_id(),
        memory_id=memory_id,
        actor=request.actor,
        reason=request.reason,
    )
    return {
        "success": record is not None,
        "item": service.serialize_record(record) if record else None,
    }


@router.post("/memories/proposals/{memory_id}/reject")
async def reject_memory_proposal(
    memory_id: str,
    request: ProposalDecisionRequest,
) -> dict[str, Any]:
    """Reject a tenant memory proposal."""

    service = get_scoped_memory_service()
    record = await service.reject_proposal(
        tenant_id=default_tenant_id(),
        memory_id=memory_id,
        actor=request.actor,
        reason=request.reason,
    )
    return {
        "success": record is not None,
        "item": service.serialize_record(record) if record else None,
    }
