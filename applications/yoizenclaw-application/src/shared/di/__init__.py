"""Dependency Injection module for YoizenClaw.

Usage:
    from src.shared.di import get_container

    container = get_container()
    tool_registry = container.get("tool_registry")
"""

from src.shared.di.app_container import AppContainer
from src.shared.di.container import Container, get_container

__all__ = ["AppContainer", "Container", "get_container"]
