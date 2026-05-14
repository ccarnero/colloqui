"""NATS bridge for runtime config, job commands, and chat.

Simplified version: delegates message handling to separate handler modules.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import os
import socket
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from nats.errors import NotJSMessageError
from nats.aio.client import Client as NATS
from nats.aio.msg import Msg
from nats.js.api import RetentionPolicy, StreamConfig
from nats.js.errors import NotFoundError
from opentelemetry import trace

from src.services.domain.entities import (
    JobDefinition,
    JobEventPayload,
    JobSyncPayload,
    JobTriggerPayload,
)
from src.services.scheduler import get_job_scheduler
from src.messaging.handlers.agents import (
    AgentCache,
    handle_agent_published,
    handle_agent_unpublished,
)
from src.messaging.handlers.config import handle_config_sync, handle_jobs_sync
from src.messaging.handlers.jobs import handle_job_trigger, handle_job_event
from src.messaging.handlers.chat import handle_chat_respond
from src.messaging.handlers.memories import (
    handle_memory_proposals_approve,
    handle_memory_proposals_list,
    handle_memory_proposals_reject,
)
from src.messaging.handlers.executions import handle_execution_requested
from src.messaging.handlers.session_chat import (
    handle_chat_respond as handle_session_chat_respond,
)
from src.messaging.utils import (
    extract_action_from_subject,
    json_dumps,
    json_loads,
)
from src.utils.claim_check.resolver import check_payload_size, store_payload
from src.utils.config.settings import bootstrap_settings
from src.utils.depth.tracker import (
    DepthExceededError,
    enforce_depth_limit,
    increment_depth,
)
from src.utils.telemetry.metrics import record_nats_message, record_nats_duration
from src.utils.telemetry.nats_propagator import (
    create_nats_headers_with_trace,
    extract_trace_context,
    inject_trace_context,
)

shared_types_path = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "packages", "shared-python"
)
if shared_types_path not in sys.path:
    sys.path.insert(0, os.path.abspath(shared_types_path))

from cloudevent_envelope import (
    CloudEventEnvelope,
    build_internal_agent_envelope,
    validate_envelope,
)
from envelope import EnvelopeSource
import subjects as shared_subjects

logger = logging.getLogger(__name__)

RUNTIME_JOB_QUEUE = "yoizenclaw-jobs"
DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 15.0
DEFAULT_RUNTIME_ONLINE_LOG_INTERVAL_SECONDS = 60.0
AGENT_ID = "yoizenclaw-runtime"


def _is_configured_check() -> bool:
    try:
        from src.utils.config.runtime_config_store import RuntimeConfigStore

        return RuntimeConfigStore.get_optional() is not None
    except Exception:
        return False


def _resolve_runtime_online_log_interval_seconds() -> float:
    raw_value = os.getenv("RUNTIME_ONLINE_LOG_INTERVAL_SECONDS")
    if raw_value is None:
        return DEFAULT_RUNTIME_ONLINE_LOG_INTERVAL_SECONDS

    try:
        interval = float(raw_value)
    except ValueError:
        logger.warning(
            "Invalid RUNTIME_ONLINE_LOG_INTERVAL_SECONDS='%s'; using %.1fs",
            raw_value,
            DEFAULT_RUNTIME_ONLINE_LOG_INTERVAL_SECONDS,
        )
        return DEFAULT_RUNTIME_ONLINE_LOG_INTERVAL_SECONDS

    if interval <= 0:
        logger.warning(
            "RUNTIME_ONLINE_LOG_INTERVAL_SECONDS must be positive; using %.1fs",
            DEFAULT_RUNTIME_ONLINE_LOG_INTERVAL_SECONDS,
        )
        return DEFAULT_RUNTIME_ONLINE_LOG_INTERVAL_SECONDS

    return interval


def _is_session_chat_request(data: dict[str, Any]) -> bool:
    """Check if this is a session-based chat request (only has the 6 required fields)."""
    required_fields = {
        "chat_id",
        "agent_id",
        "message",
        "turn_number",
        "session_id",
        "timestamp",
    }

    # Check if all required fields are present
    if not all(field in data for field in required_fields):
        return False

    # Check if there are no extra fields that would indicate legacy format
    # Allow metadata but not agent_profile, type, context, etc.
    disallowed_fields = {
        "agent_profile",
        "type",
        "context",
        "memory",
        "qualification_data",
    }
    extra_fields = set(data.keys()) - required_fields - {"metadata"}

    return not any(field in extra_fields for field in disallowed_fields)


class RuntimeNatsBridge:
    """NATS runtime bridge with wdocs-compliant subjects and CloudEvents."""

    def __init__(self, nats_url: str, instance_id: str | None = None) -> None:
        self._instance_id = instance_id or self._build_instance_id()
        self._nats = NATS()
        self._nats_url = nats_url
        self._heartbeat_interval_seconds = float(
            bootstrap_settings.RUNTIME_HEARTBEAT_INTERVAL_SECONDS,
        )
        self._runtime_online_log_interval_seconds = (
            _resolve_runtime_online_log_interval_seconds()
        )
        self._runtime_online_log_state: dict[str, tuple[str, float]] = {}
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._tracer = trace.get_tracer(__name__)
        self._tenant_id: str = bootstrap_settings.TENANT_ID
        self._object_store: Any = None
        self._agent_cache = AgentCache()

    def _subject(self, action: str) -> str:
        return shared_subjects.build_subject(self._tenant_id, action)

    def _is_jetstream_message(self, message: Msg) -> bool:
        """Return whether the message includes JetStream metadata safely."""
        try:
            _ = message.metadata
            return True
        except NotJSMessageError:
            return False

    async def _ack_if_jetstream(self, message: Msg) -> None:
        """Acknowledge a message when it supports JetStream ack semantics."""
        try:
            await message.ack()
        except (NotJSMessageError, AttributeError, TypeError):
            return

    async def _nak_if_jetstream(self, message: Msg) -> None:
        """Negative-ack a message when it supports JetStream ack semantics."""
        try:
            await message.nak()
        except (NotJSMessageError, AttributeError, TypeError):
            return

    def _should_fallback_to_core(self, error: Exception) -> bool:
        """Return True when JetStream subscription should fallback to core NATS."""
        normalized = str(error).lower()
        return (
            "stream not found" in normalized
            or "consumer is already bound to a subscription" in normalized
        )

    async def _ensure_tenant_ingress_stream(
        self,
        js: Any,
        stream_name: str,
    ) -> bool:
        """Best-effort idempotent ensure of the per-tenant ingress stream.

        On a freshly provisioned tenant the `INGRESS-<TENANT>` stream is
        created lazily by upstream services (`yoizenclaw-admin-service`,
        `yoizenclaw-runtime-gateway`). When the runtime pod boots before
        any of those have published, the stream simply does not exist and
        every `js.subscribe(..., stream=...)` call raises `NotFoundError`.

        We try to create the stream with the canonical platform defaults
        (`evt.<tenant>.>`, Limits retention, 7d max age, 256MB max bytes).
        Idempotent — a pre-existing stream surfaces as "stream name
        already in use" which is swallowed. Any other broker error is
        logged at WARNING and the caller falls back to core NATS.

        Returns True when the stream is guaranteed to exist on the broker.
        """
        try:
            await js.stream_info(stream_name)
            return True
        except NotFoundError:
            pass
        except Exception as info_error:
            logger.warning(
                "Could not query stream '%s' info (%s); attempting create",
                stream_name,
                str(info_error),
            )

        subject_pattern = f"evt.{self._tenant_id}.>"
        config = StreamConfig(
            name=stream_name,
            subjects=[subject_pattern],
            retention=RetentionPolicy.LIMITS,
            max_age=7 * 24 * 60 * 60 * 1_000_000_000,
            max_bytes=256 * 1024 * 1024,
        )
        try:
            await js.add_stream(config=config)
            logger.info(
                "Created tenant ingress stream '%s' (subjects=%s)",
                stream_name,
                subject_pattern,
            )
            return True
        except Exception as add_error:
            normalized = str(add_error).lower()
            if "already in use" in normalized:
                return True
            logger.warning(
                "Failed to ensure tenant ingress stream '%s': %s",
                stream_name,
                str(add_error),
            )
            return False

    async def _subscribe_via_jetstream_with_fallback(
        self,
        js: Any,
        *,
        subject: str,
        stream_name: str,
        durable: str,
    ) -> None:
        """Subscribe via JetStream; fall back to core NATS on missing stream.

        Mirrors the existing behaviour applied to the admin-service
        wildcard and extends it to every JetStream subscription created
        by the bridge so a missing/late `INGRESS-<TENANT>` stream never
        crashes the runtime lifespan.
        """
        try:
            await js.subscribe(
                subject=subject,
                cb=self._dispatch_message,
                durable=durable,
                stream=stream_name,
                manual_ack=True,
            )
            logger.info(
                "Subscribed via JetStream on %s (stream=%s, durable=%s)",
                subject,
                stream_name,
                durable,
            )
        except Exception as js_error:
            if not self._should_fallback_to_core(js_error):
                logger.error(
                    "Failed to create JetStream consumer for %s: %s",
                    subject,
                    str(js_error),
                )
                raise
            logger.warning(
                "JetStream consumer unavailable for stream '%s' (%s). "
                "Falling back to core NATS subscription on %s",
                stream_name,
                str(js_error),
                subject,
            )
            await self._nats.subscribe(subject, cb=self._dispatch_message)

    async def start(self) -> None:
        """Connect and subscribe to tenant-scoped wildcard subject."""

        if self._nats.is_connected:
            return

        try:
            from src.utils.logging.structured import (
                init_structured_logging,
                set_tenant_context,
            )

            set_tenant_context(self._tenant_id)
            init_structured_logging(logger)

            await self._nats.connect(servers=[self._nats_url], name=self._instance_id)

            admin_wildcard = (
                f"evt.{self._tenant_id}.yoizenclaw-admin-service."
                f"automation.yoizenclaw.internal.>"
            )
            gateway_wildcard = (
                f"evt.{self._tenant_id}.yoizenclaw-runtime-gateway."
                f"automation.yoizenclaw.internal.>"
            )
            stream_name = f"INGRESS-{self._tenant_id.upper()}"

            js = self._nats.jetstream()
            if inspect.isawaitable(js):
                js = await js

            await self._ensure_tenant_ingress_stream(js, stream_name)

            await self._subscribe_via_jetstream_with_fallback(
                js,
                subject=admin_wildcard,
                stream_name=stream_name,
                durable=f"runtime-admin-events-{self._tenant_id}",
            )

            runtime_wildcard = f"evt.{self._tenant_id}.yoizenclaw.>"
            await self._nats.subscribe(runtime_wildcard, cb=self._dispatch_message)

            await self._subscribe_via_jetstream_with_fallback(
                js,
                subject=gateway_wildcard,
                stream_name=stream_name,
                durable=f"runtime-execution-events-{self._tenant_id}",
            )

            await self._publish_runtime_online()
            self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
            logger.info(
                "NATS bridge started for %s on %s and %s",
                self._instance_id,
                admin_wildcard,
                runtime_wildcard,
            )

        except Exception as e:
            logger.error("Failed to start NATS bridge: %s", str(e))
            raise

    async def _dispatch_message(self, message: Msg) -> None:
        """Route inbound messages to the correct handler."""
        is_jetstream_message = self._is_jetstream_message(message)

        action = extract_action_from_subject(message.subject)
        if action is None:
            logger.warning(
                "Cannot extract action from subject: %s",
                message.subject,
            )
            # Acknowledge JetStream message if it has metadata (nack to requeue)
            if is_jetstream_message:
                await self._nak_if_jetstream(message)
            return

        tenant = shared_subjects.extract_tenant_from_subject(message.subject)
        if tenant is not None:
            logger.debug("Processing message for tenant: %s", tenant)

        raw = json_loads(message.data)

        if not validate_envelope(raw):
            logger.warning(
                "Rejecting message on %s: invalid CloudEvents envelope",
                message.subject,
            )
            # Acknowledge JetStream message (we've decided to reject it)
            if is_jetstream_message:
                await self._ack_if_jetstream(message)
            return

        try:
            enforce_depth_limit(raw)
        except DepthExceededError as exc:
            logger.warning(
                "Rejecting message on %s: %s",
                message.subject,
                str(exc),
            )
            # Acknowledge JetStream message (we've decided to reject it)
            if is_jetstream_message:
                await self._ack_if_jetstream(message)
            return

        data = raw.get("data", raw)

        # Unwrap build_data_payload wrapper if present
        if isinstance(data, dict) and "payload" in data:
            inner = data["payload"]
            if isinstance(inner, dict):
                data = inner
            elif isinstance(inner, list):
                # Config sync sends list payload
                data = inner

        try:
            # Route to appropriate handler
            if action == "agent_action":
                action_type = data.get("action_type")
                if action_type == "config_sync":
                    await handle_config_sync(message, data, raw)
                elif action_type == "jobs_sync":
                    await handle_jobs_sync(message, data, raw)
                elif action_type == "job_trigger":
                    await handle_job_trigger(message, data, raw)
                else:
                    logger.warning(
                        "Unknown action_type '%s' for agent_action", action_type
                    )

            elif action == "config_sync":
                await handle_config_sync(message, data, raw)

            elif action == "jobs_sync":
                await handle_jobs_sync(message, data, raw)

            elif action == "job_trigger":
                await handle_job_trigger(message, data, raw)

            elif action == "agent_outbound":
                # Check if this is a session-based chat request (only has the 6 required fields)
                is_session = _is_session_chat_request(data)

                if is_session:
                    await handle_session_chat_respond(self._nats, message, data, raw)
                else:
                    await handle_chat_respond(self._nats, message, data, raw)

            elif action == "chat_respond":
                # Admin-service playground path: evt.{tenant}.yoizenclaw-admin-service...chat_respond.v1
                is_session = _is_session_chat_request(data)

                if is_session:
                    await handle_session_chat_respond(self._nats, message, data, raw)
                else:
                    await handle_chat_respond(self._nats, message, data, raw)

            elif action == "execution_requested":
                await handle_execution_requested(self._nats, message, data, raw)

            elif action == "agent_observation":
                await handle_job_event(message, data, raw)

            elif action == "memory_proposals_list":
                await handle_memory_proposals_list(self._nats, message, data, raw)

            elif action == "memory_proposals_approve":
                await handle_memory_proposals_approve(self._nats, message, data, raw)

            elif action == "memory_proposals_reject":
                await handle_memory_proposals_reject(self._nats, message, data, raw)

            elif action == "agent_published":
                await handle_agent_published(message, data, raw, self._agent_cache)

            elif action == "agent_unpublished":
                await handle_agent_unpublished(message, data, raw, self._agent_cache)

            elif action == "online":
                await self._handle_runtime_online(message, data, raw)

            else:
                logger.warning("No handler for action: %s", action)

            # Acknowledge JetStream message after successful processing
            if is_jetstream_message:
                await self._ack_if_jetstream(message)

        except Exception as handler_error:
            logger.exception(
                "Error processing message on %s: %s", message.subject, handler_error
            )
            # Nack JetStream message to trigger redelivery
            if is_jetstream_message:
                await self._nak_if_jetstream(message)
            raise

    async def _handle_runtime_online(
        self,
        message: Msg,
        data: dict[str, Any],
        _envelope: dict[str, Any],
    ) -> None:
        """Handle runtime online heartbeat events."""
        from src.messaging._nats_tracing import TracedNatsHandler

        subject = self._subject("runtime_online")

        with TracedNatsHandler(
            self._tracer, "nats.consume.runtime_online", subject, message
        ) as handler:
            try:
                payload_data = data.get("payload", data)
                runtime_id = payload_data.get("instance_id", "unknown")
                configured = payload_data.get("configured", False)
                status = "configured" if configured else "not_configured"

                should_log, status_changed = self._should_log_runtime_online(
                    runtime_id, status
                )

                if should_log:
                    if status_changed:
                        logger.info(
                            "Runtime online status changed: %s status=%s",
                            runtime_id,
                            status,
                        )
                    else:
                        logger.info(
                            "Runtime online heartbeat: %s status=%s",
                            runtime_id,
                            status,
                        )
                else:
                    logger.debug(
                        "Runtime online heartbeat suppressed: %s status=%s",
                        runtime_id,
                        status,
                    )
            except Exception as error:
                logger.exception("Failed to handle runtime online event: %s", error)
                raise

    def _should_log_runtime_online(
        self,
        runtime_id: str,
        status: str,
    ) -> tuple[bool, bool]:
        now = time.monotonic()
        previous_state = self._runtime_online_log_state.get(runtime_id)

        if previous_state is None:
            self._runtime_online_log_state[runtime_id] = (status, now)
            return True, False

        previous_status, previous_log_at = previous_state
        status_changed = previous_status != status
        interval_elapsed = (
            now - previous_log_at >= self._runtime_online_log_interval_seconds
        )

        if status_changed or interval_elapsed:
            self._runtime_online_log_state[runtime_id] = (status, now)
            return True, status_changed

        return False, False

    async def stop(self) -> None:
        """Drain and close the NATS connection."""

        if self._heartbeat_task is not None:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
            self._heartbeat_task = None

        if not self._nats.is_connected:
            return

        await self._nats.drain()
        await self._nats.close()
        logger.info("NATS bridge stopped for %s", self._instance_id)

    async def _build_outbound_envelope(
        self,
        action: str,
        payload: dict[str, Any],
        depth: int = 0,
        causation_id: str | None = None,
    ) -> dict[str, Any]:
        """Build a CloudEvents envelope for outbound publish."""
        payload_bytes = json.dumps(payload).encode("utf-8")
        size_info = await check_payload_size(payload_bytes)

        envelope = build_internal_agent_envelope(
            tenant=self._tenant_id,
            agent_id=AGENT_ID,
            action=action,
            payload=payload,
            depth=depth,
            causation_id=causation_id,
        )
        envelope_dict = asdict(envelope)

        if not size_info["inline"]:
            if self._object_store is not None:
                ref = await store_payload(
                    self._object_store,
                    self._tenant_id,
                    envelope_dict["id"],
                    payload_bytes,
                )
                envelope_dict["data"] = {}
                envelope_dict["payload_inline"] = False
                envelope_dict["payload_ref"] = ref
            else:
                logger.warning(
                    "Object Store not available; sending large payload inline"
                )

        return envelope_dict

    async def publish_execution_status(self, payload: dict[str, Any]) -> None:
        """Publish job execution status with CloudEvents envelope."""

        if not self._nats.is_connected:
            logger.debug("Skipping execution status publish; NATS bridge not connected")
            return

        import time

        start_time = time.perf_counter()
        subject = self._subject("execution_status")

        with self._tracer.start_as_current_span("nats.publish") as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", subject)
            span.set_attribute("messaging.operation", "publish")
            span.set_attribute("nats.subject", subject)

            try:
                envelope = await self._build_outbound_envelope(
                    "execution_status", payload, depth=0
                )

                headers = create_nats_headers_with_trace()
                await self._nats.publish(
                    subject,
                    json_dumps(envelope),
                    headers=headers,
                )

                duration = time.perf_counter() - start_time
                record_nats_message(subject, "publish", "success")
                record_nats_duration(duration, subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
            except Exception as e:
                record_nats_message(subject, "publish", "error")
                span.record_exception(e)
                span.set_status(trace.StatusCode.ERROR, str(e))
                raise

    async def publish_runtime_event(
        self,
        event: str,
        payload: dict[str, Any],
    ) -> None:
        """Publish a runtime event with CloudEvents envelope and Claim Check."""

        if not self._nats.is_connected:
            logger.debug("Skipping runtime event publish; NATS bridge not connected")
            return

        import time

        start_time = time.perf_counter()
        subject = self._subject("event")

        with self._tracer.start_as_current_span("nats.publish") as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", subject)
            span.set_attribute("messaging.operation", "publish")
            span.set_attribute("nats.subject", subject)
            span.set_attribute("nats.event_type", event)

            try:
                event_payload = {"event": event, "payload": payload}
                envelope = await self._build_outbound_envelope(
                    "event", event_payload, depth=0
                )

                headers = create_nats_headers_with_trace()
                await self._nats.publish(
                    subject,
                    json_dumps(envelope),
                    headers=headers,
                )

                duration = time.perf_counter() - start_time
                record_nats_message(subject, "publish", "success")
                record_nats_duration(duration, subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
            except Exception as e:
                record_nats_message(subject, "publish", "error")
                span.record_exception(e)
                span.set_status(trace.StatusCode.ERROR, str(e))
                raise

    async def _publish_runtime_online(self) -> None:
        """Publish runtime online event with CloudEvents envelope."""
        subject = self._subject("online")

        with self._tracer.start_as_current_span("nats.publish") as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", subject)
            span.set_attribute("messaging.operation", "publish")
            span.set_attribute("nats.subject", subject)
            span.set_attribute("nats.event_type", "runtime.online")

            try:
                envelope = build_internal_agent_envelope(
                    tenant=self._tenant_id,
                    agent_id=AGENT_ID,
                    action="online",
                    payload={
                        "configured": _is_configured_check(),
                        "instance_id": self._instance_id,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                    depth=0,
                )
                headers = create_nats_headers_with_trace()
                await self._nats.publish(
                    subject,
                    json_dumps(asdict(envelope)),
                    headers=headers,
                )
                record_nats_message(subject, "publish", "success")
                span.set_status(trace.StatusCode.OK)
            except Exception as e:
                span.record_exception(e)
                span.set_status(trace.StatusCode.ERROR, str(e))
                raise

    async def _heartbeat_loop(self) -> None:
        """Keep-alive loop with automatic reconnection."""
        reconnect_delay = 5  # seconds

        while True:
            try:
                # Check if we need to reconnect
                if not self._nats.is_connected:
                    logger.warning("NATS connection lost, attempting to reconnect...")
                    try:
                        await self._nats.connect(
                            servers=[self._nats_url], name=self._instance_id
                        )
                        logger.info("NATS reconnected successfully")

                        # Re-subscribe after reconnection
                        admin_wildcard = f"evt.{self._tenant_id}.yoizenclaw-admin-service.automation.yoizenclaw.internal.>"
                        stream_name = f"INGRESS-{self._tenant_id.upper()}"

                        try:
                            js = self._nats.jetstream()
                            if inspect.isawaitable(js):
                                js = await js
                            await js.subscribe(
                                subject=admin_wildcard,
                                cb=self._dispatch_message,
                                durable=f"runtime-admin-events-{self._tenant_id}",
                                stream=stream_name,
                                manual_ack=True,
                            )
                            logger.info(
                                "Re-created JetStream consumer for admin-service "
                                "events after reconnection"
                            )
                            gateway_wildcard = (
                                f"evt.{self._tenant_id}.yoizenclaw-runtime-gateway.automation.yoizenclaw.internal.>"
                            )
                            await js.subscribe(
                                subject=gateway_wildcard,
                                cb=self._dispatch_message,
                                durable=f"runtime-execution-events-{self._tenant_id}",
                                stream=stream_name,
                                manual_ack=True,
                            )
                        except Exception as js_error:
                            if self._should_fallback_to_core(js_error):
                                logger.warning(
                                    "JetStream consumer unavailable during "
                                    "reconnect for stream '%s' (%s). Falling "
                                    "back to core NATS on %s",
                                    stream_name,
                                    str(js_error),
                                    admin_wildcard,
                                )
                                await self._nats.subscribe(
                                    admin_wildcard,
                                    cb=self._dispatch_message,
                                )
                            else:
                                logger.error(
                                    "Failed to re-create JetStream consumer "
                                    "after reconnection: %s",
                                    str(js_error),
                                )
                                raise

                        runtime_wildcard = f"evt.{self._tenant_id}.yoizenclaw.>"
                        await self._nats.subscribe(
                            runtime_wildcard, cb=self._dispatch_message
                        )
                        logger.info("Re-subscribed to NATS subjects after reconnection")
                    except Exception as e:
                        logger.error(f"Failed to reconnect to NATS: {e}")
                        await asyncio.sleep(reconnect_delay)
                        continue

                # Publish heartbeat
                if self._nats.is_connected:
                    await self._publish_runtime_online()

                await asyncio.sleep(self._heartbeat_interval_seconds)

            except asyncio.CancelledError:
                break
            except Exception as error:
                logger.exception("Failed to publish runtime heartbeat: %s", error)
                await asyncio.sleep(reconnect_delay)

    @staticmethod
    def _build_instance_id() -> str:
        hostname = socket.gethostname()
        pid = os.getpid()
        return f"yoizenclaw-{hostname}-{pid}"


async def start_nats_bridge(nats_url: str) -> RuntimeNatsBridge:
    """Start the global NATS bridge."""
    from src.utils.di import AppContainer

    container = AppContainer.get()
    if container.nats_bridge is None:
        container.nats_bridge = RuntimeNatsBridge(nats_url=nats_url)

    await container.nats_bridge.start()
    return container.nats_bridge


async def stop_nats_bridge() -> None:
    """Stop the global NATS bridge."""
    from src.utils.di import AppContainer

    container = AppContainer.get()
    if container.nats_bridge is None:
        return

    await container.nats_bridge.stop()
    container.nats_bridge = None


def get_nats_bridge() -> RuntimeNatsBridge | None:
    """Return the active global NATS bridge."""
    from src.utils.di import AppContainer

    return AppContainer.get().nats_bridge


async def publish_job_execution_status(payload: dict[str, Any]) -> None:
    """Publish a job execution status event if the bridge is active."""

    bridge = get_nats_bridge()
    if bridge is None:
        logger.debug("Skipping execution status publish; NATS bridge not started")
        return

    await bridge.publish_execution_status(payload)


async def publish_runtime_event(event: str, payload: dict[str, Any]) -> None:
    """Publish a generic runtime event if the bridge is active."""

    bridge = get_nats_bridge()
    if bridge is None:
        logger.debug("Skipping runtime event publish; NATS bridge not started")
        return

    await bridge.publish_runtime_event(event, payload)
