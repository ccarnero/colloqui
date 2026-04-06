"""Tool execution logic for the runtime agent.

Handles resolution, dispatch, and result normalization for both
registry-backed and HTTP/NATS-backed tools.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any, TYPE_CHECKING

from pydantic import BaseModel
from pydantic_ai.tools import Tool

from src.app.agents._helpers import normalize_config_items
from src.utils.config.prompts import PromptLoader
from src.app.agents.template_renderer import TemplateRenderer
from src.app.tools.registry import ToolRegistry

if TYPE_CHECKING:
    from src.app.tools.adapter_executor import AdapterToolExecutor

logger = logging.getLogger(__name__)


class ToolExecutor:
    """Executes tools for the runtime agent."""

    def __init__(
        self,
        tools: list[Any],
        tool_registry: ToolRegistry,
        prompt_loader: PromptLoader | None = None,
        template_renderer: TemplateRenderer | None = None,
        adapter_tool_executor: AdapterToolExecutor | None = None,
    ) -> None:
        self.tools = normalize_config_items(tools)
        self.tool_registry = tool_registry
        self.prompt_loader = prompt_loader or PromptLoader()
        self.renderer = template_renderer or TemplateRenderer()
        self._adapter_tool_executor = adapter_tool_executor

    def resolve_skill_allowed_tools(self, skill: dict[str, Any]) -> list[str]:
        """Return the list of tool names allowed by a skill configuration."""
        configured_allowed = skill.get("allowed_tools")
        if not isinstance(configured_allowed, list):
            configured_allowed = skill.get("allowedTools")

        enabled_tool_names = self._resolve_enabled_tool_names()

        if isinstance(configured_allowed, list) and configured_allowed:
            normalized_allowed: list[str] = []
            for tool_name in configured_allowed:
                if not isinstance(tool_name, str):
                    continue
                normalized_name = tool_name.strip()
                if (
                    normalized_name
                    and normalized_name in enabled_tool_names
                    and normalized_name not in normalized_allowed
                ):
                    normalized_allowed.append(normalized_name)
            return normalized_allowed

        return sorted(enabled_tool_names)

    def resolve_prompt_referenced_tools(
        self,
        skill: dict[str, Any],
        referenced_tool_names: list[str],
    ) -> tuple[list[str], list[str]]:
        """Validate prompt-referenced tools against enabled and allowed tools."""

        allowed_tool_names = set(self.resolve_skill_allowed_tools(skill))
        enabled_tool_names = self._resolve_enabled_tool_names()

        valid_tool_names: list[str] = []
        warnings: list[str] = []
        for tool_name in referenced_tool_names:
            normalized_name = str(tool_name).strip()
            if not normalized_name:
                continue
            if normalized_name not in enabled_tool_names:
                warnings.append(
                    f"Prompt referenced tool '@tool:{normalized_name}' is not configured for this agent.",
                )
                continue
            if normalized_name not in allowed_tool_names:
                warnings.append(
                    f"Prompt referenced tool '@tool:{normalized_name}' is not allowed by the active skill.",
                )
                continue
            if normalized_name not in valid_tool_names:
                valid_tool_names.append(normalized_name)

        return valid_tool_names, warnings

    def _resolve_enabled_tool_names(self) -> set[str]:
        """Resolve enabled tool names from config or registry fallback."""
        configured_tool_names = {
            str(tool.get("name", "")).strip()
            for tool in self.tools
            if isinstance(tool, dict) and tool.get("enabled", True) is not False
        }
        configured_tool_names = {
            tool_name for tool_name in configured_tool_names if tool_name
        }

        if configured_tool_names:
            return configured_tool_names

        fallback_tool_names: set[str] = set()
        for tool in self.tool_registry.get_tools():
            if isinstance(tool, dict):
                tool_name = str(tool.get("name", "")).strip()
            else:
                tool_name = str(getattr(tool, "name", "")).strip()

            if tool_name:
                fallback_tool_names.add(tool_name)

        return fallback_tool_names

    def build_skill_tools(
        self,
        allowed_tool_names: list[str],
        state: dict[str, Any],
        tool_calls: list[dict[str, Any]],
    ) -> list[Tool]:
        """Build pydantic-ai Tool instances for the given tool names."""
        tools: list[Tool] = []
        for tool_name in allowed_tool_names:
            tool_definition = self._resolve_tool_definition(tool_name)
            tool_description = ""
            if isinstance(tool_definition, dict):
                tool_description = str(
                    tool_definition.get("description", ""),
                ).strip()
                field_descriptions = tool_definition.get("fieldDescriptions")
                if not isinstance(field_descriptions, dict):
                    field_descriptions = tool_definition.get("field_descriptions")
                if isinstance(field_descriptions, dict) and field_descriptions:
                    formatted_fields = "; ".join(
                        f"{field}: {description}"
                        for field, description in field_descriptions.items()
                    )
                    tool_description = (
                        f"{tool_description} Arguments go inside the input object. "
                        f"Fields: {formatted_fields}"
                    ).strip()

            async def tool_handler(
                input: dict[str, Any] | None = None,
                _tool_name: str = tool_name,
            ) -> Any:
                payload = input if isinstance(input, dict) else {}
                try:
                    result = await self._execute_tool_payload(
                        _tool_name,
                        payload,
                        state,
                    )
                    serialized_result = self._serialize(result)
                    self._merge_state(state, result)
                except Exception as error:
                    logger.exception(
                        "Tool '%s' execution failed: %s",
                        _tool_name,
                        error,
                    )
                    serialized_result = {
                        "success": False,
                        "tool": _tool_name,
                        "error": str(error),
                    }

                tool_calls.append(
                    {
                        "tool": _tool_name,
                        "input": self._serialize(payload),
                        "result": serialized_result,
                    },
                )
                return serialized_result

            tools.append(
                Tool(
                    tool_handler,
                    name=tool_name,
                    description=tool_description or f"Runtime tool '{tool_name}'",
                ),
            )

        return tools

    async def execute_tool(
        self,
        tool_name: str,
        state: dict[str, Any],
        step: dict[str, Any],
    ) -> Any:
        """Execute a tool from a pipeline step definition."""
        rendered_input = self.renderer.render_value(
            step.get("input"),
            state,
        )
        payload = rendered_input if isinstance(rendered_input, dict) else {}
        return await self._execute_tool_payload(tool_name, payload, state)

    async def _execute_tool_payload(
        self,
        tool_name: str,
        payload: dict[str, Any],
        state: dict[str, Any],
    ) -> Any:
        tool_callable = getattr(self.tool_registry, tool_name, None)

        if tool_callable is not None and callable(tool_callable):
            signature = inspect.signature(tool_callable)
            kwargs: dict[str, Any] = {}
            for parameter_name in signature.parameters:
                if parameter_name == "self":
                    continue
                if parameter_name in payload:
                    kwargs[parameter_name] = payload[parameter_name]
                elif parameter_name in state:
                    kwargs[parameter_name] = state[parameter_name]

            return await tool_callable(**kwargs)

        tool_definition = self._resolve_tool_definition(tool_name)
        if tool_definition is None:
            raise ValueError(
                f"Tool '{tool_name}' is not available in runtime registry",
            )

        return await self._execute_configured_tool(
            tool_definition,
            payload,
            state,
        )

    async def _execute_configured_tool(
        self,
        tool_definition: dict[str, Any],
        payload: dict[str, Any],
        state: dict[str, Any],
    ) -> Any:
        adapter_ref_data = tool_definition.get("adapterRef")
        if adapter_ref_data is not None:
            return await self._execute_adapter_tool(
                adapter_ref_data,
                payload,
                state,
            )

        endpoint = str(tool_definition.get("endpoint", "")).strip()
        if not endpoint:
            raise ValueError("Tool endpoint is required for runtime execution")

        if endpoint.startswith("runtime://"):
            raise ValueError(
                f"Runtime tool endpoint '{endpoint}' requires a concrete registry method",
            )

        method = str(tool_definition.get("method", "POST")).strip().upper()
        request_context = dict(state)
        request_context.update(payload)
        headers = self.renderer.render_tool_headers(
            tool_definition.get("headers"),
            request_context,
        )
        body_template = tool_definition.get("body_template")
        if body_template is None:
            body_template = tool_definition.get("bodyTemplate")

        request_payload = self.renderer.render_tool_template(
            body_template,
            request_context,
        )
        if not isinstance(request_payload, dict):
            request_payload = payload

        if method == "GET":
            result = await self.tool_registry.backend.get(
                endpoint,
                params=self.renderer.filter_query_params(request_payload),
                headers=headers,
            )
            return self._normalize_backend_tool_result(result)
        if method == "PUT":
            result = await self.tool_registry.backend.put(
                endpoint,
                request_payload,
                headers=headers,
            )
            return self._normalize_backend_tool_result(result)
        result = await self.tool_registry.backend.post(
            endpoint,
            request_payload,
            headers=headers,
        )
        return self._normalize_backend_tool_result(result)

    async def _execute_adapter_tool(
        self,
        adapter_ref_data: Any,
        payload: dict[str, Any],
        state: dict[str, Any],
    ) -> Any:
        """Dispatch tool execution to AdapterToolExecutor when adapterRef is present."""
        from src.utils.config.agent_config import AdapterReference
        from src.app.tools.adapter_executor import is_adapter_tools_enabled

        if not is_adapter_tools_enabled():
            return {
                "success": False,
                "error": "Adapter tools are disabled",
            }

        if self._adapter_tool_executor is None:
            return {
                "success": False,
                "error": "Adapter tool executor is not configured",
            }

        if isinstance(adapter_ref_data, dict):
            adapter_ref = AdapterReference(**adapter_ref_data)
        elif isinstance(adapter_ref_data, AdapterReference):
            adapter_ref = adapter_ref_data
        else:
            return {
                "success": False,
                "error": "Invalid adapter reference configuration",
            }

        tenant_id = str(state.get("tenant_id", "")).strip()

        return await self._adapter_tool_executor.execute(
            tenant_id=tenant_id,
            adapter_ref=adapter_ref,
            payload=payload,
        )

    def _resolve_tool_definition(self, tool_name: str) -> dict[str, Any] | None:
        for tool in self.tools:
            if not isinstance(tool, dict):
                continue
            if str(tool.get("name", "")).strip() == tool_name:
                return tool
        return None

    @staticmethod
    def _normalize_backend_tool_result(result: Any) -> Any:
        if not isinstance(result, dict):
            return result

        response_data = result.get("data")
        if isinstance(response_data, dict):
            normalized = {key: value for key, value in result.items() if key != "data"}
            normalized.update(response_data)
            return normalized

        return result

    def _merge_state(self, state: dict[str, Any], value: Any) -> None:
        serialized = self._serialize(value)
        if isinstance(serialized, dict):
            for key, entry_value in serialized.items():
                existing = state.get(key)
                if (
                    key == "message"
                    and isinstance(existing, str)
                    and not isinstance(entry_value, str)
                ):
                    continue
                state[key] = entry_value

    @staticmethod
    def _serialize(value: Any) -> Any:
        if isinstance(value, BaseModel):
            return value.model_dump()
        return value
