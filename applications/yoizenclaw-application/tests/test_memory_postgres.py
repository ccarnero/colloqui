from __future__ import annotations

from datetime import datetime
import importlib
import sys
import types

import pytest
from src.jobs.models import JobDefinition, JobExecution, RetryPolicy


TENANT_ID = "test-tenant"


def _reset_bootstrap_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Reset the cached bootstrap_settings proxy so env changes take effect."""
    from src.shared.config.settings import bootstrap_settings

    monkeypatch.setattr(bootstrap_settings, "_settings", None)


class _FakeConnection:
    def __init__(self) -> None:
        self.executed_statements: list[tuple[str, tuple[object, ...]]] = []
        self.fetch_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetchval_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetchrow_calls: list[tuple[str, tuple[object, ...]]] = []
        self.fetch_results: list[list[object]] = []
        self.fetchval_results: list[object] = []
        self.fetchrow_result: object | None = None
        self._execute_result: str = "UPDATE 1"

    async def execute(self, statement: str, *args: object) -> str:
        self.executed_statements.append((statement, args))
        return self._execute_result

    async def fetch(self, statement: str, *args: object) -> list[object]:
        self.fetch_calls.append((statement, args))
        if self.fetch_results:
            return self.fetch_results.pop(0)
        return []

    async def fetchval(self, statement: str, *args: object) -> object | None:
        self.fetchval_calls.append((statement, args))
        if self.fetchval_results:
            return self.fetchval_results.pop(0)
        return 0

    async def fetchrow(self, statement: str, *args: object) -> object | None:
        self.fetchrow_calls.append((statement, args))
        return self.fetchrow_result


class _FakePoolAcquire:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    async def __aenter__(self) -> _FakeConnection:
        return self._connection

    async def __aexit__(self, exc_type, exc, tb) -> None:
        return None


class _FakePool:
    def __init__(self, connection: _FakeConnection) -> None:
        self._connection = connection

    def acquire(self) -> _FakePoolAcquire:
        return _FakePoolAcquire(self._connection)


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


def _make_memory(
    fake_connection: _FakeConnection,
) -> object:
    memory = importlib.import_module("src.core.memory_postgres").Memory(
        "postgresql://example"
    )
    memory._initialized = True  # noqa: SLF001
    memory._pool = _FakePool(fake_connection)  # noqa: SLF001
    return memory


def test_memory_uses_database_url_when_present(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://example")

    memory = importlib.import_module("src.core.memory_postgres").Memory()

    assert memory.connection_string == "postgresql://example"


@pytest.mark.asyncio
async def test_runtime_state_schema_adds_channels_config_column() -> None:
    fake_asyncpg = types.ModuleType("asyncpg")

    async def _create_pool(*args, **kwargs):
        raise AssertionError("create_pool should not be called in this test")

    fake_asyncpg.create_pool = _create_pool
    fake_asyncpg.Connection = object
    monkeypatched_modules = {
        "asyncpg": fake_asyncpg,
    }

    original_modules = {
        name: sys.modules.get(name)
        for name in monkeypatched_modules
    }

    for name, module in monkeypatched_modules.items():
        sys.modules[name] = module

    try:
        memory_module = importlib.import_module("src.core.memory_postgres")
        memory = memory_module.Memory("postgresql://example")
    finally:
        for name, module in original_modules.items():
            if module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = module

    fake_connection = _FakeConnection()

    await memory._initialize_runtime_state_schema(fake_connection)  # noqa: SLF001

    assert any(
        "ALTER TABLE channels" in statement
        and "ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb"
        in statement
        for statement, _args in fake_connection.executed_statements
    )


@pytest.mark.asyncio
async def test_save_job_passes_tenant_id_in_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    memory = _make_memory(fake_connection)

    await memory.save_job(_build_job_definition())

    insert_statement, insert_args = fake_connection.executed_statements[-1]

    assert "INSERT INTO jobs" in insert_statement
    assert len(insert_args) == 14
    assert insert_args[0] == "job-1"
    assert insert_args[1] == TENANT_ID
    assert insert_args[2] == "Sample Job"
    assert insert_args[6] == {}
    assert insert_args[8] == {"url": "https://example.com"}
    assert insert_args[9] == {
        "max_retries": 2,
        "delay_seconds": 10,
        "backoff": "linear",
    }
    assert insert_args[11] == ["example"]


@pytest.mark.asyncio
async def test_save_job_execution_passes_tenant_id_in_insert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    memory = _make_memory(fake_connection)

    await memory.save_job_execution(_build_job_execution())

    insert_statement, insert_args = fake_connection.executed_statements[-1]

    assert "INSERT INTO job_executions" in insert_statement
    assert len(insert_args) == 12
    assert insert_args[0] == "execution-1"
    assert insert_args[1] == TENANT_ID
    assert insert_args[2] == "job-1"
    assert insert_args[5] == {"source": "test"}
    assert insert_args[8] is None
    assert insert_args[10] == ["created"]


@pytest.mark.asyncio
async def test_get_recent_job_executions_parses_json_arguments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    fake_connection.fetch_results.append(
        [
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
    )
    fake_connection.fetchval_results.append(2)
    memory = _make_memory(fake_connection)

    executions, total = await memory.get_recent_job_executions(
        limit=25,
        job_id="job-1",
        status="success",
    )

    fetch_statement, fetch_args = fake_connection.fetch_calls[-1]

    assert "SELECT * FROM job_executions" in fetch_statement
    assert "tenant_id" in fetch_statement
    assert fetch_args[0] == TENANT_ID
    assert fetch_args[1] == "job-1"
    assert fetch_args[2] == "success"
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

    fake_connection = _FakeConnection()
    fake_connection.fetchrow_result = {
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
    memory = _make_memory(fake_connection)

    result = await memory.get_job("job-1")

    fetchrow_statement, fetchrow_args = fake_connection.fetchrow_calls[-1]
    assert "tenant_id" in fetchrow_statement
    assert fetchrow_args[0] == "job-1"
    assert fetchrow_args[1] == TENANT_ID
    assert result is not None
    assert result.id == "job-1"


@pytest.mark.asyncio
async def test_get_job_returns_none_for_wrong_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", "other-tenant")
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    fake_connection.fetchrow_result = None
    memory = _make_memory(fake_connection)

    result = await memory.get_job("job-1")

    fetchrow_statement, fetchrow_args = fake_connection.fetchrow_calls[-1]
    assert "tenant_id" in fetchrow_statement
    assert fetchrow_args[1] == "other-tenant"
    assert result is None


@pytest.mark.asyncio
async def test_get_all_jobs_filters_by_tenant_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    fake_connection.fetch_results.append([])
    memory = _make_memory(fake_connection)

    await memory.get_all_jobs()

    fetch_statement, fetch_args = fake_connection.fetch_calls[-1]
    assert "tenant_id" in fetch_statement
    assert fetch_args[0] == TENANT_ID


@pytest.mark.asyncio
async def test_get_all_jobs_only_returns_jobs_for_tenant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", "acme-corp")
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    fake_connection.fetch_results.append(
        [
            {
                "id": "job-acme-1",
                "name": "Acme Job",
                "description": None,
                "enabled": True,
                "schedule_type": "manual",
                "schedule_config": {},
                "action_type": "webhook",
                "action_config": {},
                "retry_policy": '{"max_retries": 3, "delay_seconds": 60, "backoff": "exponential"}',
                "timeout_seconds": 60,
                "tags": [],
                "created_at": datetime(2026, 1, 1),
                "updated_at": datetime(2026, 1, 2),
            },
        ]
    )
    memory = _make_memory(fake_connection)

    jobs = await memory.get_all_jobs()

    fetch_statement, fetch_args = fake_connection.fetch_calls[-1]
    assert "tenant_id" in fetch_statement
    assert fetch_args[0] == "acme-corp"
    assert len(jobs) == 1
    assert jobs[0].id == "job-acme-1"


@pytest.mark.asyncio
async def test_delete_job_filters_by_tenant_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    memory = _make_memory(fake_connection)

    await memory.delete_job("job-1")

    execute_statement, execute_args = fake_connection.executed_statements[-1]
    assert "tenant_id" in execute_statement
    assert execute_args[0] == "job-1"
    assert execute_args[1] == TENANT_ID


@pytest.mark.asyncio
async def test_delete_job_hard_delete_includes_tenant_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    memory = _make_memory(fake_connection)

    await memory.delete_job("job-1", hard_delete=True)

    execute_statement, execute_args = fake_connection.executed_statements[-1]
    assert "DELETE FROM jobs" in execute_statement
    assert "tenant_id" in execute_statement
    assert execute_args[0] == "job-1"
    assert execute_args[1] == TENANT_ID


@pytest.mark.asyncio
async def test_get_job_executions_filters_by_tenant_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", TENANT_ID)
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    fake_connection.fetch_results.append([])
    fake_connection.fetchval_results.append(0)
    memory = _make_memory(fake_connection)

    await memory.get_job_executions("job-1", limit=10, offset=0)

    count_statement, count_args = fake_connection.fetchval_calls[-1]
    assert "tenant_id" in count_statement
    assert count_args[0] == "job-1"
    assert count_args[1] == TENANT_ID


@pytest.mark.asyncio
async def test_save_job_execution_includes_tenant_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TENANT_ID", "acme-corp")
    _reset_bootstrap_settings(monkeypatch)

    fake_connection = _FakeConnection()
    memory = _make_memory(fake_connection)

    await memory.save_job_execution(_build_job_execution())

    insert_statement, insert_args = fake_connection.executed_statements[-1]
    assert "INSERT INTO job_executions" in insert_statement
    assert insert_args[1] == "acme-corp"


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
