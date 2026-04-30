"""NATS message trace context propagator.

Provides functions to inject and extract W3C Trace Context from NATS
message headers for distributed tracing across NATS messaging.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from opentelemetry.trace.propagation import get_current_span
from opentelemetry import context as otel_context

if TYPE_CHECKING:
    from opentelemetry.trace import Context

logger = logging.getLogger(__name__)

# Create a singleton propagator instance
_propagator = TraceContextTextMapPropagator()


def inject_trace_context(headers: dict[str, str]) -> dict[str, str]:
    """Inject current trace context into NATS message headers.
    
    Injects the traceparent and tracestate headers according to W3C spec.
    This allows trace context to propagate across NATS messages.
    
    Args:
        headers: Dictionary to inject trace context into.
        
    Returns:
        The same headers dictionary with trace context injected.
        
    Example:
        >>> headers = {"content-type": "application/json"}
        >>> inject_trace_context(headers)
        >>> print(headers)
        {'content-type': 'application/json', 'traceparent': '00-abc123...def456-01'}
    """
    try:
        _propagator.inject(headers)
        logger.debug("Trace context injected into NATS headers")
        return headers
    except Exception as e:
        logger.warning(f"Failed to inject trace context into NATS headers: {e}")
        return headers


def extract_trace_context(headers: dict[str, str]) -> Context:
    """Extract trace context from NATS message headers.
    
    Extracts traceparent and tracestate headers and creates a Context
    that can be used to create child spans linked to the incoming trace.
    
    Args:
        headers: Dictionary containing NATS message headers.
        
    Returns:
        Context with extracted trace context (or empty context if invalid/missing).
        
    Example:
        >>> headers = {'traceparent': '00-abc123...def456-01'}
        >>> context = extract_trace_context(headers)
        >>> # Use context to create child spans
        >>> with tracer.start_as_current_span("process_message", context=context):
        ...     pass
    """
    try:
        context = _propagator.extract(headers)
        current_span = get_current_span(context)
        if current_span and current_span.get_span_context().is_valid:
            logger.debug("Trace context extracted from NATS headers")
        return context
    except Exception as e:
        logger.warning(f"Failed to extract trace context from NATS headers: {e}")
        return otel_context.get_current()


def get_traceparent_header() -> dict[str, str] | None:
    """Get the current trace context as W3C traceparent header value.
    
    Returns:
        Dictionary with traceparent header if valid context exists, None otherwise.
    """
    try:
        carrier = {}
        inject_trace_context(carrier)
        if "traceparent" in carrier:
            return {"traceparent": carrier["traceparent"]}
        return None
    except Exception as e:
        logger.warning(f"Failed to get traceparent header: {e}")
        return None


def create_nats_headers_with_trace(
    existing_headers: dict[str, str] | None = None,
) -> dict[str, str]:
    """Create NATS headers dictionary with trace context injected.
    
    Args:
        existing_headers: Optional existing headers to include.
        
    Returns:
        Headers dictionary with trace context.
    """
    headers = dict(existing_headers) if existing_headers else {}
    return inject_trace_context(headers)


def extract_context_from_nats_message(message_headers: dict[str, str] | None) -> Context:
    """Extract trace context from NATS message headers safely.
    
    Args:
        message_headers: Headers from a NATS message (may be None).
        
    Returns:
        Context with extracted trace or current context if None/invalid.
    """
    if not message_headers:
        return otel_context.get_current()
    return extract_trace_context(message_headers)
