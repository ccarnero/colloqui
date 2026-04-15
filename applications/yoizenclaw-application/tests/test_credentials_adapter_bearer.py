"""Tests for adapter-backed LLM credential resolution."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.app.llm.credentials import resolve_from_adapter


@pytest.mark.asyncio
async def test_resolve_from_adapter_bearer_prefers_bearer_token_key() -> None:
    """yoizenclaw-admin returns authConfig.bearerToken (not token)."""
    client = AsyncMock()
    client.get_adapter = AsyncMock(
        return_value=SimpleNamespace(
            auth_type="bearer",
            auth_config={
                "type": "bearer",
                "bearerToken": "sk-from-bearer-token-field",
            },
            base_url="https://api.openai.com/v1",
        ),
    )

    creds = await resolve_from_adapter(client, "08820923-9ee9-47bd-b892-858000364db9")

    assert creds.api_key == "sk-from-bearer-token-field"
    assert creds.base_url == "https://api.openai.com/v1"


@pytest.mark.asyncio
async def test_resolve_from_adapter_bearer_still_accepts_token_key() -> None:
    client = AsyncMock()
    client.get_adapter = AsyncMock(
        return_value=SimpleNamespace(
            auth_type="bearer",
            auth_config={"token": "sk-legacy-token"},
            base_url=None,
        ),
    )

    creds = await resolve_from_adapter(client, "adapter-1")

    assert creds.api_key == "sk-legacy-token"
