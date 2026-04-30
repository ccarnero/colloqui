"""Tests for the pipeline execution engine."""

import pytest

from src.jobs.pipeline import (
    PipelineContext,
    execute_pipeline,
    render_template,
    render_value,
    _is_truthy,
    _resolve_path,
)


class TestTemplateRendering:
    """Test suite for template rendering helpers."""

    def test_render_simple_variable(self):
        """Test rendering a simple variable."""
        result = render_template("Hello {{name}}", {"name": "World"})
        assert result == "Hello World"

    def test_render_nested_variable(self):
        """Test rendering a dotted path variable."""
        ctx = {"user": {"name": "Alice"}}
        result = render_template("Hi {{user.name}}", ctx)
        assert result == "Hi Alice"

    def test_render_missing_variable_leaves_placeholder(self):
        """Test that missing variables keep the placeholder."""
        result = render_template("Hello {{missing}}", {})
        assert result == "Hello {{missing}}"

    def test_render_value_preserves_non_string_types(self):
        """Test that a single-placeholder string resolves to original type."""
        ctx = {"items": [1, 2, 3]}
        result = render_value("{{items}}", ctx)
        assert result == [1, 2, 3]

    def test_render_value_dict(self):
        """Test recursive rendering inside dicts."""
        ctx = {"name": "Alice"}
        result = render_value({"greeting": "Hi {{name}}"}, ctx)
        assert result == {"greeting": "Hi Alice"}

    def test_render_value_list(self):
        """Test recursive rendering inside lists."""
        ctx = {"x": "A"}
        result = render_value(["{{x}}", "B"], ctx)
        assert result == ["A", "B"]


class TestResolvePath:
    """Test suite for dotted path resolution."""

    def test_simple_key(self):
        assert _resolve_path("name", {"name": "Bob"}) == "Bob"

    def test_nested_key(self):
        assert _resolve_path("a.b.c", {"a": {"b": {"c": 42}}}) == 42

    def test_missing_key_returns_none(self):
        assert _resolve_path("a.b", {"a": {}}) is None


class TestIsTruthy:
    """Test suite for truthy evaluation."""

    def test_empty_string_is_falsy(self):
        assert _is_truthy("") is False

    def test_false_string_is_falsy(self):
        assert _is_truthy("false") is False

    def test_zero_string_is_falsy(self):
        assert _is_truthy("0") is False

    def test_none_string_is_falsy(self):
        assert _is_truthy("none") is False

    def test_nonempty_string_is_truthy(self):
        assert _is_truthy("yes") is True

    def test_true_string_is_truthy(self):
        assert _is_truthy("true") is True


class TestPipelineContext:
    """Test suite for PipelineContext."""

    def test_set_and_get(self):
        ctx = PipelineContext()
        ctx.set("key", "value")
        assert ctx.get("key") == "value"

    def test_get_default(self):
        ctx = PipelineContext()
        assert ctx.get("missing", "default") == "default"

    def test_initial_data(self):
        ctx = PipelineContext({"seed": 42})
        assert ctx.get("seed") == 42

    def test_add_log(self):
        ctx = PipelineContext()
        ctx.add_log("test message")
        assert len(ctx.logs) == 1
        assert "test message" in ctx.logs[0]


class TestExecutePipeline:
    """Test suite for full pipeline execution."""

    @pytest.mark.asyncio
    async def test_empty_pipeline_succeeds(self):
        """An empty pipeline should succeed with no outputs."""
        result = await execute_pipeline([])
        assert result["success"] is True
        assert result["error"] is None

    @pytest.mark.asyncio
    async def test_transform_passthrough(self):
        """A passthrough transform should preserve the input value."""
        steps = [
            {
                "id": "t1",
                "type": "transform",
                "config": {
                    "input": "{{seed}}",
                    "operation": "passthrough",
                },
                "output": "result",
            }
        ]
        result = await execute_pipeline(steps, {"seed": [1, 2, 3]})
        assert result["success"] is True
        assert result["outputs"]["result"] == [1, 2, 3]

    @pytest.mark.asyncio
    async def test_transform_pick(self):
        """Pick operation should keep only selected keys."""
        steps = [
            {
                "id": "t1",
                "type": "transform",
                "config": {
                    "input": "{{data}}",
                    "operation": "pick",
                    "keys": ["a", "c"],
                },
                "output": "result",
            }
        ]
        result = await execute_pipeline(
            steps, {"data": {"a": 1, "b": 2, "c": 3}}
        )
        assert result["success"] is True
        assert result["outputs"]["result"] == {"a": 1, "c": 3}

    @pytest.mark.asyncio
    async def test_condition_truthy_branch(self):
        """Condition should execute 'then' branch when truthy."""
        steps = [
            {
                "id": "cond",
                "type": "condition",
                "config": {
                    "expression": "{{flag}}",
                    "then": [
                        {
                            "id": "inner",
                            "type": "transform",
                            "config": {
                                "input": "yes",
                                "operation": "passthrough",
                            },
                            "output": "branch_result",
                        }
                    ],
                    "else": [],
                },
            }
        ]
        result = await execute_pipeline(steps, {"flag": "true"})
        assert result["success"] is True
        assert result["outputs"]["branch_result"] == "yes"

    @pytest.mark.asyncio
    async def test_condition_falsy_branch(self):
        """Condition should execute 'else' branch when falsy."""
        steps = [
            {
                "id": "cond",
                "type": "condition",
                "config": {
                    "expression": "{{flag}}",
                    "then": [],
                    "else": [
                        {
                            "id": "inner",
                            "type": "transform",
                            "config": {
                                "input": "no",
                                "operation": "passthrough",
                            },
                            "output": "branch_result",
                        }
                    ],
                },
            }
        ]
        result = await execute_pipeline(steps, {"flag": "false"})
        assert result["success"] is True
        assert result["outputs"]["branch_result"] == "no"

    @pytest.mark.asyncio
    async def test_loop_iterates_collection(self):
        """Loop should iterate over a list and set the item variable."""
        steps = [
            {
                "id": "loop",
                "type": "loop",
                "config": {
                    "collection": "{{items}}",
                    "as": "item",
                    "steps": [],
                },
                "output": "loop_result",
            }
        ]
        result = await execute_pipeline(steps, {"items": ["a", "b", "c"]})
        assert result["success"] is True
        assert result["outputs"]["loop_result"] == ["a", "b", "c"]

    @pytest.mark.asyncio
    async def test_unknown_step_type_stops_pipeline(self):
        """An unknown step type should cause the pipeline to fail."""
        steps = [
            {
                "id": "bad",
                "type": "nonexistent_step",
                "config": {},
            }
        ]
        result = await execute_pipeline(steps)
        assert result["success"] is False
        assert "Unknown step type" in result["error"]

    @pytest.mark.asyncio
    async def test_on_error_continue(self):
        """A step with on_error=continue should not abort the pipeline."""
        steps = [
            {
                "id": "bad",
                "type": "nonexistent_step",
                "config": {},
                "on_error": "continue",
            },
            {
                "id": "good",
                "type": "transform",
                "config": {
                    "input": "ok",
                    "operation": "passthrough",
                },
                "output": "result",
            },
        ]
        result = await execute_pipeline(steps)
        assert result["success"] is True
        assert result["outputs"]["result"] == "ok"

    @pytest.mark.asyncio
    async def test_notify_without_nats(self):
        """Notify step should handle missing NATS gracefully."""
        steps = [
            {
                "id": "n1",
                "type": "notify",
                "config": {
                    "event": "test:event",
                    "data": {"msg": "hello"},
                },
                "output": "notify_result",
            }
        ]
        result = await execute_pipeline(steps)
        assert result["success"] is True
        assert result["outputs"]["notify_result"]["sent"] is False
