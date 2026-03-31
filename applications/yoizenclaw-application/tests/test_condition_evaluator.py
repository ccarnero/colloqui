"""Tests for the AST-sandboxed condition evaluator."""

from __future__ import annotations

import pytest

from src.application.agents.condition_evaluator import ConditionEvaluator


class TestConditionEvaluatorComparisons:
    """Test suite for simple comparison expressions."""

    def setup_method(self) -> None:
        self.evaluator = ConditionEvaluator()

    def test_equality(self) -> None:
        state = {"status": "active"}
        assert self.evaluator.should_run_step("status == 'active'", state) is True

    def test_inequality(self) -> None:
        state = {"status": "pending"}
        assert self.evaluator.should_run_step("status != 'done'", state) is True

    def test_equality_false(self) -> None:
        state = {"status": "inactive"}
        assert self.evaluator.should_run_step("status == 'active'", state) is False

    def test_is_operator(self) -> None:
        state = {"value": None}
        assert self.evaluator.should_run_step("value is None", state) is True

    def test_is_not_operator(self) -> None:
        state = {"value": "present"}
        assert self.evaluator.should_run_step("value is not None", state) is True


class TestConditionEvaluatorBooleanOps:
    """Test suite for boolean operations."""

    def setup_method(self) -> None:
        self.evaluator = ConditionEvaluator()

    def test_and_both_true(self) -> None:
        state = {"a": "yes", "b": "yes"}
        assert self.evaluator.should_run_step("a == 'yes' and b == 'yes'", state) is True

    def test_and_one_false(self) -> None:
        state = {"a": "yes", "b": "no"}
        assert self.evaluator.should_run_step("a == 'yes' and b == 'yes'", state) is False

    def test_or_both_false(self) -> None:
        state = {"a": "no", "b": "no"}
        assert self.evaluator.should_run_step("a == 'yes' or b == 'yes'", state) is False

    def test_or_one_true(self) -> None:
        state = {"a": "yes", "b": "no"}
        assert self.evaluator.should_run_step("a == 'yes' or b == 'yes'", state) is True

    def test_dsl_and_keyword(self) -> None:
        state = {"a": "yes", "b": "yes"}
        assert self.evaluator.should_run_step("a == 'yes' AND b == 'yes'", state) is True

    def test_dsl_or_keyword(self) -> None:
        state = {"a": "no", "b": "yes"}
        assert self.evaluator.should_run_step("a == 'yes' OR b == 'yes'", state) is True

    def test_not_operator(self) -> None:
        state = {"flag": True}
        assert self.evaluator.should_run_step("not flag", state) is False


class TestConditionEvaluatorSafety:
    """Test suite for dangerous code rejection."""

    def setup_method(self) -> None:
        self.evaluator = ConditionEvaluator()

    def test_import_rejected(self) -> None:
        assert self.evaluator.should_run_step("import os", {}) is False

    def test_exec_rejected(self) -> None:
        assert self.evaluator.should_run_step("exec('print(1)')", {}) is False

    def test_eval_rejected(self) -> None:
        assert self.evaluator.should_run_step("eval('1+1')", {}) is False

    def test_os_system_rejected(self) -> None:
        assert (
            self.evaluator.should_run_step("os.system('ls')", {"os": __import__("os")})
            is False
        )

    def test_subprocess_rejected(self) -> None:
        assert self.evaluator.should_run_step("subprocess.run(['rm'])", {}) is False

    def test_dunder_attribute_allowed(self) -> None:
        assert self.evaluator.should_run_step("x.__class__", {"x": 1}) is True


class TestConditionEvaluatorHelpers:
    """Test suite for built-in helper functions."""

    def setup_method(self) -> None:
        self.evaluator = ConditionEvaluator()

    def test_contains_helper(self) -> None:
        state = {"text": "hello world"}
        assert self.evaluator.should_run_step('contains(text, "world")', state) is True

    def test_contains_helper_false(self) -> None:
        state = {"text": "hello"}
        assert self.evaluator.should_run_step('contains(text, "world")', state) is False

    def test_regex_helper(self) -> None:
        state = {"email": "user@example.com"}
        assert self.evaluator.should_run_step('regex(".*@.*", email)', state) is True

    def test_exists_helper(self) -> None:
        state = {"value": "something"}
        assert self.evaluator.should_run_step("exists(value)", state) is True

    def test_exists_helper_none(self) -> None:
        state = {"value": None}
        assert self.evaluator.should_run_step("exists(value)", state) is False

    def test_exists_helper_empty_string(self) -> None:
        state = {"value": ""}
        assert self.evaluator.should_run_step("exists(value)", state) is False

    def test_unknown_helper_rejected(self) -> None:
        state = {"x": 1}
        assert self.evaluator.should_run_step("dangerous(x)", state) is False


class TestConditionEvaluatorEdgeCases:
    """Test suite for edge cases."""

    def setup_method(self) -> None:
        self.evaluator = ConditionEvaluator()

    def test_none_condition_runs(self) -> None:
        assert self.evaluator.should_run_step(None, {}) is True

    def test_empty_string_condition_runs(self) -> None:
        assert self.evaluator.should_run_step("", {}) is True

    def test_whitespace_condition_runs(self) -> None:
        assert self.evaluator.should_run_step("   ", {}) is True

    def test_boolean_true_condition(self) -> None:
        assert self.evaluator.should_run_step(True, {}) is True

    def test_boolean_false_condition(self) -> None:
        assert self.evaluator.should_run_step(False, {}) is False

    def test_dsl_true_keyword(self) -> None:
        state = {"flag": True}
        assert self.evaluator.should_run_step("flag == true", state) is True

    def test_dsl_false_keyword(self) -> None:
        state = {"flag": False}
        assert self.evaluator.should_run_step("flag == false", state) is True

    def test_dsl_null_keyword(self) -> None:
        state = {"value": None}
        assert self.evaluator.should_run_step("value is null", state) is True

    def test_attribute_access_dict(self) -> None:
        state = {"user": {"role": "admin"}}
        assert self.evaluator.should_run_step("user.role == 'admin'", state) is True

    def test_missing_variable_returns_none(self) -> None:
        state: dict = {}
        assert self.evaluator.should_run_step("missing_var == 'x'", state) is False

    def test_nested_boolean_with_helpers(self) -> None:
        state = {"text": "hello world", "flag": True}
        assert (
            self.evaluator.should_run_step(
                'contains(text, "hello") and flag', state
            )
            is True
        )
