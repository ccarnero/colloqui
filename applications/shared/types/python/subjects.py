"""NATS subject constants and helpers for YoizenClaw runtime.

Contains legacy flat subject constants (used by nats_bridge.py) and
new wdocs-compliant tenant-scoped subject helpers.

wdocs convention: evt.{tenant}.yoizenclaw.{action}.v1
See: wdocs/docs/arquitectura/01-service-bus.md
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Legacy flat subject constants (used by nats_bridge.py)
# These will be deprecated once the bridge is fully migrated to
# tenant-scoped subjects (Phase 2.4).
# ---------------------------------------------------------------------------

CHAT_RESPOND = "yoizenclaw.chat.respond"
RUNTIME_ONLINE = "yoizenclaw.runtime.online"
RUNTIME_CONFIG_SYNC = "yoizenclaw.runtime.config.sync"
RUNTIME_JOBS_SYNC = "yoizenclaw.runtime.jobs.sync"
JOB_TRIGGER = "yoizenclaw.job.trigger"
JOB_EVENT_EMIT = "yoizenclaw.job.event.emit"
JOB_EXECUTION_STATUS = "yoizenclaw.job.execution.status"
RUNTIME_EVENT = "yoizenclaw.runtime.event"
TOOL_REQUEST = "yoizenclaw.tool.request"

# ---------------------------------------------------------------------------
# wdocs-compliant tenant-scoped subject definitions
# Convention: evt.{tenant}.yoizenclaw.{action}.v1
# ---------------------------------------------------------------------------

YOIZENCLAW_SUBJECT_PREFIX = "evt.{tenant}.yoizenclaw"

YOIZENCLAW_ACTIONS: dict[str, str] = {
    "config_sync": "config_sync.v1",
    "jobs_sync": "jobs_sync.v1",
    "job_trigger": "job_trigger.v1",
    "chat_respond": "chat_respond.v1",
    "online": "online.v1",
    "event": "event.v1",
    "agent_outbound": "agent.outbound.v1",
    "execution_status": "job.execution_status.v1",
}


def build_subject(tenant: str, action: str) -> str:
    """Build a wdocs-compliant NATS subject for a tenant and action.

    Args:
        tenant: Tenant identifier (e.g. "acme").
        action: Logical action name, must exist in YOIZENCLAW_ACTIONS.

    Returns:
        Fully qualified subject string, e.g.
        ``"evt.acme.yoizenclaw.config_sync.v1"``.

    Raises:
        KeyError: When *action* is not a known YoizenClaw action.
    """
    suffix = YOIZENCLAW_ACTIONS[action]
    return f"evt.{tenant}.yoizenclaw.{suffix}"


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
