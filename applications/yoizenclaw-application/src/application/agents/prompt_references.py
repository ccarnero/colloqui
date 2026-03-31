"""Prompt reference parsing helpers for runtime agent prompts."""

from __future__ import annotations

import re
from dataclasses import dataclass

PROMPT_REFERENCE_PATTERN = re.compile(
    r"@(?P<kind>skill|tool):(?P<name>[A-Za-z0-9_-]+)",
)


@dataclass(frozen=True)
class PromptReferenceMatch:
    """Single prompt reference token discovered in authored prompt text."""

    kind: str
    name: str


@dataclass(frozen=True)
class PromptReferenceResult:
    """Parsed prompt references and the user-visible text with refs removed."""

    cleaned_text: str
    skill_references: tuple[str, ...]
    tool_references: tuple[str, ...]


def parse_prompt_references(text: str) -> PromptReferenceResult:
    """Extract `@skill:` and `@tool:` references from authored prompt text."""

    skill_references: list[str] = []
    tool_references: list[str] = []

    def replace(match: re.Match[str]) -> str:
        kind = match.group("kind")
        name = match.group("name").strip()
        if kind == "skill":
            skill_references.append(name)
        else:
            tool_references.append(name)
        return ""

    cleaned_text = PROMPT_REFERENCE_PATTERN.sub(replace, text)
    cleaned_text = re.sub(r"[ \t]{2,}", " ", cleaned_text)
    cleaned_text = re.sub(r"\n{3,}", "\n\n", cleaned_text)

    return PromptReferenceResult(
        cleaned_text=cleaned_text.strip(),
        skill_references=tuple(skill_references),
        tool_references=tuple(tool_references),
    )