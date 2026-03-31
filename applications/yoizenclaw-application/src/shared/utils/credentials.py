"""Credential settings for LLM providers.

Moved from llm.py to break circular import with llm_providers.py.
"""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class CredentialSettings:
    api_key: str = ""
    app_title: str | None = None
    app_url: str | None = None
    aws_access_key_id: str | None = None
    aws_profile_name: str | None = None
    aws_secret_access_key: str | None = None
    aws_session_token: str | None = None
    base_url: str | None = None
    project_id: str | None = None
    provider_name: str | None = None
    region: str | None = None
    service_account_file: str | None = None
    service_account_info: dict[str, Any] | None = None
