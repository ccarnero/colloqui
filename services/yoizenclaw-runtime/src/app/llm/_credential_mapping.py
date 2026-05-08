"""Credential field mapping for _resolve_credentials to eliminate repetition."""

from __future__ import annotations

from typing import Any

from src.app.llm.credentials import (
    API_KEY_ENV_BY_PROVIDER,
    BASE_URL_ENV_BY_PROVIDER,
    GOOGLE_VERTEX_PROJECT_ENV,
    GOOGLE_VERTEX_REGION_ENV,
    GOOGLE_VERTEX_SERVICE_ACCOUNT_FILE_ENV,
    GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON_ENV,
    AWS_REGION_ENV,
)

# Mapping of credential fields to their suffix and global candidates
CREDENTIAL_FIELD_MAPPING = {
    "api_key": ("API_KEY", lambda provider: API_KEY_ENV_BY_PROVIDER.get(provider, ())),
    "app_title": ("APP_TITLE", ("OPENROUTER_APP_TITLE",)),
    "app_url": ("APP_URL", ("OPENROUTER_APP_URL",)),
    "aws_access_key_id": ("AWS_ACCESS_KEY_ID", ("AWS_ACCESS_KEY_ID",)),
    "aws_profile_name": ("AWS_PROFILE", ("AWS_PROFILE", "AWS_PROFILE_NAME",)),
    "aws_secret_access_key": ("AWS_SECRET_ACCESS_KEY", ("AWS_SECRET_ACCESS_KEY",)),
    "aws_session_token": ("AWS_SESSION_TOKEN", ("AWS_SESSION_TOKEN",)),
    "base_url": ("BASE_URL", lambda provider: BASE_URL_ENV_BY_PROVIDER.get(provider, ())),
    "project_id": ("PROJECT_ID", ("GOOGLE_CLOUD_PROJECT", "VERTEXAI_PROJECT")),
    "provider_name": ("PROVIDER_NAME", ()),
    "region": ("REGION", (
        "GOOGLE_CLOUD_REGION", 
        "VERTEXAI_REGION", 
        "AWS_REGION", 
        "AWS_DEFAULT_REGION",
    )),
    "service_account_file": ("SERVICE_ACCOUNT_FILE", ("GOOGLE_APPLICATION_CREDENTIALS",)),
    "service_account_info": ("SERVICE_ACCOUNT_JSON", GOOGLE_VERTEX_SERVICE_ACCOUNT_JSON_ENV),
}


def get_resolution_candidates(
    provider: str,
    credential_id: str | None,
    credential_mode: str,
    suffix: str,
    global_candidates: tuple[str, ...] | Any,
    runtime_secret_entries: dict[str, str],
    *additional_global: str,
) -> tuple[str, ...]:
    """Get resolution candidates for a credential field.
    
    Args:
        provider: LLM provider name
        credential_id: Optional credential ID
        credential_mode: Credential resolution mode
        suffix: Field suffix for environment variables
        global_candidates: Global environment variable candidates
        runtime_secret_entries: Runtime secret entries
        *additional_global: Additional global candidates
        
    Returns:
        Tuple of candidate environment variable names
    """
    from src.app.llm.credentials import (
        _get_credential_env_name,
        _get_provider_default_env_name,
        CREDENTIAL_MODE_NONE,
    )
    
    if credential_mode == CREDENTIAL_MODE_NONE:
        return ()
    
    if credential_mode == "profile":
        credential_env_name = _get_credential_env_name(credential_id, suffix)
        return (credential_env_name,) if credential_env_name else ()
    
    # Build candidates list
    candidates = [_get_provider_default_env_name(provider, suffix)]
    
    # Add global candidates (handle callable case)
    if callable(global_candidates):
        candidates.extend(global_candidates(provider))
    else:
        candidates.extend(global_candidates)
    
    candidates.extend(additional_global)
    
    return tuple(candidates)
