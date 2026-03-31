"""Depth tracking for anti-loop protection (wdocs/03 compliance)."""

from .tracker import DepthExceededError, enforce_depth_limit, increment_depth

__all__ = [
    "DepthExceededError",
    "enforce_depth_limit",
    "increment_depth",
]
