"""Tests for the job executor engine."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from src.jobs.domain.entities import JobDefinition, JobExecution
from src.jobs.executor import JobExecutor


def _make_job(
    action_type: str = "function",
    action_config: dict | None = None,
) -> JobDefinition:
    return JobDefinition(
        name="Test Job",
        schedule_type="manual",
        schedule_config={},
        action_type=action_type,  # type: ignore[arg-type]
        action_config=action_config or {},
    )


def _make_execution() -> JobExecution:
    return JobExecution(job_id="job-1")


class TestIsSafeCode:
    """Test suite for the is_safe_code function."""

    def test_safe_code(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("result = 1 + 2") is True

    def test_safe_list_comprehension(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("result = [x * 2 for x in range(10)]") is True

    def test_unsafe_import(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("import os") is False

    def test_unsafe_import_from(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("from os import system") is False

    def test_unsafe_eval(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("eval('1+1')") is False

    def test_unsafe_exec(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("exec('print(1)')") is False

    def test_unsafe_os_system(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("os.system('ls')") is False

    def test_unsafe_subprocess(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("subprocess.run(['ls'])") is False

    def test_unsafe_open(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("open('/etc/passwd')") is False

    def test_syntax_error_returns_false(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("def [") is False

    def test_empty_code_is_safe(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("") is True

    def test_safe_json_usage(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("result = json.dumps({'a': 1})") is True

    def test_unsafe_breakpoint(self) -> None:
        from src.jobs.actions.python_action import is_safe_code
        assert is_safe_code("breakpoint()") is False


class TestIsValidWebhookUrl:
    """Test suite for the is_valid_webhook_url function."""

    def test_valid_https(self) -> None:
        from src.jobs.actions.webhook_action import is_valid_webhook_url
        assert is_valid_webhook_url("https://example.com/hook") is True

    def test_valid_http(self) -> None:
        from src.jobs.actions.webhook_action import is_valid_webhook_url
        assert is_valid_webhook_url("http://localhost:3000/api") is True

    def test_invalid_ftp(self) -> None:
        from src.jobs.actions.webhook_action import is_valid_webhook_url
        assert is_valid_webhook_url("ftp://example.com/file") is False

    def test_empty_string(self) -> None:
        from src.jobs.actions.webhook_action import is_valid_webhook_url
        assert is_valid_webhook_url("") is False

    def test_no_scheme(self) -> None:
        from src.jobs.actions.webhook_action import is_valid_webhook_url
        assert is_valid_webhook_url("example.com/hook") is False

    def test_javascript_scheme(self) -> None:
        from src.jobs.actions.webhook_action import is_valid_webhook_url
        assert is_valid_webhook_url("javascript:alert(1)") is False


class TestRegisterFunction:
    """Test suite for function registration."""

    def test_register_function(self) -> None:
        executor = JobExecutor()
        mock_func = MagicMock()
        executor.register_function("custom_fn", mock_func)
        assert "custom_fn" in executor._functions

    def test_unregister_function_exists(self) -> None:
        executor = JobExecutor()
        mock_func = MagicMock()
        executor.register_function("temp_fn", mock_func)
        assert executor.unregister_function("temp_fn") is True
        assert "temp_fn" not in executor._functions

    def test_unregister_function_not_found(self) -> None:
        executor = JobExecutor()
        assert executor.unregister_function("nonexistent") is False
