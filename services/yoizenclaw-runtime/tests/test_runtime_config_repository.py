from __future__ import annotations

from datetime import datetime, timezone
import importlib
import sys
import types

import pytest


class _FakeConnection:
    def __init__(self) -> None:
        self.executed_statements: list[tuple[str, tuple[object, ...]]] = []

    async def execute(self, statement: str, *args: object) -> None:
        self.executed_statements.append((statement, args))


def _load_runtime_config_repository_class():
    fake_asyncpg = types.ModuleType("asyncpg")
    fake_asyncpg.Connection = object

    original_asyncpg = sys.modules.get("asyncpg")
    sys.modules["asyncpg"] = fake_asyncpg

    try:
        module = importlib.import_module("src.shared.utils.runtime_config")
        return module.RuntimeConfigRepository
    finally:
        if original_asyncpg is None:
            sys.modules.pop("asyncpg", None)
        else:
            sys.modules["asyncpg"] = original_asyncpg


@pytest.mark.asyncio
async def test_sync_channels_file_serializes_datetime_values() -> None:
    repository_class = _load_runtime_config_repository_class()
    repository = repository_class(memory=object())
    fake_connection = _FakeConnection()
    expected_timestamp = datetime(
        2026,
        3,
        25,
        3,
        11,
        47,
        tzinfo=timezone.utc,
    ).isoformat()

    await repository._sync_runtime_table_for_file(  # noqa: SLF001
        fake_connection,
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

    assert len(fake_connection.executed_statements) == 2
    assert fake_connection.executed_statements[0] == ("DELETE FROM channels", ())

    insert_statement, insert_args = fake_connection.executed_statements[1]
    persisted_config = insert_args[4]

    assert "INSERT INTO channels" in insert_statement
    assert isinstance(persisted_config, dict)
    assert persisted_config["lastHeartbeatAt"] == expected_timestamp
    assert persisted_config["metadata"] == {"syncedAt": expected_timestamp}
