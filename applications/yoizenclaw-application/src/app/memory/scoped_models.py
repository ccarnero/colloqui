"""Shared models for scoped runtime memory."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

ScopeType = Literal["session", "user", "tenant"]
MemoryStatus = Literal["published", "proposed", "rejected", "expired"]

DEFAULT_AUTO_READ_TENANT_KINDS = ["promo", "incident", "notice"]


@dataclass(slots=True, frozen=True)
class MemoryPolicy:
    """Resolved memory capabilities for an agent."""

    enabled: bool = False
    auto_read_tenant_kinds: list[str] = field(
        default_factory=lambda: list(DEFAULT_AUTO_READ_TENANT_KINDS),
    )
    allow_user_write: bool = True
    allow_tenant_proposal: bool = True
    instructions: str = ""


@dataclass(slots=True, frozen=True)
class ScopedMemoryRecord:
    """Normalized scoped memory entry."""

    id: str
    tenant_id: str
    scope_type: ScopeType
    scope_id: str
    status: MemoryStatus
    kind: str
    title: str
    content: str
    payload: Any
    metadata: dict[str, Any]
    namespace: str
    memory_key: str
    agent_id: str | None
    source_chat_id: str | None
    source_user_id: str | None
    created_by: str | None
    created_at: datetime
    updated_at: datetime
    approved_at: datetime | None
    expires_at: datetime | None


@dataclass(slots=True, frozen=True)
class ApprovalEventRecord:
    """Approval history entry for tenant proposals."""

    id: str
    tenant_id: str
    scoped_memory_id: str
    action: Literal["approved", "rejected"]
    actor: str | None
    reason: str | None
    metadata: dict[str, Any]
    created_at: datetime
