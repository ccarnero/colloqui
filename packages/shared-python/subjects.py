"""NATS subject constants and helpers for platform-level events.

Contains legacy flat subject constants (used by nats_bridge.py) and
new wdocs-compliant tenant-scoped subject helpers.

wdocs convention: evt.{tenant}.agent-admin-service.automation.platform.internal.{action}.v1
See: wdocs/docs/arquitectura/01-service-bus.md
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Legacy flat subject constants (used by nats_bridge.py)
# These will be deprecated once the bridge is fully migrated to
# tenant-scoped subjects (Phase 2.4).
# ---------------------------------------------------------------------------

CHAT_RESPOND = "platform.chat.respond"
RUNTIME_ONLINE = "platform.runtime.online"
RUNTIME_CONFIG_SYNC = "platform.runtime.config.sync"
RUNTIME_JOBS_SYNC = "platform.runtime.jobs.sync"
JOB_TRIGGER = "platform.job.trigger"
JOB_EVENT_EMIT = "platform.job.event.emit"
JOB_EXECUTION_STATUS = "platform.job.execution.status"
RUNTIME_EVENT = "platform.runtime.event"
TOOL_REQUEST = "platform.tool.request"

# ---------------------------------------------------------------------------
# wdocs-compliant tenant-scoped subject definitions
# Convention: evt.{tenant}.agent-admin-service.automation.platform.internal.{action}.v1
# ---------------------------------------------------------------------------

PLATFORM_SUBJECT_PREFIX = "evt.{tenant}.agent-admin-service.automation.platform.internal"

PLATFORM_ACTIONS: dict[str, str] = {
    "config_sync": "config_sync.v1",
    "jobs_sync": "jobs_sync.v1",
    "job_trigger": "job_trigger.v1",
    "job.event.emit": "job.event.emit.v1",
    "chat_respond": "chat_respond.v1",
    "online": "online.v1",
    "runtime_online": "runtime.online.v1",
    "event": "event.v1",
    "agent_outbound": "agent.outbound.v1",
    "agent_published": "agent_published.v1",
    "agent_unpublished": "agent_unpublished.v1",
    "execution_status": "job.execution_status.v1",
}

AI_AGENT_GATEWAY_ACTIONS: dict[str, str] = {
    "execution_requested": "evt.{tenant}.ai-agent-gateway.automation.platform.internal.execution_requested.v1",
    "execution_started": "evt.{tenant}.ai-agent-gateway.automation.platform.internal.execution_started.v1",
    "execution_completed": "evt.{tenant}.ai-agent-gateway.automation.platform.internal.execution_completed.v1",
    "execution_failed": "evt.{tenant}.ai-agent-gateway.automation.platform.internal.execution_failed.v1",
}


def build_subject(tenant: str, action: str) -> str:
    """Build a wdocs-compliant NATS subject for a tenant and action.

    Args:
        tenant: Tenant identifier (e.g. "acme").
        action: Logical action name, must exist in PLATFORM_ACTIONS.

    Returns:
        Fully qualified subject string, e.g.
        ``"evt.acme.agent-admin-service.automation.platform.internal.config_sync.v1"``.

    Raises:
        KeyError: When *action* is not a known platform action.
    """
    suffix = PLATFORM_ACTIONS[action]
    return f"evt.{tenant}.agent-admin-service.automation.platform.internal.{suffix}"


def extract_tenant_from_subject(subject: str) -> str | None:
    """Extract the tenant identifier from a wdocs-compliant NATS subject.

    Expects subjects in the form ``evt.{tenant}.{domain}.{action}.v1``.

    Args:
        subject: The NATS subject string to parse.

    Returns:
        The tenant identifier, or ``None`` if the subject does not follow
        the wdocs convention.
    """
    parts = subject.split(".")
    if len(parts) >= 2 and parts[0] == "evt":
        return parts[1]
    return None


def build_runtime_gateway_subject(tenant: str, action: str) -> str:
    """Build a tenant-scoped subject for runtime gateway execution events."""
    template = AI_AGENT_GATEWAY_ACTIONS[action]
    return template.replace("{tenant}", tenant)
