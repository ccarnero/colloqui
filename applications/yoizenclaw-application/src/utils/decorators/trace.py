"""@trace decorator for manual span creation.

Provides a decorator to automatically create spans for function calls
with configurable attributes and error handling.
"""

from __future__ import annotations

import asyncio
import functools
import logging
from typing import Any, Callable, TypeVar, cast

from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode

from src.utils.telemetry.sanitizer import sanitize_attributes, sanitize_error_message

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])


def trace(
    span_name: str | None = None,
    attributes: dict[str, Any] | None = None,
    set_error_on_exception: bool = True,
    record_return_value: bool = False,
) -> Callable[[F], F]:
    """Decorator to create a span for the decorated function.
    
    Automatically creates a child span from the current context with
    the function name and optional attributes. Captures exceptions
    as span errors.
    
    Args:
        span_name: Custom span name. If None, uses function name.
        attributes: Static attributes to add to the span.
        set_error_on_exception: Whether to mark span as error on exception.
        record_return_value: Whether to record the return value as an attribute
            (use with caution - may expose sensitive data).
            
    Returns:
        Decorated function.
        
    Example:
        >>> from src.utils.decorators.trace import trace
        >>> 
        >>> @trace(span_name="process_message", attributes={"type": "chat"})
        >>> async def process_message(data: dict) -> str:
        ...     return await handle_chat(data)
    """
    def decorator(func: F) -> F:
        @functools.wraps(func)
        async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
            tracer = trace.get_tracer(__name__)
            name = span_name or func.__qualname__
            
            with tracer.start_as_current_span(name) as span:
                # Add static attributes
                if attributes:
                    safe_attrs = sanitize_attributes(attributes)
                    for key, value in safe_attrs.items():
                        span.set_attribute(key, value)
                
                # Add function info
                span.set_attribute("code.function", func.__qualname__)
                span.set_attribute("code.namespace", func.__module__)
                
                try:
                    result = await func(*args, **kwargs)
                    
                    if record_return_value:
                        # Sanitize and record return value
                        result_str = str(result)[:1000]  # Truncate
                        span.set_attribute("return_value", result_str)
                    
                    span.set_status(Status(StatusCode.OK))
                    return result
                    
                except Exception as e:
                    if set_error_on_exception:
                        span.set_status(Status(StatusCode.ERROR, str(e)))
                        span.record_exception(e)
                        # Add sanitized error message
                        span.set_attribute(
                            "error.message",
                            sanitize_error_message(str(e)),
                        )
                    raise
        
        @functools.wraps(func)
        def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
            tracer = trace.get_tracer(__name__)
            name = span_name or func.__qualname__
            
            with tracer.start_as_current_span(name) as span:
                # Add static attributes
                if attributes:
                    safe_attrs = sanitize_attributes(attributes)
                    for key, value in safe_attrs.items():
                        span.set_attribute(key, value)
                
                # Add function info
                span.set_attribute("code.function", func.__qualname__)
                span.set_attribute("code.namespace", func.__module__)
                
                try:
                    result = func(*args, **kwargs)
                    
                    if record_return_value:
                        # Sanitize and record return value
                        result_str = str(result)[:1000]  # Truncate
                        span.set_attribute("return_value", result_str)
                    
                    span.set_status(Status(StatusCode.OK))
                    return result
                    
                except Exception as e:
                    if set_error_on_exception:
                        span.set_status(Status(StatusCode.ERROR, str(e)))
                        span.record_exception(e)
                        # Add sanitized error message
                        span.set_attribute(
                            "error.message",
                            sanitize_error_message(str(e)),
                        )
                    raise
        
        # Use appropriate wrapper based on function type
        if asyncio.iscoroutinefunction(func):
            return cast(F, async_wrapper)
        return cast(F, sync_wrapper)

    return decorator


__all__ = ["trace"]
