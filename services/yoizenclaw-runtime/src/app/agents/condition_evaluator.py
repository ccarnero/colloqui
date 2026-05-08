"""Safe condition evaluator for runtime agent step conditions.

Uses a strict AST node whitelist to prevent arbitrary code execution.
Only boolean logic, comparisons, and a small set of helper functions
are allowed.
"""

from __future__ import annotations

import ast
import re
from typing import Any

_ALLOWED_HELPERS: dict[str, Any] = {
    "contains": lambda value, expected: str(expected) in str(value or ""),
    "regex": lambda pattern, value: bool(
        re.search(str(pattern), str(value or ""), re.IGNORECASE)
    ),
    "exists": lambda value: value is not None and str(value) != "",
}

_ALLOWED_NODE_TYPES: frozenset[type[ast.AST]] = frozenset({
    ast.Expression,
    ast.BoolOp,
    ast.UnaryOp,
    ast.Compare,
    ast.Call,
    ast.Name,
    ast.Attribute,
    ast.Constant,
    ast.List,
    ast.Tuple,
    ast.Dict,
    ast.And,
    ast.Or,
    ast.Not,
    ast.Eq,
    ast.NotEq,
    ast.Is,
    ast.IsNot,
    ast.Load,
})


class ConditionEvaluator:
    """Evaluate string conditions against a state dictionary safely."""

    def should_run_step(self, condition: Any, state: dict[str, Any]) -> bool:
        """Evaluate whether a pipeline step should execute.

        Args:
            condition: Condition string, boolean, or None.
            state: Current execution state.

        Returns:
            True if the step should run.
        """
        if condition is None:
            return True
        if not isinstance(condition, str):
            return bool(condition)

        normalized = condition.strip()
        if not normalized:
            return True

        expression = self._preprocess_expression(normalized)

        try:
            parsed = ast.parse(expression, mode="eval")
            self._validate_ast(parsed)
            return bool(self._evaluate_node(parsed.body, state))
        except Exception:
            return False

    def _preprocess_expression(self, expression: str) -> str:
        """Convert DSL keywords to Python equivalents for AST parsing."""
        result = re.sub(r"\bAND\b", " and ", expression)
        result = re.sub(r"\bOR\b", " or ", result)
        result = re.sub(r"\bnull\b", "None", result, flags=re.IGNORECASE)
        result = re.sub(r"\btrue\b", "True", result, flags=re.IGNORECASE)
        result = re.sub(r"\bfalse\b", "False", result, flags=re.IGNORECASE)
        return result

    def _validate_ast(self, tree: ast.AST) -> None:
        """Walk the AST tree and reject any disallowed node types.

        Raises:
            ValueError: If a disallowed node type is found.
        """
        for node in ast.walk(tree):
            if type(node) not in _ALLOWED_NODE_TYPES:
                raise ValueError(
                    f"Disallowed AST node type in condition: {type(node).__name__}"
                )

    def _evaluate_node(self, node: ast.AST, state: dict[str, Any]) -> Any:
        """Evaluate a single AST node against state."""
        if isinstance(node, ast.BoolOp):
            return self._evaluate_bool_op(node, state)

        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return not bool(self._evaluate_node(node.operand, state))

        if isinstance(node, ast.Compare):
            return self._evaluate_compare(node, state)

        if isinstance(node, ast.Call):
            return self._evaluate_call(node, state)

        if isinstance(node, ast.Name):
            return state.get(node.id)

        if isinstance(node, ast.Attribute):
            value = self._evaluate_node(node.value, state)
            if isinstance(value, dict):
                return value.get(node.attr)
            return getattr(value, node.attr, None)

        if isinstance(node, ast.Constant):
            return node.value

        if isinstance(node, ast.List):
            return [self._evaluate_node(item, state) for item in node.elts]

        if isinstance(node, ast.Tuple):
            return tuple(
                self._evaluate_node(item, state) for item in node.elts
            )

        if isinstance(node, ast.Dict):
            return {
                self._evaluate_node(key, state): self._evaluate_node(
                    value, state,
                )
                for key, value in zip(node.keys, node.values, strict=True)
            }

        raise ValueError(f"Unsupported condition node: {type(node).__name__}")

    def _evaluate_bool_op(
        self,
        node: ast.BoolOp,
        state: dict[str, Any],
    ) -> bool:
        values = [
            bool(self._evaluate_node(value, state))
            for value in node.values
        ]
        if isinstance(node.op, ast.And):
            return all(values)
        if isinstance(node.op, ast.Or):
            return any(values)
        raise ValueError("Unsupported boolean operator")

    def _evaluate_compare(
        self,
        node: ast.Compare,
        state: dict[str, Any],
    ) -> bool:
        left = self._evaluate_node(node.left, state)
        for operator_node, comparator in zip(
            node.ops,
            node.comparators,
            strict=True,
        ):
            right = self._evaluate_node(comparator, state)
            if isinstance(operator_node, ast.Eq):
                matches = left == right
            elif isinstance(operator_node, ast.NotEq):
                matches = left != right
            elif isinstance(operator_node, ast.Is):
                matches = left is right
            elif isinstance(operator_node, ast.IsNot):
                matches = left is not right
            else:
                raise ValueError(
                    f"Unsupported comparison operator: {type(operator_node).__name__}"
                )

            if not matches:
                return False
            left = right

        return True

    def _evaluate_call(
        self,
        node: ast.Call,
        state: dict[str, Any],
    ) -> Any:
        if not isinstance(node.func, ast.Name):
            raise ValueError("Condition helper must be a named function")

        helper_name = node.func.id
        helper = _ALLOWED_HELPERS.get(helper_name)
        if helper is None:
            raise ValueError(f"Unsupported condition helper '{helper_name}'")

        if node.keywords:
            raise ValueError("Condition helpers do not support keyword arguments")

        arguments = [
            self._evaluate_node(argument, state) for argument in node.args
        ]
        return helper(*arguments)
