"""Template rendering for runtime agent state substitution."""

from __future__ import annotations

import re
from typing import Any


class TemplateRenderer:
    """Renders templates with state variable substitution."""

    _PROMPT_PLACEHOLDER_PATTERN = re.compile(r"\{\{\s*([^{}]+)\s*\}\}")
    _PROMPT_ALLOWED_NAMESPACES = {"agent", "context", "input", "memory", "skill"}

    def render_value(self, value: Any, state: dict[str, Any]) -> Any:
        """Recursively render template placeholders in a value.

        Substitutes ``{path.to.key}`` patterns with values from state.
        """
        if isinstance(value, str):
            return re.sub(
                r"\{([^{}]+)\}",
                lambda match: self._stringify_state_value(
                    match.group(1), state,
                ),
                value,
            )
        if isinstance(value, list):
            return [self.render_value(item, state) for item in value]
        if isinstance(value, dict):
            return {
                key: self.render_value(entry_value, state)
                for key, entry_value in value.items()
            }
        return value

    def render_tool_headers(
        self,
        headers: Any,
        state: dict[str, Any],
    ) -> dict[str, str] | None:
        """Render tool headers template against state."""
        rendered = self.render_tool_template(headers, state)
        if not isinstance(rendered, dict):
            return None

        normalized: dict[str, str] = {}
        for key, value in rendered.items():
            if value is None:
                continue
            normalized[str(key)] = str(value)
        return normalized or None

    def render_tool_template(
        self,
        template: Any,
        state: dict[str, Any],
    ) -> Any:
        """Render a tool template with ``{{key}}`` style substitution."""
        if template is None:
            return None
        if isinstance(template, str):
            return self._render_tool_template_string(template, state)
        if isinstance(template, list):
            return [self.render_tool_template(item, state) for item in template]
        if isinstance(template, dict):
            return {
                key: self.render_tool_template(value, state)
                for key, value in template.items()
            }
        return template

    def render_prompt_text(
        self,
        value: str,
        state: dict[str, Any],
        warnings: list[str] | None = None,
    ) -> str:
        """Render `{{namespace.key}}` placeholders for authored prompts only."""

        def replace(match: re.Match[str]) -> str:
            expression = match.group(1).strip()
            value = self._lookup_prompt_state_value(expression, state)
            if value is _MissingPromptValue:
                if warnings is not None:
                    warnings.append(
                        f"Prompt reference '{{{{{expression}}}}}' could not be resolved.",
                    )
                return match.group(0)
            if value is _InvalidPromptNamespace:
                if warnings is not None:
                    warnings.append(
                        f"Prompt reference '{{{{{expression}}}}}' uses an unsupported namespace.",
                    )
                return match.group(0)
            if isinstance(value, str):
                return value
            return str(value)

        return self._PROMPT_PLACEHOLDER_PATTERN.sub(replace, value)

    def _render_tool_template_string(
        self,
        value: str,
        state: dict[str, Any],
    ) -> Any:
        exact_match = re.fullmatch(r"\{\{\s*([^{}]+)\s*\}\}", value)
        if exact_match is not None:
            return self._lookup_state_value(exact_match.group(1).strip(), state)

        return re.sub(
            r"\{\{\s*([^{}]+)\s*\}\}",
            lambda match: self._stringify_state_value(match.group(1), state),
            value,
        )

    def _stringify_state_value(
        self,
        expression: str,
        state: dict[str, Any],
    ) -> str:
        value = self._lookup_state_value(expression.strip(), state)
        if value is None:
            return ""
        if isinstance(value, str):
            return value
        return str(value)

    def _lookup_state_value(self, expression: str, state: dict[str, Any]) -> Any:
        current: Any = state
        for part in expression.split("."):
            if not isinstance(current, dict):
                return None
            current = current.get(part)
        return current

    def _lookup_prompt_state_value(
        self,
        expression: str,
        state: dict[str, Any],
    ) -> Any:
        parts = [part.strip() for part in expression.split(".") if part.strip()]
        if not parts:
            return _MissingPromptValue

        namespace = parts[0]
        if namespace not in self._PROMPT_ALLOWED_NAMESPACES:
            return _InvalidPromptNamespace

        current: Any = state.get(namespace)
        for part in parts[1:]:
            if not isinstance(current, dict):
                return _MissingPromptValue
            current = current.get(part)

        if current is None:
            return _MissingPromptValue
        return current

    @staticmethod
    def filter_query_params(payload: dict[str, Any]) -> dict[str, Any]:
        """Remove None values from a dict for use as query parameters."""
        return {key: value for key, value in payload.items() if value is not None}


class _MissingPromptValueType:
    pass


class _InvalidPromptNamespaceType:
    pass


_MissingPromptValue = _MissingPromptValueType()
_InvalidPromptNamespace = _InvalidPromptNamespaceType()
