"""Agent configuration contract and persistence helpers.

The backend publishes complete agent payloads and this module turns them into
runtime overrides for the recovery hand. Published agents are stored under
`agents/runtime/{agent_id}.yaml`.
"""

from __future__ import annotations

from typing import Any, Callable, Literal, Optional, TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, model_validator

if TYPE_CHECKING:
    from src.shared.utils.runtime_config import RuntimeConfigRepository

RECOVERY_AGENT_ID = "agent-recovery"


class AgentRolePayload(BaseModel):
    """Validated role information published by the backend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    description: str = ""
    system_prompt: str = Field(alias="systemPrompt")
    temperature: float = 0.7
    max_tokens: int = Field(default=1000, alias="maxTokens")


class AgentSkillPayload(BaseModel):
    """Validated skill payload published by the backend."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str
    enabled: bool = True
    instructions: str = ""
    allowed_tools: list[str] = Field(default_factory=list, alias="allowedTools")
    config: dict[str, Any] = Field(default_factory=dict)


class AgentToolPayload(BaseModel):
    """Validated tool payload published by the backend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    id: str
    name: str
    endpoint: str
    method: Literal["GET", "POST", "PUT", "DELETE"]
    headers: dict[str, str] = Field(default_factory=dict)
    body_template: dict[str, Any] | None = Field(
        default=None,
        alias="bodyTemplate",
    )
    enabled: bool = True
    description: str | None = None
    field_descriptions: dict[str, str] | None = Field(
        default=None,
        alias="fieldDescriptions",
    )


class AgentLlmPayload(BaseModel):
    """Validated LLM settings published by the backend."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    provider: Literal[
        "anthropic",
        "bedrock",
        "cerebras",
        "cohere",
        "google",
        "google-vertex",
        "groq",
        "huggingface",
        "mistral",
        "mock",
        "openai",
        "openrouter",
        "xai",
        "zhipuai",
    ] | None = None
    model: str | None = None
    credential_mode: Literal["profile", "runtime-default", "none"] | None = Field(
        default=None,
        alias="credentialMode",
    )
    credential_id: str | None = Field(default=None, alias="credentialId")

    @model_validator(mode="after")
    def _apply_default_credential_mode(self) -> "AgentLlmPayload":
        if (
            self.provider is None
            and self.model is None
            and self.credential_id is None
        ):
            return self

        if self.credential_mode is not None:
            return self

        self.credential_mode = (
            "profile"
            if self.credential_id
            else "runtime-default"
        )
        return self


class AgentSyncRequest(BaseModel):
    """Validated agent payload received from the backend sync endpoint."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    name: str
    description: str = ""
    role: AgentRolePayload
    rules: list[str] = Field(default_factory=list)
    response_style: str = Field(default="", alias="responseStyle")
    llm: AgentLlmPayload = Field(default_factory=AgentLlmPayload)
    skills: list[AgentSkillPayload] = Field(default_factory=list)
    tools: list[AgentToolPayload] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize_legacy_response_style(cls, data: Any) -> Any:
        """Normalize legacy response-style inputs before validation."""

        if not isinstance(data, dict):
            return data

        normalized = dict(data)
        response_style_value = normalized.get("responseStyle")
        if response_style_value is None:
            response_style_value = normalized.get("response_style")

        if response_style_value is None:
            response_style_value = normalized.get("soul")

        if response_style_value is None:
            response_style_value = normalized.get("soulSkills")

        if response_style_value is None:
            response_style_value = normalized.get("soul_skills")

        if response_style_value is not None:
            normalized["responseStyle"] = _coerce_response_style_text(
                response_style_value,
            )

        llm_value = normalized.get("llm")
        if isinstance(llm_value, dict):
            normalized["llm"] = llm_value
        elif llm_value is None:
            llm_aliases = {
                "provider": normalized.get("llm_provider"),
                "model": normalized.get("llm_model"),
                "credentialMode": normalized.get("llm_credential_mode"),
                "credentialId": normalized.get("llm_credential_id"),
            }
            if any(value is not None for value in llm_aliases.values()):
                normalized["llm"] = llm_aliases

        normalized.pop("response_style", None)
        normalized.pop("soul", None)
        normalized.pop("soulSkills", None)
        normalized.pop("soul_skills", None)
        normalized.pop("llm_provider", None)
        normalized.pop("llm_model", None)
        normalized.pop("llm_credential_mode", None)
        normalized.pop("llm_credential_id", None)
        normalized.pop("flows", None)
        normalized.pop("execution", None)
        return normalized

    def to_runtime_dict(self) -> dict[str, Any]:
        """Convert the payload into the YAML shape used by the runtime."""

        return self.model_dump(by_alias=False, exclude_none=True)


class AgentConfigStore:
    """Store published agent overrides in PostgreSQL."""

    def __init__(
        self,
        config_dir: Optional[str] = None,
        repository: Optional["RuntimeConfigRepository"] = None,
    ) -> None:
        if repository is not None:
            self._repository = repository
        else:
            from src.shared.utils.runtime_config import RuntimeConfigRepository

            self._repository = RuntimeConfigRepository(config_dir)

    async def load_active_config(self) -> dict[str, object]:
        """Load the canonical recovery config."""

        return await self.load_agent_config()

    async def load_agent_config(
        self,
        agent_id: str | None = None,
    ) -> dict[str, object]:
        """Load the effective config for a published agent id."""

        return await self._repository.load_agent_config(agent_id)

    async def load_all_agent_configs(self) -> dict[str, dict[str, object]]:
        """Load every stored runtime agent configuration."""

        return await self._repository.load_all_agent_configs()

    async def save_active_config(
        self,
        payload: AgentSyncRequest | dict[str, object],
        agent_id: str | None = None,
    ) -> dict[str, object]:
        """Persist the published agent payload as a runtime override."""

        return await self._repository.save_agent_config(payload, agent_id)

    async def remove_active_config(self, agent_id: str | None = None) -> None:
        """Remove the selected runtime override from PostgreSQL."""

        await self._repository.remove_agent_config(agent_id)


def build_agent_system_prompt(
    base_prompt: str,
    agent_config: dict[str, Any],
) -> str:
    """Compose the runtime system prompt from config, rules, response style, and skills."""

    configured_prompt = _get_role_prompt(agent_config)
    prompt = configured_prompt or base_prompt.strip()
    sections = [prompt.strip()] if prompt.strip() else []

    extra_sections: list[str] = []

    rules_text = _format_text_bullets("Rules", agent_config.get("rules", []))
    if rules_text:
        extra_sections.append(rules_text)

    response_style_text = _get_response_style_text(agent_config)
    if response_style_text:
        extra_sections.append(_format_text_section("Soul", response_style_text))

    skills_text = _format_skill_bullets(agent_config.get("skills", []))
    if skills_text:
        extra_sections.append(skills_text)

    if extra_sections:
        sections.append("\n\n".join(extra_sections))

    return "\n\n".join(sections).strip()


def resolve_tool_definition(
    name: str,
    agent_config: dict[str, Any],
    registry_lookup: Callable[[str], Any | None],
) -> Any | None:
    """Resolve an enabled tool from the published config or the registry."""

    configured_tools = agent_config.get("tools")
    if isinstance(configured_tools, list):
        for tool in configured_tools:
            if isinstance(tool, str):
                if tool == name:
                    return registry_lookup(name)
                continue

            if isinstance(tool, dict):
                tool_name = str(tool.get("name") or tool.get("id") or "").strip()
                if tool_name != name:
                    continue

                if tool.get("enabled", True) is False:
                    return None

                return tool

        return None

    return registry_lookup(name)


def _get_role_prompt(agent_config: dict[str, Any]) -> str:
    role = agent_config.get("role")
    if not isinstance(role, dict):
        return ""

    prompt = role.get("system_prompt") or role.get("systemPrompt") or ""
    return str(prompt).strip()


def _get_response_style_text(agent_config: dict[str, Any]) -> str:
    style_keys = [
        "response_style",
        "responseStyle",
        "soul",
        "soulSkills",
        "soul_skills",
    ]
    for key in style_keys:
        value = agent_config.get(key)
        result = _coerce_response_style_text(value)
        if result:
            return result
    return ""


def _format_text_bullets(title: str, items: Any) -> str:
    if not isinstance(items, list):
        return ""

    lines: list[str] = []
    for item in items:
        text = str(item).strip()
        if text:
            lines.append(f"- {text}")

    if not lines:
        return ""

    return f"{title}:\n" + "\n".join(lines)


def _format_text_section(title: str, text: str) -> str:
    cleaned_text = str(text).strip()
    if not cleaned_text:
        return ""

    return f"{title}:\n{cleaned_text}"


def _format_skill_bullets(items: Any) -> str:
    if not isinstance(items, list):
        return ""

    lines: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            text = str(item).strip()
            if text:
                lines.append(f"- {text}")
            continue

        if item.get("enabled", True) is False:
            continue

        name = str(item.get("name", "")).strip()
        description = str(item.get("description", "")).strip()
        if not name:
            continue

        lines.append(f"- {name}: {description}" if description else f"- {name}")

    if not lines:
        return ""

    return "Enabled skills:\n" + "\n".join(lines)


def _coerce_response_style_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()

    if isinstance(value, list):
        lines = []
        for item in value:
            text = str(item).strip()
            if text:
                lines.append(text)

        return "\n".join(lines)

    if value is None:
        return ""

    return str(value).strip()


def _deep_merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        base_value = merged.get(key)
        if isinstance(base_value, dict) and isinstance(value, dict):
            merged[key] = _deep_merge_dicts(base_value, value)
            continue

        merged[key] = value

    return merged
