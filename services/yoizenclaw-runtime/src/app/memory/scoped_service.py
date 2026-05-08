"""Service facade for scoped runtime memory."""

from __future__ import annotations

import json
from typing import Any

from src.app.memory.policy import resolve_memory_policy
from src.app.memory.session_store import SESSION_MEMORY_STORE
from src.app.memory.scoped_models import MemoryPolicy, ScopedMemoryRecord
from src.app.memory.scoped_repository import ScopedMemoryRepository
from src.utils.config.settings import bootstrap_settings


class ScopedMemoryService:
    """Application service for session, user, and tenant memories."""

    def __init__(self, repository: ScopedMemoryRepository | None = None) -> None:
        self._repository = repository or ScopedMemoryRepository()

    async def put_session_memory(
        self,
        *,
        namespace: str,
        key: str,
        value: Any,
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        """Store session-compatible runtime memory in-process."""

        namespace_store = SESSION_MEMORY_STORE.setdefault(namespace, {})
        entry = {"key": key, "value": value, "metadata": metadata}
        namespace_store[key] = entry
        return entry

    async def get_session_memory(
        self,
        *,
        namespace: str,
        key: str,
    ) -> dict[str, Any] | None:
        """Read a session memory entry from the compatibility store."""

        return SESSION_MEMORY_STORE.get(namespace, {}).get(key)

    async def search_session_memory(
        self,
        *,
        namespace: str,
        query: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        """Search the session compatibility store."""

        lowered_query = query.strip().lower()
        items = [
            {
                "key": entry_key,
                "value": entry_value.get("value"),
                "metadata": entry_value.get("metadata", {}),
            }
            for entry_key, entry_value in SESSION_MEMORY_STORE.get(
                namespace, {}
            ).items()
            if not lowered_query
            or lowered_query in str(entry_value.get("value", "")).lower()
        ]
        return items[: max(limit, 0)]

    async def delete_session_memory(self, *, namespace: str, key: str) -> bool:
        """Delete a session memory entry from the compatibility store."""

        namespace_store = SESSION_MEMORY_STORE.setdefault(namespace, {})
        deleted = key in namespace_store
        namespace_store.pop(key, None)
        return deleted

    async def put_persistent_memory(
        self,
        *,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        namespace: str,
        memory_key: str,
        title: str,
        content: str,
        payload: Any,
        metadata: dict[str, Any],
        kind: str,
        agent_id: str | None,
        source_chat_id: str | None,
        source_user_id: str | None,
        created_by: str | None,
        status: str,
    ) -> ScopedMemoryRecord:
        """Persist a user or tenant scoped memory entry."""

        return await self._repository.save_memory(
            tenant_id=tenant_id,
            scope_type=scope_type,
            scope_id=scope_id,
            status=status,
            kind=kind,
            title=title,
            content=content,
            payload=payload,
            metadata=metadata,
            namespace=namespace,
            memory_key=memory_key,
            agent_id=agent_id,
            source_chat_id=source_chat_id,
            source_user_id=source_user_id,
            created_by=created_by,
        )

    async def get_persistent_memory(
        self,
        *,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        namespace: str,
        memory_key: str,
        include_statuses: list[str],
    ) -> ScopedMemoryRecord | None:
        """Fetch the latest user or tenant scoped memory entry."""

        return await self._repository.get_memory(
            tenant_id=tenant_id,
            scope_type=scope_type,
            scope_id=scope_id,
            namespace=namespace,
            memory_key=memory_key,
            include_statuses=include_statuses,
        )

    async def search_persistent_memories(
        self,
        *,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        namespace: str | None,
        query: str,
        kind: str | None,
        limit: int,
        include_statuses: list[str],
    ) -> list[ScopedMemoryRecord]:
        """Search user or tenant scoped memories."""

        return await self._repository.search_memories(
            tenant_id=tenant_id,
            scope_type=scope_type,
            scope_id=scope_id,
            namespace=namespace,
            query=query,
            kind=kind,
            limit=limit,
            include_statuses=include_statuses,
        )

    async def delete_persistent_memory(
        self,
        *,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        namespace: str,
        memory_key: str,
    ) -> bool:
        """Delete user or tenant scoped memories by key."""

        return await self._repository.delete_memory(
            tenant_id=tenant_id,
            scope_type=scope_type,
            scope_id=scope_id,
            namespace=namespace,
            memory_key=memory_key,
        )

    async def list_proposals(
        self,
        *,
        tenant_id: str,
        status: str = "proposed",
        kind: str | None = None,
        limit: int = 50,
    ) -> list[ScopedMemoryRecord]:
        """List tenant memory proposals."""

        return await self._repository.list_proposals(
            tenant_id=tenant_id,
            status=status,
            kind=kind,
            limit=limit,
        )

    async def approve_proposal(
        self,
        *,
        tenant_id: str,
        memory_id: str,
        actor: str | None,
        reason: str | None = None,
    ) -> ScopedMemoryRecord | None:
        """Approve and publish a tenant proposal."""

        record = await self._repository.transition_proposal(
            tenant_id=tenant_id,
            memory_id=memory_id,
            new_status="published",
        )
        if record is None:
            return None
        await self._repository.write_approval_event(
            tenant_id=tenant_id,
            scoped_memory_id=memory_id,
            action="approved",
            actor=actor,
            reason=reason,
            metadata={"status": "published"},
        )
        return record

    async def reject_proposal(
        self,
        *,
        tenant_id: str,
        memory_id: str,
        actor: str | None,
        reason: str | None = None,
    ) -> ScopedMemoryRecord | None:
        """Reject a tenant proposal."""

        record = await self._repository.transition_proposal(
            tenant_id=tenant_id,
            memory_id=memory_id,
            new_status="rejected",
        )
        if record is None:
            return None
        await self._repository.write_approval_event(
            tenant_id=tenant_id,
            scoped_memory_id=memory_id,
            action="rejected",
            actor=actor,
            reason=reason,
            metadata={"status": "rejected"},
        )
        return record

    async def build_tenant_auto_read_context(
        self,
        *,
        tenant_id: str,
        tools: list[dict[str, Any]] | None,
    ) -> dict[str, Any]:
        """Load published tenant memories for memory-enabled agents."""

        policy = resolve_memory_policy(tools)
        if not policy.enabled:
            return {}

        items = await self.search_persistent_memories(
            tenant_id=tenant_id,
            scope_type="tenant",
            scope_id=tenant_id,
            namespace=None,
            query="",
            kind=None,
            limit=100,
            include_statuses=["published"],
        )

        selected = [
            item for item in items if item.kind in policy.auto_read_tenant_kinds
        ]
        summary_lines = [
            f"- [{item.kind}] {item.title}: {item.content}" for item in selected
        ]
        return {
            "policy": {
                "allow_user_write": policy.allow_user_write,
                "allow_tenant_proposal": policy.allow_tenant_proposal,
                "instructions": policy.instructions,
                "auto_read_tenant_kinds": policy.auto_read_tenant_kinds,
            },
            "tenant": {
                "summary": "\n".join(summary_lines),
                "items": [self.serialize_record(item) for item in selected],
            },
        }

    @staticmethod
    def serialize_record(record: ScopedMemoryRecord) -> dict[str, Any]:
        """Serialize a scoped memory record for API and prompt contexts."""

        return {
            "id": record.id,
            "tenant_id": record.tenant_id,
            "scope": record.scope_type,
            "scope_id": record.scope_id,
            "status": record.status,
            "kind": record.kind,
            "title": record.title,
            "content": record.content,
            "payload": record.payload,
            "metadata": record.metadata,
            "namespace": record.namespace,
            "key": record.memory_key,
            "agent_id": record.agent_id,
            "source_chat_id": record.source_chat_id,
            "source_user_id": record.source_user_id,
            "created_by": record.created_by,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
            "approved_at": record.approved_at.isoformat()
            if record.approved_at
            else None,
            "expires_at": record.expires_at.isoformat() if record.expires_at else None,
        }


def _create_scoped_memory_service() -> ScopedMemoryService:
    return ScopedMemoryService()


def get_scoped_memory_service() -> ScopedMemoryService:
    """Resolve the shared scoped memory service from the container."""

    from src.utils.di import get_container

    return get_container().get_or_create(
        "scoped_memory_service",
        _create_scoped_memory_service,
    )


def coerce_content(value: Any) -> str:
    """Create a compact content representation for structured payloads."""

    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def default_tenant_id() -> str:
    """Return the runtime tenant identifier with a safe default."""

    return bootstrap_settings.TENANT_ID or "default"


def resolve_policy(tools: list[dict[str, Any]] | None) -> MemoryPolicy:
    """Small re-export for callers that should not import policy helpers."""

    return resolve_memory_policy(tools)
