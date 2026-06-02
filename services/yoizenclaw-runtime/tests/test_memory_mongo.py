from __future__ import annotations

from datetime import datetime
import importlib
import sys
import types
from pathlib import Path
from typing import Any

import pytest


def _load_entities_module():
    services_path = Path(__file__).resolve().parents[1] / "src/services"
    fake_services = types.ModuleType("src.services")
    fake_services.__path__ = [str(services_path)]
    sys.modules["src.services"] = fake_services
    return importlib.import_module("src.services.domain.entities")


_entities = _load_entities_module()
JobDefinition = _entities.JobDefinition
JobExecution = _entities.JobExecution
RetryPolicy = _entities.RetryPolicy


TENANT_ID = "test-tenant"


def _reset_bootstrap_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    from src.shared.config.settings import bootstrap_settings

    monkeypatch.setattr(bootstrap_settings, "_settings", None)


class _FakeUpdateResult:
    modified_count = 1
    deleted_count = 1
    upserted_id = None


class _FakeInsertResult:
    inserted_id = "generated-id"


class _FakeCursor:
    def __init__(self, documents: list[dict[str, Any]]) -> None:
        self._documents = documents

    def sort(self, *_args: object, **_kwargs: object) -> _FakeCursor:
        return self

    def skip(self, *_args: object) -> _FakeCursor:
        return self

    def limit(self, *_args: object) -> _FakeCursor:
        return self

    def __aiter__(self):
        self._index = 0
        return self

    async def __anext__(self) -> dict[str, Any]:
        if self._index >= len(self._documents):
            raise StopAsyncIteration
        document = self._documents[self._index]
        self._index += 1
        return document


class _FakeCollection:
    def __init__(self) -> None:
        self.update_one_calls: list[tuple[dict[str, Any], dict[str, Any], bool]] = []
        self.find_one_calls: list[tuple[dict[str, Any], dict[str, Any] | None]] = []
        self.find_calls: list[dict[str, Any]] = []
        self.count_calls: list[dict[str, Any]] = []
        self.find_one_result: dict[str, Any] | None = None
        self.find_results: list[dict[str, Any]] = []
        self.count_result = 0

    async def update_one(
        self,
        filters: dict[str, Any],
        update: dict[str, Any],
        upsert: bool = False,
    ) -> _FakeUpdateResult:
        self.update_one_calls.append((filters, update, upsert))
        return _FakeUpdateResult()

    async def find_one(
        self,
        filters: dict[str, Any],
        sort: list[tuple[str, int]] | None = None,
    ) -> dict[str, Any] | None:
        self.find_one_calls.append((filters, sort))
        return self.find_one_result

    def find(self, filters: dict[str, Any]) -> _FakeCursor:
        self.find_calls.append(filters)
        return _FakeCursor(self.find_results)

    async def count_documents(self, filters: dict[str, Any]) -> int:
        self.count_calls.append(filters)
        return self.count_result


class _FakeDb:
    def __init__(self) -> None:
        self.runtime_jobs = _FakeCollection()
        self.runtime_job_executions = _FakeCollection()


def _build_job_definition() -> JobDefinition:
    return JobDefinition(
        id="job-1",
        name="Sample Job",
        description="Sample",
        enabled=True,
        schedule_type="manual",
        schedule_config={},
        action_type="webhook",
        action_config={"url": "https://example.com"},
        retry_policy=RetryPolicy(
            max_retries=2,
            delay_seconds=10,
            backoff="linear",
        ),
        timeout_seconds=60,
        tags=["example"],
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 2),
    )


def _build_job_execution() -> JobExecution:
    return JobExecution(
        id="execution-1",
        job_id="job-1",
        status="pending",
        triggered_by="manual",
        event_payload={"source": "test"},
        logs=["created"],
        retry_count=0,
    )


def _make_memory(fake_db: _FakeDb) -> object:
    memory = importlib.import_module("src.infra.database.memory_mongo").Memory(
        "mongodb://example",
    )
    memory._initialized = True  # noqa: SLF001
    memory._db = fake_db  # noqa: SLF001
    return memory


def test_memory_uses_mongo_uri_when_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MONGO_URI", "mongodb://example")

    memory = importlib.import_module("src.infra.database.memory_mongo").Memory()

    assert memory.mongo_uri == "mongodb://example"


@pytest.mark.asyncio
async def test_save_job_passes_tenant_id_in_update(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_db = _FakeDb()
    memory = _make_memory(fake_db)

    await memory.save_job(_build_job_definition())

    filters, update, upsert = fake_db.runtime_jobs.update_one_calls[-1]

    assert filters == {"id": "job-1", "tenant_id": TENANT_ID}
    assert upsert is True
    assert update["$set"]["tenant_id"] == TENANT_ID
    assert update["$set"]["name"] == "Sample Job"
    assert update["$set"]["schedule_config"] == {}
    assert update["$set"]["action_config"] == {"url": "https://example.com"}
    assert update["$set"]["retry_policy"] == {
        "max_retries": 2,
        "delay_seconds": 10,
        "backoff": "linear",
    }
    assert update["$set"]["tags"] == ["example"]


@pytest.mark.asyncio
async def test_save_job_execution_passes_tenant_id_in_update(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_db = _FakeDb()
    memory = _make_memory(fake_db)

    await memory.save_job_execution(_build_job_execution())

    filters, update, upsert = fake_db.runtime_job_executions.update_one_calls[-1]

    assert filters == {"id": "execution-1", "tenant_id": TENANT_ID}
    assert upsert is True
    assert update["$set"]["tenant_id"] == TENANT_ID
    assert update["$set"]["job_id"] == "job-1"
    assert update["$set"]["event_payload"] == {"source": "test"}
    assert update["$set"]["result"] is None
    assert update["$set"]["logs"] == ["created"]


@pytest.mark.asyncio
async def test_get_recent_job_executions_filters_by_tenant_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_db = _FakeDb()
    fake_db.runtime_job_executions.find_results = [
        {
            "id": "execution-1",
            "job_id": "job-1",
            "status": "success",
            "triggered_by": "manual",
            "event_payload": '{"source": "test"}',
            "started_at": "2026-03-23T17:40:00",
            "finished_at": "2026-03-23T17:40:01",
            "result": '{"ok": true}',
            "error_message": None,
            "logs": '["created"]',
            "retry_count": 0,
        },
        {
            "id": "execution-2",
            "job_id": "job-1",
            "status": "failed",
            "triggered_by": "manual",
            "event_payload": "not-json",
            "started_at": "not-a-date",
            "finished_at": "",
            "result": "not-json",
            "error_message": "boom",
            "logs": "not-json",
            "retry_count": 1,
        },
    ]
    fake_db.runtime_job_executions.count_result = 2
    memory = _make_memory(fake_db)

    executions, total = await memory.get_recent_job_executions(
        limit=25,
        job_id="job-1",
        status="success",
    )

    assert fake_db.runtime_job_executions.count_calls[-1] == {
        "tenant_id": TENANT_ID,
        "job_id": "job-1",
        "status": "success",
    }
    assert fake_db.runtime_job_executions.find_calls[-1] == {
        "tenant_id": TENANT_ID,
        "job_id": "job-1",
        "status": "success",
    }
    assert total == 2
    assert len(executions) == 2
    assert executions[0].event_payload == {"source": "test"}
    assert executions[0].result == {"ok": True}
    assert executions[0].logs == ["created"]
    assert executions[1].event_payload is None
    assert executions[1].result is None
    assert executions[1].logs == []
    assert executions[1].started_at is None
    assert executions[1].finished_at is None


@pytest.mark.asyncio
async def test_get_job_filters_by_tenant_id_and_job_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_db = _FakeDb()
    fake_db.runtime_jobs.find_one_result = {
        "id": "job-1",
        "name": "Sample Job",
        "description": "Sample",
        "enabled": True,
        "schedule_type": "manual",
        "schedule_config": {},
        "action_type": "webhook",
        "action_config": {"url": "https://example.com"},
        "retry_policy": '{"max_retries": 2, "delay_seconds": 10, "backoff": "linear"}',
        "timeout_seconds": 60,
        "tags": ["example"],
        "created_at": datetime(2026, 1, 1),
        "updated_at": datetime(2026, 1, 2),
    }
    memory = _make_memory(fake_db)

    result = await memory.get_job("job-1")

    filters, _sort = fake_db.runtime_jobs.find_one_calls[-1]
    assert filters == {
        "id": "job-1",
        "tenant_id": TENANT_ID,
        "deleted_at": None,
    }
    assert result is not None
    assert result.id == "job-1"


@pytest.mark.asyncio
async def test_get_job_returns_none_for_wrong_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", "other-tenant")
    _reset_bootstrap_settings(monkeypatch)

    fake_db = _FakeDb()
    fake_db.runtime_jobs.find_one_result = None
    memory = _make_memory(fake_db)

    result = await memory.get_job("job-1")

    filters, _sort = fake_db.runtime_jobs.find_one_calls[-1]
    assert filters["tenant_id"] == "other-tenant"
    assert result is None


@pytest.mark.asyncio
async def test_get_all_jobs_filters_by_tenant_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_db = _FakeDb()
    memory = _make_memory(fake_db)

    await memory.get_all_jobs()

    assert fake_db.runtime_jobs.find_calls[-1] == {
        "tenant_id": TENANT_ID,
        "deleted_at": None,
    }


@pytest.mark.asyncio
async def test_delete_job_filters_by_tenant_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_db = _FakeDb()
    memory = _make_memory(fake_db)

    await memory.delete_job("job-1")

    filters, _update, _upsert = fake_db.runtime_jobs.update_one_calls[-1]
    assert filters == {
        "id": "job-1",
        "tenant_id": TENANT_ID,
        "deleted_at": None,
    }


@pytest.mark.asyncio
async def test_get_job_executions_filters_by_tenant_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_db = _FakeDb()
    memory = _make_memory(fake_db)

    await memory.get_job_executions("job-1", limit=10, offset=0)

    assert fake_db.runtime_job_executions.count_calls[-1] == {
        "job_id": "job-1",
        "tenant_id": TENANT_ID,
    }


@pytest.mark.asyncio
async def test_tenant_id_reads_from_env_var(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", "env-tenant-123")
    _reset_bootstrap_settings(monkeypatch)

    from src.shared.config.settings import bootstrap_settings

    assert bootstrap_settings.TENANT_ID == "env-tenant-123"


@pytest.mark.asyncio
async def test_tenant_id_defaults_to_empty_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TENANT_ID", raising=False)

    from src.shared.config.settings import BootstrapSettings

    settings = BootstrapSettings()
    assert settings.TENANT_ID == ""
