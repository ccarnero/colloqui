"""MongoDB repository for scoped runtime memory."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from pymongo import ReturnDocument

from src.app.memory.ports import IMemoryDatabaseProvider
from src.app.memory.scoped_models import ApprovalEventRecord, ScopedMemoryRecord


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ScopedMemoryRepository:
    """Persistence adapter for session/user/tenant memories."""

    def __init__(self, memory: IMemoryDatabaseProvider | None = None) -> None:
        if memory is not None:
            self._memory = memory
        else:
            from src.app.memory import create_memory

            self._memory = create_memory()

    async def save_memory(
        self,
        *,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        status: str,
        kind: str,
        title: str,
        content: str,
        payload: Any,
        metadata: dict[str, Any],
        namespace: str,
        memory_key: str,
        agent_id: str | None,
        source_chat_id: str | None,
        source_user_id: str | None,
        created_by: str | None,
        expires_at: datetime | None = None,
    ) -> ScopedMemoryRecord:
        """Insert a scoped memory document and return the normalized record."""

        await self._memory.initialize()
        memory_id = str(uuid4())
        now = _utc_now()
        document = {
            "id": memory_id,
            "tenant_id": tenant_id,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "agent_id": agent_id,
            "kind": kind,
            "title": title,
            "content": content,
            "payload": payload,
            "metadata": metadata,
            "namespace": namespace,
            "memory_key": memory_key,
            "status": status,
            "source_chat_id": source_chat_id,
            "source_user_id": source_user_id,
            "created_by": created_by,
            "created_at": now,
            "updated_at": now,
            "approved_at": None,
            "expires_at": expires_at,
            "deleted_at": None,
        }
        await self._memory.db.scoped_memories.insert_one(document)
        return self._document_to_record(document)

    async def get_memory(
        self,
        *,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        namespace: str,
        memory_key: str,
        include_statuses: list[str],
    ) -> ScopedMemoryRecord | None:
        """Fetch the newest record for a scope/key pair."""

        await self._memory.initialize()
        document = await self._memory.db.scoped_memories.find_one(
            {
                "tenant_id": tenant_id,
                "scope_type": scope_type,
                "scope_id": scope_id,
                "namespace": namespace,
                "memory_key": memory_key,
                "status": {"$in": include_statuses},
            },
            sort=[("created_at", -1)],
        )
        if document is None:
            return None
        return self._document_to_record(document)

    async def search_memories(
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
        """Search memories within a scope."""

        await self._memory.initialize()
        normalized_limit = max(limit, 0)
        lowered_query = query.strip().lower()
        filters: dict[str, Any] = {
            "tenant_id": tenant_id,
            "scope_type": scope_type,
            "scope_id": scope_id,
            "status": {"$in": include_statuses},
        }
        if namespace is not None:
            filters["namespace"] = namespace
        if kind is not None:
            filters["kind"] = kind
        if lowered_query:
            pattern = re.escape(lowered_query)
            filters["$or"] = [
                {"title": {"$regex": pattern, "$options": "i"}},
                {"content": {"$regex": pattern, "$options": "i"}},
                {"memory_key": {"$regex": pattern, "$options": "i"}},
            ]

        cursor = (
            self._memory.db.scoped_memories.find(filters)
            .sort("created_at", -1)
            .limit(normalized_limit)
        )
        return [self._document_to_record(document) async for document in cursor]

    async def delete_memory(
        self,
        *,
        tenant_id: str,
        scope_type: str,
        scope_id: str,
        namespace: str,
        memory_key: str,
    ) -> bool:
        """Delete scoped memories by scope/key pair."""

        await self._memory.initialize()
        result = await self._memory.db.scoped_memories.delete_many(
            {
                "tenant_id": tenant_id,
                "scope_type": scope_type,
                "scope_id": scope_id,
                "namespace": namespace,
                "memory_key": memory_key,
            },
        )
        return result.deleted_count > 0

    async def list_proposals(
        self,
        *,
        tenant_id: str,
        status: str = "proposed",
        kind: str | None = None,
        limit: int = 50,
    ) -> list[ScopedMemoryRecord]:
        """List tenant proposal documents."""

        await self._memory.initialize()
        filters: dict[str, Any] = {
            "tenant_id": tenant_id,
            "scope_type": "tenant",
            "status": status,
        }
        if kind is not None:
            filters["kind"] = kind

        cursor = (
            self._memory.db.scoped_memories.find(filters)
            .sort("created_at", -1)
            .limit(max(limit, 0))
        )
        return [self._document_to_record(document) async for document in cursor]

    async def transition_proposal(
        self,
        *,
        tenant_id: str,
        memory_id: str,
        new_status: str,
    ) -> ScopedMemoryRecord | None:
        """Transition a proposal to a new status."""

        await self._memory.initialize()
        approved_at = _utc_now() if new_status == "published" else None
        document = await self._memory.db.scoped_memories.find_one_and_update(
            {
                "tenant_id": tenant_id,
                "id": memory_id,
                "scope_type": "tenant",
            },
            {
                "$set": {
                    "status": new_status,
                    "approved_at": approved_at,
                    "updated_at": _utc_now(),
                },
            },
            return_document=ReturnDocument.AFTER,
        )
        if document is None:
            return None
        return self._document_to_record(document)

    async def write_approval_event(
        self,
        *,
        tenant_id: str,
        scoped_memory_id: str,
        action: str,
        actor: str | None,
        reason: str | None,
        metadata: dict[str, Any],
    ) -> ApprovalEventRecord:
        """Insert an approval event document."""

        await self._memory.initialize()
        event_id = str(uuid4())
        created_at = _utc_now()
        document = {
            "id": event_id,
            "tenant_id": tenant_id,
            "scoped_memory_id": scoped_memory_id,
            "action": action,
            "actor": actor,
            "reason": reason,
            "metadata": metadata,
            "created_at": created_at,
        }
        await self._memory.db.memory_approval_events.insert_one(document)
        return ApprovalEventRecord(
            id=event_id,
            tenant_id=tenant_id,
            scoped_memory_id=scoped_memory_id,
            action=action,
            actor=actor,
            reason=reason,
            metadata=self._coerce_dict(metadata),
            created_at=created_at,
        )

    @staticmethod
    def _coerce_dict(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        return {}

    def _document_to_record(self, document: dict[str, Any]) -> ScopedMemoryRecord:
        payload = document.get("payload")
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                pass
        return ScopedMemoryRecord(
            id=str(document["id"]),
            tenant_id=str(document["tenant_id"]),
            scope_type=str(document["scope_type"]),
            scope_id=str(document["scope_id"]),
            status=str(document["status"]),
            kind=str(document["kind"]),
            title=str(document["title"]),
            content=str(document["content"]),
            payload=payload,
            metadata=self._coerce_dict(document.get("metadata")),
            namespace=str(document["namespace"]),
            memory_key=str(document["memory_key"]),
            agent_id=document.get("agent_id"),
            source_chat_id=document.get("source_chat_id"),
            source_user_id=document.get("source_user_id"),
            created_by=document.get("created_by"),
            created_at=document["created_at"],
            updated_at=document["updated_at"],
            approved_at=document.get("approved_at"),
            expires_at=document.get("expires_at"),
        )
