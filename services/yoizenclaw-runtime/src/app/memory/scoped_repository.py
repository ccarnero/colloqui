"""PostgreSQL repository for scoped runtime memory."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from src.app.memory.ports import IMemoryPoolProvider
from src.app.memory.scoped_models import ApprovalEventRecord, ScopedMemoryRecord


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ScopedMemoryRepository:
    """Persistence adapter for session/user/tenant memories."""

    def __init__(self, memory: IMemoryPoolProvider | None = None) -> None:
        if memory is not None:
            self._memory = memory
        else:
            from src.infra.database.memory_postgres import Memory

            self._memory = Memory()

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
        """Insert a scoped memory row and return the normalized record."""

        await self._memory.initialize()
        memory_id = str(uuid4())
        now = _utc_now()

        async with self._memory.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO scoped_memories (
                    id,
                    tenant_id,
                    scope_type,
                    scope_id,
                    agent_id,
                    kind,
                    title,
                    content,
                    payload,
                    metadata,
                    namespace,
                    memory_key,
                    status,
                    source_chat_id,
                    source_user_id,
                    created_by,
                    created_at,
                    updated_at,
                    expires_at
                )
                VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9,
                    $10, $11, $12, $13, $14, $15, $16, $17, $17, $18
                )
                RETURNING *
                """,
                memory_id,
                tenant_id,
                scope_type,
                scope_id,
                agent_id,
                kind,
                title,
                content,
                payload,
                metadata,
                namespace,
                memory_key,
                status,
                source_chat_id,
                source_user_id,
                created_by,
                now,
                expires_at,
            )

        return self._row_to_record(row)

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
        async with self._memory.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT *
                FROM scoped_memories
                WHERE tenant_id = $1
                  AND scope_type = $2
                  AND scope_id = $3
                  AND namespace = $4
                  AND memory_key = $5
                  AND status = ANY($6::text[])
                ORDER BY created_at DESC
                LIMIT 1
                """,
                tenant_id,
                scope_type,
                scope_id,
                namespace,
                memory_key,
                include_statuses,
            )
        if row is None:
            return None
        return self._row_to_record(row)

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
        async with self._memory.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT *
                FROM scoped_memories
                WHERE tenant_id = $1
                  AND scope_type = $2
                  AND scope_id = $3
                  AND ($4::text IS NULL OR namespace = $4)
                  AND ($5::text IS NULL OR kind = $5)
                  AND status = ANY($6::text[])
                  AND (
                    $7::text = ''
                    OR LOWER(title) LIKE '%' || $7 || '%'
                    OR LOWER(content) LIKE '%' || $7 || '%'
                    OR LOWER(memory_key) LIKE '%' || $7 || '%'
                  )
                ORDER BY created_at DESC
                LIMIT $8
                """,
                tenant_id,
                scope_type,
                scope_id,
                namespace,
                kind,
                include_statuses,
                lowered_query,
                normalized_limit,
            )
        return [self._row_to_record(row) for row in rows]

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
        async with self._memory.pool.acquire() as conn:
            result = await conn.execute(
                """
                DELETE FROM scoped_memories
                WHERE tenant_id = $1
                  AND scope_type = $2
                  AND scope_id = $3
                  AND namespace = $4
                  AND memory_key = $5
                """,
                tenant_id,
                scope_type,
                scope_id,
                namespace,
                memory_key,
            )
        deleted_count = int(str(result).split()[-1])
        return deleted_count > 0

    async def list_proposals(
        self,
        *,
        tenant_id: str,
        status: str = "proposed",
        kind: str | None = None,
        limit: int = 50,
    ) -> list[ScopedMemoryRecord]:
        """List tenant proposal rows."""

        await self._memory.initialize()
        async with self._memory.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT *
                FROM scoped_memories
                WHERE tenant_id = $1
                  AND scope_type = 'tenant'
                  AND status = $2
                  AND ($3::text IS NULL OR kind = $3)
                ORDER BY created_at DESC
                LIMIT $4
                """,
                tenant_id,
                status,
                kind,
                max(limit, 0),
            )
        return [self._row_to_record(row) for row in rows]

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
        async with self._memory.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE scoped_memories
                SET status = $3,
                    approved_at = $4,
                    updated_at = $5
                WHERE tenant_id = $1
                  AND id = $2
                  AND scope_type = 'tenant'
                RETURNING *
                """,
                tenant_id,
                memory_id,
                new_status,
                approved_at,
                _utc_now(),
            )
        if row is None:
            return None
        return self._row_to_record(row)

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
        """Insert an approval event row."""

        await self._memory.initialize()
        event_id = str(uuid4())
        created_at = _utc_now()
        async with self._memory.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO memory_approval_events (
                    id,
                    tenant_id,
                    scoped_memory_id,
                    action,
                    actor,
                    reason,
                    metadata,
                    created_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
                """,
                event_id,
                tenant_id,
                scoped_memory_id,
                action,
                actor,
                reason,
                metadata,
                created_at,
            )
        return ApprovalEventRecord(
            id=str(row["id"]),
            tenant_id=str(row["tenant_id"]),
            scoped_memory_id=str(row["scoped_memory_id"]),
            action=str(row["action"]),
            actor=row["actor"],
            reason=row["reason"],
            metadata=self._coerce_dict(row["metadata"]),
            created_at=row["created_at"],
        )

    @staticmethod
    def _coerce_dict(value: Any) -> dict[str, Any]:
        if isinstance(value, dict):
            return dict(value)
        return {}

    def _row_to_record(self, row: Any) -> ScopedMemoryRecord:
        payload = row["payload"]
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except json.JSONDecodeError:
                pass
        return ScopedMemoryRecord(
            id=str(row["id"]),
            tenant_id=str(row["tenant_id"]),
            scope_type=str(row["scope_type"]),
            scope_id=str(row["scope_id"]),
            status=str(row["status"]),
            kind=str(row["kind"]),
            title=str(row["title"]),
            content=str(row["content"]),
            payload=payload,
            metadata=self._coerce_dict(row["metadata"]),
            namespace=str(row["namespace"]),
            memory_key=str(row["memory_key"]),
            agent_id=row["agent_id"],
            source_chat_id=row["source_chat_id"],
            source_user_id=row["source_user_id"],
            created_by=row["created_by"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            approved_at=row["approved_at"],
            expires_at=row["expires_at"],
        )
