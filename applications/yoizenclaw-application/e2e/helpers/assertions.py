"""Shared assertion helpers for E2E tests."""

from __future__ import annotations

from typing import Any


def assert_reply_received(reply: dict[str, Any] | None) -> None:
    """Assert that a non-null reply was received from the system."""
    assert reply is not None, (
        "No reply received from YoizenClaw (timeout or connection issue)"
    )
    assert isinstance(reply, dict), f"Expected dict reply, got {type(reply).__name__}"


def assert_reply_success(reply: dict[str, Any]) -> None:
    """Assert the reply indicates a successful chat response."""
    assert_reply_received(reply)

    kind = reply.get("kind")
    assert kind == "reply", f"Expected kind='reply', got '{kind}'. Full reply: {reply}"

    assert reply.get("success") is True, (
        f"Expected success=True. Error: {reply.get('error')}. Full reply: {reply}"
    )


def assert_reply_error(reply: dict[str, Any]) -> None:
    """Assert the reply is an error response (agent not found, etc)."""
    assert_reply_received(reply)

    kind = reply.get("kind")
    assert kind in ("reply", "error"), f"Expected kind='reply' or 'error', got '{kind}'"


def assert_chat_response_fields(data: dict[str, Any]) -> None:
    """Assert the chat response data has all required fields."""
    required = {
        "chat_id",
        "agent_id",
        "response",
        "turn_number",
        "session_id",
        "timestamp",
    }
    missing = required - set(data.keys())
    assert not missing, f"Chat response missing fields: {missing}"


def assert_chat_response_content(
    reply: dict[str, Any],
    *,
    expected_keywords: list[str] | None = None,
    min_length: int = 1,
) -> None:
    """Assert the chat response has meaningful content, optionally checking keywords."""
    assert_reply_success(reply)

    data = reply.get("data", {})
    response_text = data.get("response", "")

    assert len(response_text) >= min_length, (
        f"Response too short ({len(response_text)} chars, expected >= {min_length}). "
        f"Response: '{response_text[:200]}'"
    )

    if expected_keywords:
        lower_response = response_text.lower()
        for keyword in expected_keywords:
            assert keyword.lower() in lower_response, (
                f"Expected '{keyword}' in response. Response: '{response_text[:300]}'"
            )


def assert_health_ok(resp_json: dict[str, Any]) -> None:
    """Assert the health endpoint returns a valid response."""
    assert resp_json.get("status") in ("ok", "degraded"), (
        f"Expected status 'ok' or 'degraded', got '{resp_json.get('status')}'"
    )
    assert "dependencies" in resp_json, "Missing 'dependencies' in health response"


def assert_cloud_event_valid(envelope: dict[str, Any]) -> None:
    """Assert a CloudEvents envelope has all required fields."""
    required_fields = {
        "specversion",
        "id",
        "source",
        "type",
        "resource",
        "time",
        "traceid",
        "tenant",
        "accountid",
        "idempotencykey",
    }
    missing = required_fields - set(envelope.keys())
    assert not missing, f"CloudEvent missing required fields: {missing}"

    transport = envelope.get("transport")
    assert isinstance(transport, dict), "transport must be a dict"
    assert "protocol" in transport, "transport missing 'protocol'"
    assert "depth" in transport, "transport missing 'depth'"


def assert_session_isolation(
    response_a: dict[str, Any],
    response_b: dict[str, Any],
) -> None:
    """Assert two session responses belong to different sessions."""
    assert response_a.get("session_id") != response_b.get("session_id"), (
        "Sessions should be different"
    )
