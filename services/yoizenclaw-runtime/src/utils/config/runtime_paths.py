"""Helpers for the runtime-managed configuration directory."""

from __future__ import annotations

import os
from pathlib import Path

RUNTIME_CONFIG_DIR_ENV = "RUNTIME_CONFIG_DIR"
LEGACY_RUNTIME_CONFIG_DIR_ENV = "YOIZEN_RUNTIME_CONFIG_DIR"


def get_runtime_config_dir() -> Path:
    """Return the writable runtime config directory."""

    configured_dir = os.getenv(RUNTIME_CONFIG_DIR_ENV)
    if not configured_dir:
        configured_dir = os.getenv(LEGACY_RUNTIME_CONFIG_DIR_ENV)
    if configured_dir:
        return Path(configured_dir).expanduser().resolve()

    return (Path(__file__).resolve().parents[3] / "data" / "runtime-config").resolve()


def get_runtime_prompts_dir() -> Path:
    """Return the runtime prompts directory."""

    return get_runtime_config_dir() / "prompts"


def get_runtime_tools_dir() -> Path:
    """Return the runtime tools directory."""

    return get_runtime_config_dir() / "tools"
