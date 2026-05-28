from __future__ import annotations

from datetime import datetime, timezone
import importlib

import pytest


class _FakeUpdateResult:
    modified_count = 1
    upserted_id = "generated-id"


class _FakeDeleteResult:
    deleted_count = 1


class _FakeCollection:
    def __init__(self) -> None:
        self.update_one_calls: list[tuple[object, ...]] = []
        self.delete_many_calls: list[object] = []

    async def update_one(self, filters, update, upsert: bool = False) -> _FakeUpdateResult:
        self.update_one_calls.append((filters, update, upsert))
        return _FakeUpdateResult()

    async def delete_many(self, filters) -> _FakeDeleteResult:
        self.delete_many_calls.append(filters)
        return _FakeDeleteResult()


class _FakeDb:
    def __init__(self) -> None:
        self.channels = _FakeCollection()
        self.agent_runtime_overrides = _FakeCollection()


class _FakeMemory:
    def __init__(self, fake_db: _FakeDb) -> None:
        self.db = fake_db

    async def initialize(self) -> None:
        return None


def _load_runtime_config_repository_class():
    import importlib
    import sys
    import types

    if "src.app" not in sys.modules:
        app_pkg = types.ModuleType("src.app")
        memory_pkg = types.ModuleType("src.app.memory")
        ports_mod = types.ModuleType("src.app.memory.ports")

        class IMemoryDatabaseProvider:
            async def initialize(self) -> None:
                return None

            @property
            def db(self) -> object:
                raise NotImplementedError

        ports_mod.IMemoryDatabaseProvider = IMemoryDatabaseProvider
        memory_pkg.ports = ports_mod
        app_pkg.memory = memory_pkg
        sys.modules["src.app"] = app_pkg
        sys.modules["src.app.memory"] = memory_pkg
        sys.modules["src.app.memory.ports"] = ports_mod

    module = importlib.import_module("src.utils.utils.runtime_config")
    return module.RuntimeConfigRepository


@pytest.mark.asyncio
async def test_sync_channels_file_serializes_datetime_values() -> None:
    repository_class = _load_runtime_config_repository_class()
    fake_db = _FakeDb()
    repository = repository_class(memory=_FakeMemory(fake_db))
    expected_timestamp = datetime(
        2026,
        3,
        25,
        3,
        11,
        47,
        tzinfo=timezone.utc,
    ).isoformat()

    await repository._sync_runtime_collection_for_file(  # noqa: SLF001
        "channels.yaml",
        """
channels:
  - channel: whatsapp
    agentId: recovery-agent
    displayName: WhatsApp
    enabled: false
    lastHeartbeatAt: 2026-03-25T03:11:47Z
    metadata:
      syncedAt: 2026-03-25T03:11:47Z
""",
    )

    assert len(fake_db.channels.delete_many_calls) == 1
    assert fake_db.channels.delete_many_calls[0] == {}

    assert len(fake_db.channels.update_one_calls) == 1
    _filters, update, upsert = fake_db.channels.update_one_calls[0]
    persisted_config = update["$set"]["config"]

    assert upsert is True
    assert isinstance(persisted_config, dict)
    assert persisted_config["lastHeartbeatAt"] == expected_timestamp
    assert persisted_config["metadata"] == {"syncedAt": expected_timestamp}
