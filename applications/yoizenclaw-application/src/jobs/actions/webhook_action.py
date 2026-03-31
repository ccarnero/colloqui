"""Webhook action executor with shared HTTP client."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlparse

import httpx

from src.jobs.domain.entities import JobDefinition, JobExecution

def get_webhook_client() -> httpx.AsyncClient:
    """Get or create the shared webhook HTTP client.

    Returns:
        Shared httpx.AsyncClient instance.
    """
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.webhook_client is None:
        container.webhook_client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(
                max_keepalive_connections=20,
                max_connections=100,
            ),
        )
    return container.webhook_client


async def close_webhook_client() -> None:
    """Close the shared webhook HTTP client."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.webhook_client is not None:
        await container.webhook_client.aclose()
    container.webhook_client = None


def is_valid_webhook_url(url: str) -> bool:
    """Validate webhook URL is http or https.

    Args:
        url: URL to validate.

    Returns:
        True if URL is valid http/https URL, False otherwise.
    """
    if not url:
        return False
    try:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)
    except Exception:
        return False


async def execute_webhook(
    job: JobDefinition,
    execution: JobExecution,
) -> dict[str, Any]:
    """Execute webhook action.

    Args:
        job: Job with action_type="webhook".
        execution: Execution tracking record.

    Returns:
        Dictionary with HTTP response.
    """
    url = job.action_config.get("url", "")
    if not is_valid_webhook_url(url):
        raise ValueError(f"Invalid webhook URL: {url}. Must be http or https.")

    method = job.action_config.get("method", "POST")
    headers = job.action_config.get("headers", {})
    data = job.action_config.get("data")
    if data is None:
        data = job.action_config.get("body", {})
    timeout = float(job.action_config.get("timeout", 30))

    execution.add_log(f"Making {method} request to {url}")

    client = get_webhook_client()
    if method.upper() == "GET":
        response = await client.get(url, headers=headers, timeout=timeout)
    elif method.upper() == "POST":
        response = await client.post(
            url,
            headers=headers,
            json=data,
            timeout=timeout,
        )
    elif method.upper() == "PUT":
        response = await client.put(
            url,
            headers=headers,
            json=data,
            timeout=timeout,
        )
    elif method.upper() == "DELETE":
        response = await client.delete(url, headers=headers, timeout=timeout)
    else:
        raise ValueError(f"Unsupported HTTP method: {method}")

    response.raise_for_status()

    execution.add_log(f"Webhook responded with status {response.status_code}")

    try:
        content = response.json()
    except json.JSONDecodeError:
        content = {"text": response.text}

    return {
        "status_code": response.status_code,
        "content": content,
    }
