"""Shared in-process session memory compatibility store."""

from __future__ import annotations

from typing import Any

SESSION_MEMORY_STORE: dict[str, dict[str, dict[str, Any]]] = {}
