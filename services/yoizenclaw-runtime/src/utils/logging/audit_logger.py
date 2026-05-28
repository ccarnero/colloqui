"""Audit event persistence helpers for MongoDB runtime state."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from motor.motor_asyncio import AsyncIOMotorDatabase


@dataclass(frozen=True, slots=True)
class AuditEvent:
    """Structured audit event payload for mutable runtime state changes."""

    scope: str
    action: str
    subject: str
    details: dict[str, Any] = field(default_factory=dict)
    created_by: str | None = None
    created_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc),
    )


async def write_audit_event(db: AsyncIOMotorDatabase, event: AuditEvent) -> str:
    """Persist an audit event and return its generated identifier."""

    audit_id = str(uuid4())
    await db.audit_log.insert_one(
        {
            "id": audit_id,
            "scope": event.scope,
            "action": event.action,
            "subject": event.subject,
            "details": event.details,
            "created_by": event.created_by,
            "created_at": event.created_at,
            "deleted_at": None,
        },
    )
    return audit_id
