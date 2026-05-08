"""Tests for LLMClient connector_id handling (adapter-based credentials)."""

from __future__ import annotations

from src.app.llm.llm_service import LLMClient


def test_llm_client_accepts_non_uuid_connector_id() -> None:
    """Opaque adapter IDs from admin must enable connector resolution path."""
    client = LLMClient(
        {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "connectorId": "my-adapter-slug-1",
        }
    )

    assert client._connector_id == "my-adapter-slug-1"


def test_llm_client_still_accepts_uuid_connector_id() -> None:
    uid = "0ea73ab3-6dc6-436f-a308-1eb0eccec144"
    client = LLMClient(
        {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "connector_id": uid,
        }
    )

    assert client._connector_id == uid


def test_llm_client_trims_connector_id() -> None:
    client = LLMClient(
        {
            "provider": "openai",
            "model": "gpt-4o-mini",
            "connectorId": "  trim-me  ",
        }
    )

    assert client._connector_id == "trim-me"
