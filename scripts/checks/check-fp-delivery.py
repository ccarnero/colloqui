#!/usr/bin/env python3
"""Check the repository's tool-neutral manual-loop integration.

The repository deliberately inherits tool and model choices from the active
global profile. This checker validates project structure and any explicit local
Codex overrides; it cannot prove that a global profile or provider resolved.
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from pathlib import Path
from typing import Any


ROLE_NAMES = ("fp-dev", "fp-qa", "fp-reviewer", "fp-architect")
ROLE_SANDBOX = {
    "fp-dev": "workspace-write",
    "fp-qa": "workspace-write",
    "fp-reviewer": "read-only",
    "fp-architect": "read-only",
}
SUPPORTED_REASONING_EFFORTS = frozenset(
    {"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"}
)
PROJECT_CONFIG_KEYS = frozenset({"model", "model_reasoning_effort", "agents"})
AGENT_DEFAULT_KEYS = frozenset(
    {"enabled", "default_subagent_model", "default_subagent_reasoning_effort"}
)
ROLE_CONFIG_KEYS = frozenset(
    {
        "name",
        "description",
        "model",
        "model_reasoning_effort",
        "sandbox_mode",
        "developer_instructions",
    }
)
REQUIRED_REPOSITORY_FILES = (
    "AGENTS.md",
    "CLAUDE.md",
    "opencode.json",
    ".claude/settings.json",
    ".claude/commands/manual-loop.md",
    ".claude/commands/build-console.md",
    "manual-loops-templates/README.md",
    "manual-loops-templates/spec-simple-template.md",
    "manual-loops-templates/spec-canonical-template.md",
    "DOCS/guides/manual-loop.md",
    "DOCS/guides/agent-roles.md",
    "DOCS/guides/manual-loop-fp-delivery.md",
    "DOCS/v_next/manual-loop-fp-delivery.md",
)


def _validate_optional_model(table: dict[str, Any], role: str) -> list[str]:
    errors: list[str] = []
    if "model" in table:
        model = table["model"]
        if not isinstance(model, str) or not model.strip():
            errors.append(f"{role} model must be a non-empty provider-owned model name")
        # Model identifiers are provider-owned opaque values. The checker can
        # validate their shape, but only a live tool can prove support.

    if "model_reasoning_effort" in table:
        effort = table["model_reasoning_effort"]
        if not isinstance(effort, str) or effort not in SUPPORTED_REASONING_EFFORTS:
            errors.append(f"{role} selects an unsupported reasoning effort: {effort!r}")
    return errors


def validate_codex_config(
    config: dict[str, Any], role_configs: dict[str, dict[str, Any]], codex_dir: Path
) -> list[str]:
    """Validate project inheritance and optional local role overrides.

    An empty project table is the intended configuration: comments document the
    inheritance decision while global profiles provide models and agents. A
    project setting or standalone role file, when deliberately added, must pass
    the structural checks below.
    """

    del codex_dir  # retained in the pure API for useful caller diagnostics
    errors: list[str] = []
    if not isinstance(config, dict):
        return ["project Codex config must parse as a TOML table"]
    unexpected = set(config) - PROJECT_CONFIG_KEYS
    if unexpected:
        errors.append(
            "project Codex config contains unsupported settings: "
            f"{', '.join(sorted(unexpected))}"
        )

    if "model" in config and (not isinstance(config["model"], str) or not config["model"].strip()):
        errors.append("project model must be a non-empty provider-owned model name")
    if "model_reasoning_effort" in config:
        effort = config["model_reasoning_effort"]
        if not isinstance(effort, str) or effort not in SUPPORTED_REASONING_EFFORTS:
            errors.append(f"project selects an unsupported reasoning effort: {effort!r}")
    defaults = config.get("agents")
    if defaults is not None:
        if not isinstance(defaults, dict):
            errors.append("project agents settings must be a TOML table")
        else:
            unexpected_defaults = set(defaults) - AGENT_DEFAULT_KEYS
            if unexpected_defaults:
                errors.append(
                    "project agents settings contain unsupported keys: "
                    f"{', '.join(sorted(unexpected_defaults))}"
                )
            if "enabled" in defaults and not isinstance(defaults["enabled"], bool):
                errors.append("project agents.enabled must be a boolean")
            if "default_subagent_model" in defaults and (
                not isinstance(defaults["default_subagent_model"], str)
                or not defaults["default_subagent_model"].strip()
            ):
                errors.append("project default_subagent_model must be a non-empty model name")
            if "default_subagent_reasoning_effort" in defaults:
                effort = defaults["default_subagent_reasoning_effort"]
                if not isinstance(effort, str) or effort not in SUPPORTED_REASONING_EFFORTS:
                    errors.append(f"project selects an unsupported default reasoning effort: {effort!r}")

    for role, role_config in role_configs.items():
        if role not in ROLE_NAMES:
            errors.append(f"unsupported local Codex role override: {role}")
            continue
        if not isinstance(role_config, dict):
            errors.append(f"{role} role override must be a TOML table")
            continue
        required = {"name", "description", "developer_instructions", "sandbox_mode"}
        missing = required - set(role_config)
        if missing:
            errors.append(f"{role} role override is missing settings: {', '.join(sorted(missing))}")
        unexpected_role = set(role_config) - ROLE_CONFIG_KEYS
        if unexpected_role:
            errors.append(
                f"{role} contains unsupported settings: {', '.join(sorted(unexpected_role))}"
            )
        if "name" in role_config and role_config["name"] != role:
            errors.append(f"{role} name must be {role!r}")
        for field in ("description", "developer_instructions"):
            if field in role_config and (
                not isinstance(role_config[field], str) or not role_config[field].strip()
            ):
                errors.append(f"{role} requires non-empty {field} when provided")
        errors.extend(_validate_optional_model(role_config, role))
        if "fallback" in role_config or "fallback_model" in role_config:
            errors.append(f"{role} declares an automatic provider/model fallback")
        if "sandbox_mode" in role_config and role_config["sandbox_mode"] != ROLE_SANDBOX[role]:
            errors.append(
                f"{role} sandbox_mode must be {ROLE_SANDBOX[role]!r} "
                f"(found {role_config['sandbox_mode']!r})"
            )
    return errors


def validate_codex_dir(codex_dir: Path) -> list[str]:
    """Read and parse a Codex config directory, then validate its data."""

    config_path = codex_dir / "config.toml"
    if not config_path.is_file():
        return [f"missing Codex config: {config_path}"]
    try:
        config = tomllib.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        return [f"cannot parse {config_path}: {exc}"]

    role_configs: dict[str, dict[str, Any]] = {}
    agents_dir = codex_dir / "agents"
    if agents_dir.is_dir():
        for role_path in sorted(agents_dir.glob("*.toml")):
            role = role_path.stem
            if role not in ROLE_NAMES:
                role_configs[role] = {}
                continue
            try:
                role_configs[role] = tomllib.loads(role_path.read_text(encoding="utf-8"))
            except (OSError, tomllib.TOMLDecodeError) as exc:
                return [f"cannot parse {role_path}: {exc}"]
    return validate_codex_config(config, role_configs, codex_dir)


def validate_claude_contract(engine: str, implementer: str = "", reviewer_alias: str = "") -> list[str]:
    """Validate the Claude slash adapter without requiring local role copies."""

    del implementer, reviewer_alias  # compatibility parameters for existing callers
    normalized_engine = " ".join(engine.split())
    errors: list[str] = []
    for phrase in ("AGENTS.md", "DOCS/guides/manual-loop.md", "$ARGUMENTS"):
        if phrase not in normalized_engine:
            errors.append(f"manual-loop adapter is missing shared contract reference: {phrase!r}")
    if "Launch the `implementer` agent" in normalized_engine:
        errors.append("manual-loop adapter must not embed a local implementation route")
    if "model:" in normalized_engine or "model =" in normalized_engine:
        errors.append("manual-loop adapter must not declare a model")
    return errors


def validate_manual_loop_contract(engine: str, roles: str) -> list[str]:
    """Check the shared context, retry, gate, and review invariants."""

    normalized_engine = " ".join(engine.split()).lower()
    normalized_roles = " ".join(roles.split()).lower()
    errors: list[str] = []
    for phrase in (
        "full agents.md",
        "task packet",
        "max 4 implementation attempts",
        "same error appearing in 2 consecutive",
        "regression tests",
        "qa edits finish before any gate runs",
        "changed code or task artifacts invalidate gates and both reviews",
        "explicitly delegate its role packet",
        "never silently skip qa or independent review",
        "two independent",
        "staged and unstaged diffs",
    ):
        if phrase not in normalized_engine and phrase not in normalized_roles:
            errors.append(f"shared manual-loop contract is missing invariant: {phrase!r}")
    return errors


def _parse_json(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return None, f"cannot parse {path}: {exc}"
    if not isinstance(value, dict):
        return None, f"{path} must contain a JSON object"
    return value, None


def validate_local_claude_role(content: str, path: Path) -> list[str]:
    """Validate an optional native role adapter without duplicating the engine."""

    errors: list[str] = []
    if "AGENTS.md" not in content and "DOCS/guides/agent-roles.md" not in content:
        errors.append(f"local Claude role must reference the shared role contract: {path}")
    if "## Per-task cycle" in content or (
        "## Invariants" in content and "manual-loop" in content.lower()
    ):
        errors.append(f"local Claude role must not recreate the shared manual-loop engine: {path}")
    return errors


def validate_opencode_config(config: dict[str, Any]) -> list[str]:
    """Validate optional OpenCode tuning while forbidding Superpowers."""

    errors: list[str] = []
    plugin = config.get("plugin")
    if plugin is not None and (
        not isinstance(plugin, list) or any(not isinstance(item, str) for item in plugin)
    ):
        errors.append("opencode.json plugin must be a list of strings when provided")
    if isinstance(plugin, list) and any("superpowers" in item.lower() for item in plugin):
        errors.append("opencode.json must not declare the Superpowers plugin")
    if "model" in config and (
        not isinstance(config["model"], str) or not config["model"].strip()
    ):
        errors.append("opencode.json model must be a non-empty value when provided")
    return errors


def validate_claude_settings(config: dict[str, Any]) -> list[str]:
    """Validate optional Claude model tuning without requiring a local model."""

    if "model" in config and (
        not isinstance(config["model"], str) or not config["model"].strip()
    ):
        return [".claude/settings.json model must be a non-empty value when provided"]
    return []


def validate_repository(root: Path, codex_dir: Path) -> list[str]:
    """Return errors for repository docs plus the selected Codex directory."""

    errors: list[str] = []
    for relative in REQUIRED_REPOSITORY_FILES:
        if not (root / relative).is_file():
            errors.append(f"missing repository integration file: {root / relative}")

    def read(relative: str) -> str:
        path = root / relative
        return path.read_text(encoding="utf-8") if path.is_file() else ""

    engine = read(".claude/commands/manual-loop.md")
    errors.extend(validate_claude_contract(engine))
    if "@AGENTS.md" not in read("CLAUDE.md"):
        errors.append("CLAUDE.md must explicitly import @AGENTS.md")

    opencode_path = root / "opencode.json"
    opencode, parse_error = _parse_json(opencode_path)
    if parse_error:
        errors.append(parse_error)
    elif opencode is not None:
        errors.extend(validate_opencode_config(opencode))

    settings_path = root / ".claude/settings.json"
    settings, parse_error = _parse_json(settings_path)
    if parse_error:
        errors.append(parse_error)
    elif settings is not None:
        errors.extend(validate_claude_settings(settings))

    local_agent_dir = root / ".claude/agents"
    if local_agent_dir.is_dir():
        for path in sorted(local_agent_dir.glob("*.md")):
            content = path.read_text(encoding="utf-8")
            errors.extend(validate_local_claude_role(content, path))

    canonical_engine = read("DOCS/guides/manual-loop.md")
    canonical_roles = read("DOCS/guides/agent-roles.md")
    errors.extend(validate_manual_loop_contract(canonical_engine, canonical_roles))
    normalized_canonical_engine = " ".join(canonical_engine.split()).lower()
    for phrase in (
        "global configuration",
        "project configuration",
        "requested and observed model",
        "reviewers no weaker",
        "Max 4 implementation attempts",
        "staged AND unstaged diffs",
        "TWO independent",
    ):
        if " ".join(phrase.split()).lower() not in normalized_canonical_engine:
            errors.append(f"manual-loop guide is missing integration invariant: {phrase!r}")
    for phrase in (
        "Implementation (fp-dev)",
        "Quality assurance (fp-qa)",
        "Architecture advice (fp-architect)",
        "Independent review (fp-reviewer)",
        "Automatic rejections",
    ):
        if phrase not in canonical_roles:
            errors.append(f"agent-roles guide is missing contract section: {phrase!r}")
    if any("gpt-" in read(path) for path in (
        "DOCS/guides/manual-loop.md",
        "DOCS/guides/agent-roles.md",
        "DOCS/guides/manual-loop-fp-delivery.md",
        "DOCS/v_next/manual-loop-fp-delivery.md",
    )):
        errors.append("shared delivery documentation must not pin a model")
    proposal = read("DOCS/v_next/manual-loop-fp-delivery.md")
    if "Status: superseded" not in proposal or "current shared procedure" not in proposal:
        errors.append("future FP proposal is not marked as superseded with a current-guide pointer")

    errors.extend(validate_codex_dir(codex_dir))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, help="repository root (defaults to this script's repository)")
    parser.add_argument("--codex-dir", type=Path, help="Codex directory to validate (for staged config)")
    args = parser.parse_args(argv)
    root = args.root or Path(__file__).resolve().parents[2]
    codex_dir = args.codex_dir or (root / ".codex")
    errors = validate_repository(root, codex_dir)
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print(f"PASS: tool-neutral manual-loop integration validated ({codex_dir})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
