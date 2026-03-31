"""Shared decorators for YoizenClaw.

Provides reusable decorators for cross-cutting concerns like
tracing, logging, and error handling.
"""

from src.shared.decorators.trace import trace

__all__ = ["trace"]
