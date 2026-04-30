"""Shared helper functions for agents module."""

from __future__ import annotations

from typing import Any
from pydantic import BaseModel


def normalize_config_items(values: list[Any] | None) -> list[Any]:
    """Normalize configuration items (skills, tools) to consistent format.
    
    Converts Pydantic models to dicts and preserves other types.
    """
    normalized: list[Any] = []
    for value in values or []:
        if isinstance(value, BaseModel):
            normalized.append(value.model_dump())
        else:
            normalized.append(value)
    return normalized
