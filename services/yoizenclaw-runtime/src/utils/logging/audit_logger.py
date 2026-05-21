"""Audit event persistence helpers for PostgreSQL runtime state."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

import asyncpg


@dataclass(frozen=True, slots=True)
class AuditEvent:
    """Structured audit event payload for mutable runtime state changes."""

    scope: str
    action: str
    subject: str
    details: dict[str, Any] = field(default_factory=dict)
    created_by: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now())


async def write_audit_event(pool: asyncpg.Pool, event: AuditEvent) -> str:
    """Persist an audit event and return its generated identifier."""

    audit_id = str(uuid4())

    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO audit_log
            (id, scope, action, subject, details, created_by, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            """,
            audit_id,
            event.scope,
            event.action,
            event.subject,
            event.details,
            event.created_by,
            event.created_at,
        )

    return audit_id
