"""NATS tracing helper to eliminate boilerplate code."""

from __future__ import annotations

import time
from typing import Any, Callable

from nats.aio.msg import Msg
from opentelemetry import trace

from src.utils.telemetry.metrics import record_nats_message, record_nats_duration


class TracedNatsHandler:
    """Context manager for NATS message handling with tracing and metrics.

    Eliminates repetitive boilerplate for:
    - Span creation
    - Attribute setting
    - Metrics recording
    - Error handling

    Usage:
        with TracedNatsHandler(tracer, "span.name", subject, message) as handler:
            # Process message
            handler.set_attribute("custom.attr", value)
    """

    def __init__(
        self,
        tracer: trace.Tracer,
        span_name: str,
        subject: str,
        message: Msg,
    ) -> None:
        self.tracer = tracer
        self.span_name = span_name
        self.subject = subject
        self.message = message
        self.start_time = time.time()
        self.span = None

    def __enter__(self) -> "TracedNatsHandler":
        self.span = self.tracer.start_span(self.span_name)

        # Set common NATS attributes
        self.span.set_attribute("messaging.system", "nats")
        self.span.set_attribute("messaging.destination", self.subject)
        self.span.set_attribute("messaging.operation", "consume")
        self.span.set_attribute("nats.subject", self.subject)

        if self.message.reply:
            self.span.set_attribute("nats.reply_to", self.message.reply)

        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        duration = time.time() - self.start_time
        duration_ms = duration * 1000

        if exc_type is None:
            # Success case
            record_nats_message(self.subject, "consume", "success")
            self.span.set_attribute("messaging.duration_ms", duration_ms)
            self.span.set_status(trace.StatusCode.OK)
        else:
            # Error case
            record_nats_message(self.subject, "consume", "error")
            self.span.record_exception(exc_val)
            self.span.set_attribute("messaging.duration_ms", duration_ms)
            self.span.set_attribute("error", True)
            self.span.set_attribute("error.message", str(exc_val))
            self.span.set_status(trace.StatusCode.ERROR, str(exc_val))

    def set_attribute(self, key: str, value: Any) -> None:
        """Set a custom attribute on the span."""
        if self.span:
            self.span.set_attribute(key, value)
