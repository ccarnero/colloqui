"""Prompt loader utilities for runtime-managed prompt templates."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from src.utils.config.runtime_paths import get_runtime_prompts_dir


class PromptLoadError(RuntimeError):
    """Raised when a prompt template cannot be resolved from disk."""


class _SafeFormatDict(dict):
    """dict subclass that returns '{key}' for missing keys during format_map."""

    def __missing__(self, key: str) -> str:
        return f"{{{key}}}"


class PromptLoader:
    """Load prompt templates from the runtime prompts directory."""

    def __init__(self, prompts_dir: str | Path | None = None) -> None:
        base_dir = prompts_dir if prompts_dir is not None else get_runtime_prompts_dir()
        self._prompts_dir = Path(base_dir).expanduser().resolve()

    def reload_all(self) -> None:
        """Compatibility hook for callers that expect prompt reload support."""

    def get(self, name: str) -> str:
        """Return the prompt contents for the given logical prompt name."""
        candidate = self._build_prompt_path(name)
        if not candidate.exists() or not candidate.is_file():
            raise PromptLoadError(f"Prompt '{name}' not found in {self._prompts_dir}")
        return candidate.read_text(encoding="utf-8").strip()

    def render(self, name: str, **context: Any) -> str:
        """Render a prompt template with simple named placeholders."""
        template = self.get(name)
        safe_context = _SafeFormatDict(context)
        return template.format_map(safe_context)

    def _build_prompt_path(self, name: str) -> Path:
        normalized_name = name.strip().replace("\\", "/").strip("/")
        if not normalized_name:
            raise PromptLoadError("Prompt name cannot be empty")
        prompt_path = self._prompts_dir / normalized_name
        if prompt_path.suffix:
            return prompt_path
        return prompt_path.with_suffix(".txt")


__all__ = ["PromptLoadError", "PromptLoader"]

