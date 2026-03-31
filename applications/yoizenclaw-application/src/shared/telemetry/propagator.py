"""W3C Trace Context propagation utilities.

Provides functions to inject and extract trace context from HTTP headers
and message carriers using the W3C Trace Context standard.
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


def inject_trace_context(carrier: dict[str, str]) -> dict[str, str]:
    """Inject current trace context into a carrier (e.g., HTTP headers).
    
    Injects the traceparent and tracestate headers according to W3C spec.
    
    Args:
        carrier: Dictionary to inject headers into (e.g., HTTP headers dict).
        
    Returns:
        The same carrier with trace context injected.
        
    Example:
        >>> headers = {}
        >>> inject_trace_context(headers)
        >>> print(headers)
        {'traceparent': '00-abc123...def456-01'}
    """
    try:
        _propagator.inject(carrier)
        logger.debug("Trace context injected into carrier")
        return carrier
    except Exception as e:
        logger.warning(f"Failed to inject trace context: {e}")
        return carrier


def extract_trace_context(carrier: dict[str, str]) -> Context:
    """Extract trace context from a carrier (e.g., HTTP headers).
    
    Extracts traceparent and tracestate headers and creates a Context.
    
    Args:
        carrier: Dictionary containing headers (e.g., HTTP request headers).
        
    Returns:
        Context with extracted trace context (or empty context if invalid/missing).
        
    Example:
        >>> headers = {'traceparent': '00-abc123...def456-01'}
        >>> context = extract_trace_context(headers)
        >>> # Use context to create child spans
    """
    try:
        context = _propagator.extract(carrier)
        current_span = get_current_span(context)
        if current_span and current_span.get_span_context().is_valid:
            logger.debug("Trace context extracted from carrier")
        return context
    except Exception as e:
        logger.warning(f"Failed to extract trace context: {e}")
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


def extract_from_headers(headers: dict[str, str]) -> Context:
    """Alias for extract_trace_context for HTTP headers.
    
    Args:
        headers: HTTP headers dictionary.
        
    Returns:
        Context with extracted trace context.
    """
    return extract_trace_context(headers)


def inject_into_headers(headers: dict[str, str]) -> dict[str, str]:
    """Alias for inject_trace_context for HTTP headers.
    
    Args:
        headers: HTTP headers dictionary.
        
    Returns:
        Headers with trace context injected.
    """
    return inject_trace_context(headers)


def get_current_trace_id() -> str | None:
    """Get the current trace ID as hex string.
    
    Returns:
        Trace ID if a valid span context exists, None otherwise.
    """
    from opentelemetry import trace
    
    current_span = trace.get_current_span()
    if current_span:
        span_context = current_span.get_span_context()
        if span_context.is_valid:
            return format(span_context.trace_id, "032x")
    return None


def get_current_span_id() -> str | None:
    """Get the current span ID as hex string.
    
    Returns:
        Span ID if a valid span context exists, None otherwise.
    """
    from opentelemetry import trace
    
    current_span = trace.get_current_span()
    if current_span:
        span_context = current_span.get_span_context()
        if span_context.is_valid:
            return format(span_context.span_id, "016x")
    return None


def get_current_trace_flags() -> int | None:
    """Get the current trace flags.
    
    Returns:
        Trace flags if a valid span context exists, None otherwise.
    """
    from opentelemetry import trace
    
    current_span = trace.get_current_span()
    if current_span:
        span_context = current_span.get_span_context()
        if span_context.is_valid:
            return span_context.trace_flags
    return None
