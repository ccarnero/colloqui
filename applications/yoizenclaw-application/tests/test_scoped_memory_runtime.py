from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from src.app.memory.scoped_models import ScopedMemoryRecord
from src.app.tools.builtin_tools import create_memory_tool
from src.app.tools.registry import ToolRegistry, _MEMORY_STORE


def _build_record(
    *,
    scope_type: str,
    scope_id: str,
    status: str,
    kind: str = "general",
    payload: Any = None,
    metadata: dict[str, Any] | None = None,
) -> ScopedMemoryRecord:
    now = datetime.now(timezone.utc)
    return ScopedMemoryRecord(
        id="memory-1",
        tenant_id="acme",
        scope_type=scope_type,  # type: ignore[arg-type]
        scope_id=scope_id,
        status=status,  # type: ignore[arg-type]
        kind=kind,
        title="Memory title",
        content="Memory content",
        payload=payload,
        metadata=metadata or {},
        namespace="default",
        memory_key="preference",
        agent_id="agent-1",
        source_chat_id="chat-1",
        source_user_id="user-1",
        created_by="agent-1",
        created_at=now,
        updated_at=now,
        approved_at=None,
        expires_at=None,
    )


class _FakeScopedMemoryService:
    def __init__(self) -> None:
        self.put_calls: list[dict[str, Any]] = []
        self.get_calls: list[dict[str, Any]] = []
        self.search_calls: list[dict[str, Any]] = []
        self.record = _build_record(
            scope_type="user",
            scope_id="user-1",
            status="published",
            payload={"language": "en"},
            metadata={"source": "test"},
        )

    async def put_persistent_memory(self, **kwargs: Any) -> ScopedMemoryRecord:
        self.put_calls.append(kwargs)
        return _build_record(
            scope_type=kwargs["scope_type"],
            scope_id=kwargs["scope_id"],
            status=kwargs["status"],
            kind=kwargs["kind"],
            payload=kwargs["payload"],
            metadata=kwargs["metadata"],
        )

    async def get_persistent_memory(self, **kwargs: Any) -> ScopedMemoryRecord | None:
        self.get_calls.append(kwargs)
        return self.record

    async def search_persistent_memories(
        self, **kwargs: Any
    ) -> list[ScopedMemoryRecord]:
        self.search_calls.append(kwargs)
        return [self.record]

    @staticmethod
    def serialize_record(record: ScopedMemoryRecord) -> dict[str, Any]:
        return {
            "id": record.id,
            "scope": record.scope_type,
            "scope_id": record.scope_id,
            "status": record.status,
            "kind": record.kind,
            "key": record.memory_key,
            "value": record.payload,
            "metadata": record.metadata,
        }


@pytest.mark.asyncio
async def test_tenant_put_becomes_proposal(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _FakeScopedMemoryService()
    registry = ToolRegistry()

    monkeypatch.setattr(
        "src.app.tools.registry.get_scoped_memory_service",
        lambda: service,
    )

    result = await registry.memory(
        action="put",
        scope="tenant",
        tenant_id="acme",
        namespace="announcements",
        key="promo-1",
        value={"message": "20% off"},
        kind="promo",
        agent_id="agent-1",
    )

    assert result["success"] is True
    assert result["action"] == "propose"
    assert result["record"]["status"] == "proposed"
    assert service.put_calls[0]["status"] == "proposed"
    assert service.put_calls[0]["scope_id"] == "acme"


@pytest.mark.asyncio
async def test_user_memory_uses_stable_user_id(monkeypatch: pytest.MonkeyPatch) -> None:
    service = _FakeScopedMemoryService()
    registry = ToolRegistry()

    monkeypatch.setattr(
        "src.app.tools.registry.get_scoped_memory_service",
        lambda: service,
    )

    saved = await registry.memory(
        action="put",
        scope="user",
        namespace="profile",
        key="preference",
        value={"language": "en"},
        metadata={"source": "llm"},
        user_id="user-1",
        source_chat_id="chat-trace-1",
    )
    loaded = await registry.memory(
        action="get",
        scope="user",
        namespace="profile",
        key="preference",
        user_id="user-1",
        source_chat_id="chat-trace-2",
    )

    assert saved["record"]["scope_id"] == "user-1"
    assert service.put_calls[0]["source_chat_id"] == "chat-trace-1"
    assert service.put_calls[0]["source_user_id"] == "user-1"
    assert loaded["value"] == {"language": "en"}
    assert service.get_calls[0]["scope_id"] == "user-1"


@pytest.mark.asyncio
async def test_user_memory_write_respects_memory_policy() -> None:
    registry = ToolRegistry()

    result = await registry.memory(
        action="put",
        scope="user",
        namespace="profile",
        key="preference",
        value={"language": "en"},
        user_id="user-1",
        memory={"policy": {"allow_user_write": False}},
    )

    assert result["success"] is False
    assert "disabled by memory policy" in result["error"]


@pytest.mark.asyncio
async def test_tenant_proposal_respects_memory_policy() -> None:
    registry = ToolRegistry()

    result = await registry.memory(
        action="propose",
        scope="tenant",
        tenant_id="acme",
        namespace="announcements",
        key="promo-1",
        value={"message": "20% off"},
        kind="promo",
        memory={"policy": {"allow_tenant_proposal": False}},
    )

    assert result["success"] is False
    assert "disabled by memory policy" in result["error"]


@pytest.mark.asyncio
async def test_inspect_memory_reads_persistent_user_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = _FakeScopedMemoryService()
    registry = ToolRegistry()

    monkeypatch.setattr(
        "src.app.tools.registry.get_scoped_memory_service",
        lambda: service,
    )

    snapshot = await registry.inspect_memory(
        scope="user",
        subject_id="user-1",
        namespace="profile",
        limit=10,
    )

    assert snapshot["total_entries"] == 1
    assert snapshot["items"][0]["scope"] == "user"
    assert service.search_calls[0]["scope_id"] == "user-1"


@pytest.mark.asyncio
async def test_session_scope_keeps_backwards_compatible_store() -> None:
    registry = ToolRegistry()
    _MEMORY_STORE.clear()

    saved = await registry.memory(
        action="put",
        scope="session",
        namespace="follow_up",
        key="conv-1",
        value={"summary": "Hello"},
        metadata={"source": "test"},
    )
    searched = await registry.memory(
        action="search",
        scope="session",
        namespace="follow_up",
        query="hello",
    )

    assert saved["scope"] == "session"
    assert searched["items"][0]["key"] == "conv-1"


def test_memory_tool_schema_exposes_v2_scopes() -> None:
    tool = create_memory_tool()

    assert tool.description == "Store or retrieve scoped runtime memory"
    assert tool.input_schema["properties"]["scope"]["enum"] == [
        "session",
        "user",
        "tenant",
    ]
    assert "propose" in tool.input_schema["properties"]["action"]["enum"]
