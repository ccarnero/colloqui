"""Credential resolution for LLM providers.

Resolves API keys, base URLs, and service account credentials from
environment variables and runtime secret files. All provider and model
configuration comes from backend via WebSocket - no hardcoded defaults.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from src.shared.config.config_loader_settings import get_runtime_config_dir
from src.shared.utils.credentials import CredentialSettings
from src.shared.errors import RequiredFieldMissingError


API_KEY_ENV_BY_PROVIDER: dict[str, tuple[str, ...]] = {
    "anthropic": ("ANTHROPIC_API_KEY",),
    "cerebras": ("CEREBRAS_API_KEY",),
    "cohere": ("CO_API_KEY", "COHERE_API_KEY"),
    "google": ("GOOGLE_API_KEY", "GEMINI_API_KEY"),
    "groq": ("GROQ_API_KEY",),
    "huggingface": ("HF_TOKEN", "HUGGINGFACE_API_KEY"),
    "mistral": ("MISTRAL_API_KEY",),
    "openai": ("OPENAI_API_KEY",),
    "openrouter": ("OPENROUTER_API_KEY",),
    "xai": ("XAI_API_KEY",),
}

BASE_URL_ENV_BY_PROVIDER: dict[str, tuple[str, ...]] = {
    "anthropic": ("ANTHROPIC_BASE_URL",),
    "groq": ("GROQ_BASE_URL",),
    "huggingface": ("HF_BASE_URL", "HUGGINGFACE_BASE_URL"),
    "mistral": ("MISTRAL_BASE_URL",),
    "openai": ("OPENAI_BASE_URL",),
}

GOOGLE_VERTEX_PROJECT_ENV = ("GOOGLE_CLOUD_PROJECT", "VERTEXAI_PROJECT")
GOOGLE_VERTEX_REGION_ENV = ("GOOGLE_CLOUD_REGION", "VERTEXAI_REGION")
GOOGLE_VERTEX_SERVICE_ACCOUNT_FILE_ENV = ("GOOGLE_APPLICATION_CREDENTIALS",)
GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON_ENV = (
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "VERTEXAI_SERVICE_ACCOUNT_JSON",
)
AWS_REGION_ENV = ("AWS_REGION", "AWS_DEFAULT_REGION")
RUNTIME_CREDENTIALS_ENV_PATH = Path("runtime-secrets") / "credentials.env"
CREDENTIAL_MODE_PROFILE = "profile"
CREDENTIAL_MODE_RUNTIME_DEFAULT = "runtime-default"
CREDENTIAL_MODE_NONE = "none"
SUPPORTED_CREDENTIAL_MODES = {
    CREDENTIAL_MODE_PROFILE,
    CREDENTIAL_MODE_RUNTIME_DEFAULT,
    CREDENTIAL_MODE_NONE,
}


def _normalize_provider(value: object) -> str:
    """Normalize provider name from config. No defaults - must be explicit."""
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized:
            return normalized

    raise RequiredFieldMissingError("llm.provider")


def _normalize_model(value: object) -> str:
    """Normalize model name from config. No defaults - must be explicit."""
    if isinstance(value, str) and value.strip():
        return value.strip()

    raise RequiredFieldMissingError("llm.model")


def _normalize_credential_id(value: object) -> str | None:
    if not isinstance(value, str):
        return None

    normalized = value.strip()
    return normalized or None


def _normalize_credential_mode(
    value: object,
    credential_id: str | None,
) -> str:
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in SUPPORTED_CREDENTIAL_MODES:
            return normalized

    return (
        CREDENTIAL_MODE_PROFILE
        if credential_id
        else CREDENTIAL_MODE_RUNTIME_DEFAULT
    )


def _to_env_segment(value: str) -> str:
    sanitized = [character if character.isalnum() else "_" for character in value]
    return "".join(sanitized).upper()


def _get_runtime_secret_entries() -> dict[str, str]:
    secret_path = get_runtime_config_dir() / RUNTIME_CREDENTIALS_ENV_PATH
    if not secret_path.exists():
        return {}

    try:
        content = secret_path.read_text(encoding="utf-8")
    except OSError:
        return {}

    entries: dict[str, str] = {}
    for raw_line in content.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        normalized_key = key.strip()
        normalized_value = value.strip()
        if (
            len(normalized_value) >= 2
            and normalized_value[0] == normalized_value[-1]
            and normalized_value[0] in {'"', "'"}
        ):
            normalized_value = normalized_value[1:-1]

        if normalized_key and normalized_value:
            entries[normalized_key] = normalized_value

    return entries


def _get_env_value(
    runtime_secret_entries: dict[str, str],
    *candidates: str | None,
) -> str | None:
    for candidate in candidates:
        if not candidate:
            continue

        value = os.getenv(candidate)
        if isinstance(value, str) and value.strip():
            return value.strip()

        runtime_value = runtime_secret_entries.get(candidate)
        if isinstance(runtime_value, str) and runtime_value.strip():
            return runtime_value.strip()

    return None


def _get_credential_env_name(credential_id: str | None, suffix: str) -> str | None:
    if not credential_id:
        return None

    return f"LLM_CREDENTIAL_{_to_env_segment(credential_id)}_{suffix}"


def _get_provider_default_env_name(provider: str, suffix: str) -> str:
    return f"LLM_CREDENTIAL_{_to_env_segment(provider)}_DEFAULT_{suffix}"


def _get_resolution_candidates(
    provider: str,
    credential_id: str | None,
    credential_mode: str,
    suffix: str,
    *global_candidates: str,
) -> tuple[str, ...]:
    if credential_mode == CREDENTIAL_MODE_NONE:
        return ()

    if credential_mode == CREDENTIAL_MODE_PROFILE:
        credential_env_name = _get_credential_env_name(credential_id, suffix)
        return (credential_env_name,) if credential_env_name else ()

    return (
        _get_provider_default_env_name(provider, suffix),
        *global_candidates,
    )


def _load_service_account_info(
    provider: str,
    credential_id: str | None,
    credential_mode: str,
    runtime_secret_entries: dict[str, str],
) -> dict[str, Any] | None:
    raw_value = _get_env_value(
        runtime_secret_entries,
        *_get_resolution_candidates(
            provider,
            credential_id,
            credential_mode,
            "SERVICE_ACCOUNT_JSON",
            *GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON_ENV,
        ),
    )
    if not raw_value:
        return None

    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError as error:
        raise RuntimeError(
            "Invalid Google service account JSON configured for credential id "
            f"{credential_id or '<default>'}"
        ) from error

    return parsed if isinstance(parsed, dict) else None


def _resolve_credentials(
    provider: str,
    credential_id: str | None,
    credential_mode: str,
) -> CredentialSettings:
    """Resolve credentials from environment variables.

    All configuration comes from backend via WebSocket, credentials
    are resolved from environment variables based on provider.
    """
    runtime_secret_entries = _get_runtime_secret_entries()
    api_key = _get_env_value(
        runtime_secret_entries,
        *_get_resolution_candidates(
            provider,
            credential_id,
            credential_mode,
            "API_KEY",
            *API_KEY_ENV_BY_PROVIDER.get(provider, ()),
        ),
    )

    return CredentialSettings(
        api_key=api_key or "",
        app_title=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "APP_TITLE",
                "OPENROUTER_APP_TITLE",
            ),
        ),
        app_url=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "APP_URL",
                "OPENROUTER_APP_URL",
            ),
        ),
        aws_access_key_id=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "AWS_ACCESS_KEY_ID",
                "AWS_ACCESS_KEY_ID",
            ),
        ),
        aws_profile_name=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "AWS_PROFILE_NAME",
                "AWS_PROFILE",
                "AWS_PROFILE_NAME",
            ),
        ),
        aws_secret_access_key=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "AWS_SECRET_ACCESS_KEY",
                "AWS_SECRET_ACCESS_KEY",
            ),
        ),
        aws_session_token=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "AWS_SESSION_TOKEN",
                "AWS_SESSION_TOKEN",
            ),
        ),
        base_url=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "BASE_URL",
                *BASE_URL_ENV_BY_PROVIDER.get(provider, ()),
            ),
        ),
        project_id=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "PROJECT_ID",
                "GOOGLE_CLOUD_PROJECT",
                "VERTEXAI_PROJECT",
            ),
        ),
        provider_name=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "PROVIDER_NAME",
            ),
        ),
        region=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "REGION",
                "GOOGLE_CLOUD_REGION",
                "VERTEXAI_REGION",
                "AWS_REGION",
                "AWS_DEFAULT_REGION",
            ),
        ),
        service_account_file=_get_env_value(
            runtime_secret_entries,
            *_get_resolution_candidates(
                provider,
                credential_id,
                credential_mode,
                "SERVICE_ACCOUNT_FILE",
                "GOOGLE_APPLICATION_CREDENTIALS",
            ),
        ),
        service_account_info=_load_service_account_info(
            provider,
            credential_id,
            credential_mode,
            runtime_secret_entries,
        ),
    )


def _has_provider_credentials(provider: str, credentials: CredentialSettings) -> bool:
    if provider == "mock":
        return True

    if provider == "google-vertex":
        return bool(
            credentials.project_id
            and (
                credentials.service_account_file or credentials.service_account_info
            )
        )

    if provider == "bedrock":
        return bool(
            credentials.region
            and (
                credentials.api_key
                or credentials.aws_profile_name
                or (
                    credentials.aws_access_key_id
                    and credentials.aws_secret_access_key
                )
            )
        )

    return bool(credentials.api_key)
