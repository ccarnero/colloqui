"""NATS bridge for runtime config, job commands, and chat.

wdocs-compliant rewrite: uses evt.{tenant}.yoizenclaw.{action}.v1 subjects,
CloudEvents envelopes, depth tracking, and Claim Check for large payloads.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import sys
from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from nats.aio.client import Client as NATS
from nats.aio.msg import Msg
from opentelemetry import trace

from src.jobs.domain.entities import (
    JobDefinition,
    JobEventPayload,
    JobSyncPayload,
    JobTriggerPayload,
)
from src.jobs.scheduler import get_job_scheduler
from src.shared.claim_check.resolver import check_payload_size, store_payload
from src.shared.config.settings import bootstrap_settings
from src.shared.depth.tracker import (
    DepthExceededError,
    enforce_depth_limit,
    increment_depth,
)
from src.shared.telemetry.metrics import record_nats_message, record_nats_duration
from src.shared.telemetry.nats_propagator import (
    create_nats_headers_with_trace,
    extract_trace_context,
    inject_trace_context,
)

shared_types_path = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "shared", "types", "python"
)
if shared_types_path not in sys.path:
    sys.path.insert(0, os.path.abspath(shared_types_path))

from cloudevent_envelope import (
    CloudEventEnvelope,
    build_internal_agent_envelope,
    validate_envelope,
)
from envelope import EnvelopeSource
from nats_helpers import wrap_error_reply, wrap_reply
import subjects as shared_subjects

logger = logging.getLogger(__name__)

RUNTIME_JOB_QUEUE = "yoizenclaw-jobs"
DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 15.0
AGENT_ID = "yoizenclaw-runtime"


def _json_dumps(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload).encode("utf-8")


def _json_loads(data: bytes) -> dict[str, Any]:
    value = json.loads(data.decode("utf-8"))
    if not isinstance(value, dict):
        raise ValueError("NATS payload must be a JSON object")
    return value


def _unwrap_event_data(raw: dict[str, Any]) -> dict[str, Any]:
    if raw.get("kind") == "event" and "data" in raw:
        data = raw["data"]
        if isinstance(data, dict):
            return data
    return raw


def _unwrap_command_data(raw: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if raw.get("kind") == "command" and "data" in raw:
        data = raw["data"]
        envelope_id = raw.get("id", "unknown")
        if isinstance(data, dict):
            return data, envelope_id
    return raw, "unknown"


def _extract_action_from_subject(subject: str) -> str | None:
    """Extract the action from wdocs-compliant subjects.
    
    Admin-service format (8 parts): evt.tenant.producer.domain.channel.provider.kind.v1
    Example: 'evt.acme.yoizenclaw-admin-service.automation.yoizenclaw.internal.agent_published.v1'
    Returns: 'agent_published'
    
    Runtime format (6 parts): evt.tenant.producer.kind.v1
    Example: 'evt.acme.yoizenclaw.online.v1'
    Returns: 'online'
    """
    parts = subject.split(".")
    if parts[0] != "evt":
        return None
        
    # Handle admin-service subjects (8 parts)
    if len(parts) >= 8:
        # kind is at position 6 (0-indexed: evt[0].tenant[1].producer[2].domain[3].channel[4].provider[5].kind[6].v1[7])
        return parts[6]
    
    # Handle runtime subjects (5 parts): evt.tenant.producer.kind.v1
    elif len(parts) >= 5:
        # kind is at position 3 (0-indexed: evt[0].tenant[1].producer[2].kind[3].v1[4])
        return parts[3]
    
    return None


def _is_configured_check() -> bool:
    try:
        from src.interfaces.websocket import RuntimeConfigStore
        return RuntimeConfigStore.get_optional() is not None
    except Exception:
        return False


class RuntimeNatsBridge:
    """NATS runtime bridge with wdocs-compliant subjects and CloudEvents."""

    def __init__(self, nats_url: str, instance_id: str | None = None) -> None:
        self._instance_id = instance_id or self._build_instance_id()
        self._nats = NATS()
        self._nats_url = nats_url
        self._heartbeat_interval_seconds = float(
            bootstrap_settings.RUNTIME_HEARTBEAT_INTERVAL_SECONDS,
        )
        self._heartbeat_task: asyncio.Task[None] | None = None
        self._tracer = trace.get_tracer(__name__)
        self._tenant_id: str = bootstrap_settings.TENANT_ID
        self._object_store: Any = None

    def _subject(self, action: str) -> str:
        return shared_subjects.build_subject(self._tenant_id, action)

    async def start(self) -> None:
        """Connect and subscribe to tenant-scoped wildcard subject."""

        if self._nats.is_connected:
            return

        try:
            from src.shared.logging.structured import (
                init_structured_logging,
                set_tenant_context,
            )

            set_tenant_context(self._tenant_id)
            init_structured_logging(logger)

            await self._nats.connect(
                servers=[self._nats_url], name=self._instance_id
            )

            # Listen for admin-service events (agent_published, agent_unpublished, etc.)
            admin_wildcard = f"evt.{self._tenant_id}.yoizenclaw-admin-service.automation.yoizenclaw.internal.>"
            await self._nats.subscribe(admin_wildcard, cb=self._dispatch_message)
            
            # Also listen for direct yoizenclaw events (online, chat_respond, etc.)
            runtime_wildcard = f"evt.{self._tenant_id}.yoizenclaw.>"
            await self._nats.subscribe(runtime_wildcard, cb=self._dispatch_message)

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
        """Route inbound messages to the correct handler by wdocs-compliant kind."""
        action = _extract_action_from_subject(message.subject)
        if action is None:
            logger.warning(
                "Cannot extract action from subject: %s",
                message.subject,
            )
            return

        tenant = shared_subjects.extract_tenant_from_subject(message.subject)
        if tenant is not None:
            logger.debug("Processing message for tenant: %s", tenant)

        raw = _json_loads(message.data)

        if not validate_envelope(raw):
            logger.warning(
                "Rejecting message on %s: invalid CloudEvents envelope",
                message.subject,
            )
            return

        try:
            enforce_depth_limit(raw)
        except DepthExceededError as exc:
            logger.warning(
                "Rejecting message on %s: %s",
                message.subject,
                str(exc),
            )
            return

        data = raw.get("data", raw)
        
        if action == "agent_action":
            action_type = data.get("action_type")
            if action_type == "config_sync":
                await self._handle_config_sync_dispatch(message, data, raw)
            elif action_type == "jobs_sync":
                await self._handle_jobs_sync_dispatch(message, data, raw)
            elif action_type == "job_trigger":
                await self._handle_job_trigger_dispatch(message, data, raw)
            else:
                logger.warning("Unknown action_type '%s' for agent_action", action_type)
        
        elif action == "agent_outbound":
            await self._handle_chat_respond_dispatch(message, data, raw)
        
        elif action == "agent_observation":
            await self._handle_job_event_dispatch(message, data, raw)
        
        elif action == "agent_published":
            await self._handle_agent_published_dispatch(message, data, raw)
        
        elif action == "agent_unpublished":
            await self._handle_agent_unpublished_dispatch(message, data, raw)
        
        elif action == "online":
            await self._handle_runtime_online_dispatch(message, data, raw)
        
        else:
            dispatch_legacy: dict[str, Any] = {
                "config_sync": self._handle_config_sync_dispatch,
                "jobs_sync": self._handle_jobs_sync_dispatch,
                "job_trigger": self._handle_job_trigger_dispatch,
                "job.event.emit": self._handle_job_event_dispatch,
                "chat_respond": self._handle_chat_respond_dispatch,
            }
            handler = dispatch_legacy.get(action)
            if handler is not None:
                logger.warning("Using legacy dispatch for action: %s", action)
                await handler(message, data, raw)
            else:
                logger.warning("No handler for action: %s", action)

    async def _handle_agent_published_dispatch(
        self,
        message: Msg,
        data: dict[str, Any],
        _envelope: dict[str, Any],
    ) -> None:
        """Handle agent published events from admin-service."""
        import time

        start_time = time.perf_counter()
        headers = dict(message.headers) if message.headers else {}
        context = extract_trace_context(headers)

        with self._tracer.start_as_current_span(
            "nats.consume.agent_published",
            context=context,
            kind=trace.SpanKind.CONSUMER,
        ) as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", message.subject)
            span.set_attribute("messaging.operation", "consume")
            span.set_attribute("nats.subject", message.subject)
            span.set_attribute("nats.message_size", len(message.data))

            try:
                event_payload = data.get("payload", data)
                agent_id = event_payload.get("agentId")
                agent_name = event_payload.get("name")
                published_at = event_payload.get("publishedAt")
                
                logger.info(
                    "Agent published: %s (%s) at %s",
                    agent_name,
                    agent_id,
                    published_at,
                )

                # TODO: Update local agent cache when agent management is implemented

                duration = time.perf_counter() - start_time
                record_nats_message(message.subject, "consume", "success")
                record_nats_duration(duration, message.subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
            except Exception as error:
                record_nats_message(message.subject, "consume", "error")
                span.record_exception(error)
                span.set_status(trace.StatusCode.ERROR, str(error))
                logger.exception(
                    "Failed to handle agent published event: %s", error
                )

    async def _handle_agent_unpublished_dispatch(
        self,
        message: Msg,
        data: dict[str, Any],
        _envelope: dict[str, Any],
    ) -> None:
        """Handle agent unpublished events from admin-service."""
        import time

        start_time = time.perf_counter()
        headers = dict(message.headers) if message.headers else {}
        context = extract_trace_context(headers)

        with self._tracer.start_as_current_span(
            "nats.consume.agent_unpublished",
            context=context,
            kind=trace.SpanKind.CONSUMER,
        ) as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", message.subject)
            span.set_attribute("messaging.operation", "consume")
            span.set_attribute("nats.subject", message.subject)
            span.set_attribute("nats.message_size", len(message.data))

            try:
                event_payload = data.get("payload", data)
                agent_id = event_payload.get("agentId")
                agent_name = event_payload.get("name")
                
                logger.info(
                    "Agent unpublished: %s (%s)",
                    agent_name,
                    agent_id,
                )

                # TODO: Update local agent cache when agent management is implemented

                duration = time.perf_counter() - start_time
                record_nats_message(message.subject, "consume", "success")
                record_nats_duration(duration, message.subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
            except Exception as error:
                record_nats_message(message.subject, "consume", "error")
                span.record_exception(error)
                span.set_status(trace.StatusCode.ERROR, str(error))
                logger.exception(
                    "Failed to handle agent unpublished event: %s", error
                )

    async def _handle_runtime_online_dispatch(
        self,
        message: Msg,
        data: dict[str, Any],
        _envelope: dict[str, Any],
    ) -> None:
        """Handle runtime online heartbeat events."""
        import time

        start_time = time.perf_counter()
        headers = dict(message.headers) if message.headers else {}
        context = extract_trace_context(headers)

        with self._tracer.start_as_current_span(
            "nats.consume.runtime_online",
            context=context,
            kind=trace.SpanKind.CONSUMER,
        ) as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", message.subject)
            span.set_attribute("messaging.operation", "consume")
            span.set_attribute("nats.subject", message.subject)
            span.set_attribute("nats.message_size", len(message.data))

            try:
                # Debug: log full data structure
                logger.info(f"[DEBUG] Runtime online raw data: {data}")
                
                # Extract from nested payload (CloudEvents envelope structure)
                payload_data = data.get("payload", data)
                runtime_id = payload_data.get("instance_id", "unknown")
                configured = payload_data.get("configured", False)
                status = "configured" if configured else "not_configured"
                
                logger.info(
                    "Runtime online event: %s status=%s",
                    runtime_id,
                    status,
                )

                # TODO: Track runtime status when runtime monitoring is implemented

                duration = time.perf_counter() - start_time
                record_nats_message(message.subject, "consume", "success")
                record_nats_duration(duration, message.subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
            except Exception as error:
                record_nats_message(message.subject, "consume", "error")
                span.record_exception(error)
                span.set_status(trace.StatusCode.ERROR, str(error))
                logger.exception(
                    "Failed to handle runtime online event: %s", error
                )

    async def _handle_config_sync_dispatch(
        self,
        message: Msg,
        data: dict[str, Any],
        _envelope: dict[str, Any],
    ) -> None:
        import time

        start_time = time.perf_counter()
        headers = dict(message.headers) if message.headers else {}
        context = extract_trace_context(headers)
        subject = self._subject("config_sync")

        with self._tracer.start_as_current_span(
            "nats.consume",
            context=context,
            kind=trace.SpanKind.CONSUMER,
        ) as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", subject)
            span.set_attribute("messaging.operation", "consume")
            span.set_attribute("nats.subject", message.subject)
            span.set_attribute("nats.message_size", len(message.data))

            try:
                await self._apply_config_sync(
                    files=data.get("files"),
                    delete_paths=data.get("deletePaths"),
                )
                logger.info("Applied runtime config sync")

                duration = time.perf_counter() - start_time
                record_nats_message(subject, "consume", "success")
                record_nats_duration(duration, subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
            except Exception as error:
                record_nats_message(subject, "consume", "error")
                span.record_exception(error)
                span.set_status(trace.StatusCode.ERROR, str(error))
                logger.exception(
                    "Failed to apply runtime config sync: %s", error
                )

    async def _apply_config_sync(
        self, files: Any, delete_paths: Any
    ) -> None:
        from src.application.memory.memory_sync import apply_runtime_config_sync
        await apply_runtime_config_sync(
            files=_coerce_sync_files(files),
            delete_paths=_coerce_delete_paths(delete_paths),
        )

    async def _handle_jobs_sync_dispatch(
        self,
        message: Msg,
        data: dict[str, Any],
        _envelope: dict[str, Any],
    ) -> None:
        import time

        scheduler = get_job_scheduler()
        if scheduler is None:
            logger.error("Cannot apply jobs sync: scheduler not initialized")
            return

        start_time = time.perf_counter()
        headers = dict(message.headers) if message.headers else {}
        context = extract_trace_context(headers)
        subject = self._subject("jobs_sync")

        with self._tracer.start_as_current_span(
            "nats.consume",
            context=context,
            kind=trace.SpanKind.CONSUMER,
        ) as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", subject)
            span.set_attribute("messaging.operation", "consume")
            span.set_attribute("nats.subject", message.subject)
            span.set_attribute("nats.message_size", len(message.data))

            try:
                jobs = [
                    JobDefinition(**job_data)
                    for job_data in data.get("jobs", [])
                ]
                result = await scheduler.sync_jobs(
                    JobSyncPayload(
                        jobs=jobs,
                        replace_all=bool(data.get("replace_all", True)),
                        deleted_job_ids=_coerce_delete_paths(
                            data.get("deleted_job_ids")
                        ),
                    )
                )
                logger.info("Applied jobs sync: %s", result)

                duration = time.perf_counter() - start_time
                record_nats_message(subject, "consume", "success")
                record_nats_duration(duration, subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
            except Exception as error:
                record_nats_message(subject, "consume", "error")
                span.record_exception(error)
                span.set_status(trace.StatusCode.ERROR, str(error))
                logger.exception("Failed to apply jobs sync: %s", error)

    async def _handle_job_trigger_dispatch(
        self,
        message: Msg,
        data: dict[str, Any],
        _envelope: dict[str, Any],
    ) -> None:
        import time

        scheduler = get_job_scheduler()
        if scheduler is None:
            logger.error("Cannot trigger job: scheduler not initialized")
            return

        start_time = time.perf_counter()
        headers = dict(message.headers) if message.headers else {}
        context = extract_trace_context(headers)
        subject = self._subject("job_trigger")

        with self._tracer.start_as_current_span(
            "nats.consume",
            context=context,
            kind=trace.SpanKind.CONSUMER,
        ) as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", subject)
            span.set_attribute("messaging.operation", "consume")
            span.set_attribute("nats.subject", message.subject)
            span.set_attribute("nats.message_size", len(message.data))

            try:
                trigger_payload = JobTriggerPayload(**data)
                execution = await scheduler.trigger_job(
                    trigger_payload.job_id,
                    trigger_payload.event_payload,
                    trigger_payload.execution_id,
                )
                if execution is None:
                    logger.warning(
                        "Received trigger for unknown/disabled job %s",
                        trigger_payload.job_id,
                    )

                duration = time.perf_counter() - start_time
                record_nats_message(subject, "consume", "success")
                record_nats_duration(duration, subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_attribute("job.id", trigger_payload.job_id)
                span.set_status(trace.StatusCode.OK)
            except Exception as error:
                record_nats_message(subject, "consume", "error")
                span.record_exception(error)
                span.set_status(trace.StatusCode.ERROR, str(error))
                logger.exception(
                    "Failed to trigger job via NATS: %s", error
                )

    async def _handle_job_event_dispatch(
        self,
        message: Msg,
        data: dict[str, Any],
        _envelope: dict[str, Any],
    ) -> None:
        import time

        scheduler = get_job_scheduler()
        if scheduler is None:
            logger.error("Cannot emit job event: scheduler not initialized")
            return

        start_time = time.perf_counter()
        headers = dict(message.headers) if message.headers else {}
        context = extract_trace_context(headers)
        subject = self._subject("job_trigger")

        with self._tracer.start_as_current_span(
            "nats.consume",
            context=context,
            kind=trace.SpanKind.CONSUMER,
        ) as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", subject)
            span.set_attribute("messaging.operation", "consume")
            span.set_attribute("nats.subject", message.subject)
            span.set_attribute("nats.message_size", len(message.data))

            try:
                event_payload = JobEventPayload(**data)
                triggered = await scheduler.emit_event(
                    event_payload.event_name,
                    event_payload.event_payload,
                )
                logger.info(
                    "Emitted event '%s' to %d job(s)",
                    event_payload.event_name,
                    triggered,
                )

                duration = time.perf_counter() - start_time
                record_nats_message(subject, "consume", "success")
                record_nats_duration(duration, subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_attribute("event.name", event_payload.event_name)
                span.set_attribute("event.jobs_triggered", triggered)
                span.set_status(trace.StatusCode.OK)
            except Exception as error:
                record_nats_message(subject, "consume", "error")
                span.record_exception(error)
                span.set_status(trace.StatusCode.ERROR, str(error))
                logger.exception(
                    "Failed to emit job event via NATS: %s", error
                )

    async def _handle_chat_respond_dispatch(
        self,
        message: Msg,
        data: dict[str, Any],
        envelope: dict[str, Any],
    ) -> None:
        import time

        if not message.reply:
            logger.warning("Ignoring chat request without reply subject")
            return

        start_time = time.perf_counter()
        headers = dict(message.headers) if message.headers else {}
        context = extract_trace_context(headers)
        subject = self._subject("chat_respond")
        envelope_id = envelope.get("id", "unknown")

        with self._tracer.start_as_current_span(
            "nats.consume",
            context=context,
            kind=trace.SpanKind.CONSUMER,
        ) as span:
            span.set_attribute("messaging.system", "nats")
            span.set_attribute("messaging.destination", subject)
            span.set_attribute("messaging.operation", "consume")
            span.set_attribute("nats.subject", message.subject)
            span.set_attribute("nats.message_size", len(message.data))
            span.set_attribute("nats.has_reply", True)

            try:
                from src.interfaces.http.handlers.chat import (
                    ChatRequest,
                    generate_chat_reply,
                )

                response = await generate_chat_reply(ChatRequest(**data))
                reply = wrap_reply(
                    envelope_id,
                    EnvelopeSource.CLAW,
                    response.model_dump(),
                )

                reply_headers = create_nats_headers_with_trace()
                await self._nats.publish(
                    message.reply,
                    _json_dumps(reply),
                    headers=reply_headers,
                )

                duration = time.perf_counter() - start_time
                record_nats_message(subject, "consume", "success")
                record_nats_duration(duration, subject)
                span.set_attribute("messaging.duration_ms", duration * 1000)
                span.set_status(trace.StatusCode.OK)
            except Exception as error:
                record_nats_message(subject, "consume", "error")
                span.record_exception(error)
                span.set_status(trace.StatusCode.ERROR, str(error))
                logger.exception(
                    "Failed to process chat request via NATS: %s", error
                )
                error_reply = wrap_error_reply(
                    envelope_id,
                    EnvelopeSource.CLAW,
                    "CHAT_ERROR",
                    str(error),
                )
                try:
                    reply_headers = create_nats_headers_with_trace()
                    await self._nats.publish(
                        message.reply,
                        _json_dumps(error_reply),
                        headers=reply_headers,
                    )
                except Exception:
                    pass

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
        """Build a CloudEvents envelope for outbound publish.

        Applies Claim Check for payloads exceeding the threshold.
        """
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

    async def publish_execution_status(
        self, payload: dict[str, Any]
    ) -> None:
        """Publish job execution status with CloudEvents envelope."""
        import time

        if not self._nats.is_connected:
            logger.debug(
                "Skipping execution status publish; NATS bridge not connected"
            )
            return

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
                    _json_dumps(envelope),
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
        import time

        if not self._nats.is_connected:
            logger.debug(
                "Skipping runtime event publish; NATS bridge not connected"
            )
            return

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
                    _json_dumps(envelope),
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
                    _json_dumps(asdict(envelope)),
                    headers=headers,
                )
                record_nats_message(subject, "publish", "success")
                span.set_status(trace.StatusCode.OK)
            except Exception as e:
                span.record_exception(e)
                span.set_status(trace.StatusCode.ERROR, str(e))
                raise

    async def _heartbeat_loop(self) -> None:
        while self._nats.is_connected:
            try:
                await asyncio.sleep(self._heartbeat_interval_seconds)
                await self._publish_runtime_online()
            except asyncio.CancelledError:
                break
            except Exception as error:
                logger.exception(
                    "Failed to publish runtime heartbeat: %s", error
                )

    @staticmethod
    def _build_instance_id() -> str:
        hostname = socket.gethostname()
        pid = os.getpid()
        return f"yoizenclaw-{hostname}-{pid}"


async def start_nats_bridge(nats_url: str) -> RuntimeNatsBridge:
    """Start the global NATS bridge."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.nats_bridge is None:
        container.nats_bridge = RuntimeNatsBridge(nats_url=nats_url)

    await container.nats_bridge.start()
    return container.nats_bridge


async def stop_nats_bridge() -> None:
    """Stop the global NATS bridge."""
    from src.shared.di import AppContainer

    container = AppContainer.get()
    if container.nats_bridge is None:
        return

    await container.nats_bridge.stop()
    container.nats_bridge = None


def get_nats_bridge() -> RuntimeNatsBridge | None:
    """Return the active global NATS bridge."""
    from src.shared.di import AppContainer

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


def _coerce_sync_files(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []

    normalized: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue

        path = item.get("path")
        content = item.get("content")
        if isinstance(path, str) and isinstance(content, str):
            normalized.append({"path": path, "content": content})

    return normalized


def _coerce_delete_paths(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    return [item for item in value if isinstance(item, str)]
