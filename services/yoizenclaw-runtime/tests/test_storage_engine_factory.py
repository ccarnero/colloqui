"""Unit tests for storage engine factory selection."""

from __future__ import annotations

import pytest

from src.infra.database import create_memory_store
from src.services.scheduler_leader import create_leader_election
from src.utils.config.settings import bootstrap_settings


def _reset_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bootstrap_settings, "_settings", None)


def test_create_memory_store_selects_mongo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _reset_settings(monkeypatch)
    monkeypatch.setenv("DB_ENGINE", "mongo")

    store = create_memory_store()

    assert type(store).__name__ == "MemoryMongoStore"


def test_default_db_engine_is_postgres(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _reset_settings(monkeypatch)
    monkeypatch.delenv("DB_ENGINE", raising=False)
    monkeypatch.delenv("STORAGE_ENGINE", raising=False)

    from src.utils.config.settings import BootstrapSettings

    assert BootstrapSettings().DB_ENGINE == "postgres"


def test_create_leader_election_mongo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _reset_settings(monkeypatch)

    class _FakeDb:
        def __getitem__(self, name: str) -> object:
            return object()

    class _FakeMongoStore:
        db = _FakeDb()

    leader = create_leader_election(_FakeMongoStore(), "mongo")

    assert type(leader).__name__ == "MongoTtlLeader"
