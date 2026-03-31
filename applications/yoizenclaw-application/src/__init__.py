"""YoizenClaw package root.

The package exposes legacy module-level shortcuts lazily so importing
``src`` does not eagerly import the full runtime graph.
"""

from __future__ import annotations

from importlib import import_module
from types import ModuleType
from typing import Any

__version__ = "0.1.0"

_LAZY_MODULES: dict[str, str] = {
    "entities": "src.domain.entities",
    "agents": "src.application.agents",
    "memory": "src.application.memory",
    "llm": "src.application.llm",
    "database": "src.infrastructure.database",
    "llm_providers": "src.infrastructure.llm_providers",
    "http": "src.interfaces.http",
    "websocket": "src.interfaces.websocket",
    "config": "src.shared.config",
    "logging": "src.shared.logging",
    "utils": "src.shared.utils",
}

__all__ = list(_LAZY_MODULES)


def __getattr__(name: str) -> Any:
    """Resolve legacy package shortcuts on demand."""

    module_path = _LAZY_MODULES.get(name)
    if module_path is None:
        raise AttributeError(f"module 'src' has no attribute '{name}'")

    module = import_module(module_path)
    globals()[name] = module
    return module


def __dir__() -> list[str]:
    """Return the module namespace for interactive use."""

    return sorted({*globals(), *_LAZY_MODULES})
