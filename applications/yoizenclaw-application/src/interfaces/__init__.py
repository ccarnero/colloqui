"""Interfaces layer - controllers and external interfaces."""

from __future__ import annotations

from importlib import import_module
from typing import Any

_LAZY_MODULES: dict[str, str] = {
    "http": "src.interfaces.http",
}

__all__ = list(_LAZY_MODULES)


def __getattr__(name: str) -> Any:
    """Resolve interface subpackages on demand."""

    module_path = _LAZY_MODULES.get(name)
    if module_path is None:
        raise AttributeError(f"module 'src.interfaces' has no attribute '{name}'")

    module = import_module(module_path)
    globals()[name] = module
    return module


def __dir__() -> list[str]:
    """Return the module namespace for interactive use."""

    return sorted({*globals(), *_LAZY_MODULES})
