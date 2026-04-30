"""Tests for skill execution helper compatibility behavior."""

from __future__ import annotations

from src.app.agents._skill_execution import resolve_skill
from src.app.agents.prompt_references import PromptReferenceResult


def test_resolve_skill_accepts_prompt_reference_result_object() -> None:
    skills = [
        {
            "id": "skill-default",
            "name": "default",
            "description": "Default",
            "enabled": True,
            "instructions": "Default instructions",
        },
        {
            "id": "skill-negociar",
            "name": "negociar",
            "description": "Negotiation",
            "enabled": True,
            "instructions": "Negotiate",
        },
    ]
    refs = PromptReferenceResult(
        cleaned_text="Use negotiation",
        skill_references=("negociar",),
        tool_references=(),
    )
    warnings: list[str] = []

    selected = resolve_skill(None, skills, refs, warnings)

    assert selected is not None
    assert selected["name"] == "negociar"
    assert warnings == []


def test_resolve_skill_accepts_legacy_dict_prompt_references() -> None:
    skills = [
        {
            "id": "skill-default",
            "name": "default",
            "description": "Default",
            "enabled": True,
            "instructions": "Default instructions",
        }
    ]
    refs = {
        "skill_references": ("missing-skill",),
        "tool_references": (),
    }
    warnings: list[str] = []

    selected = resolve_skill(None, skills, refs, warnings)

    assert selected is not None
    assert selected["name"] == "default"
    assert any("Referenced skill 'missing-skill'" in warning for warning in warnings)
