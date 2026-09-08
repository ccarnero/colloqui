#!/usr/bin/env python3
"""Enforce the project-local Codex manual-loop role policy and hash lock."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
import tomllib
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
GENERIC_CHECKER = Path(__file__).with_name("check-fp-delivery.py")
GENERIC_SPEC = importlib.util.spec_from_file_location("check_fp_delivery", GENERIC_CHECKER)
GENERIC = importlib.util.module_from_spec(GENERIC_SPEC)
assert GENERIC_SPEC and GENERIC_SPEC.loader
GENERIC_SPEC.loader.exec_module(GENERIC)

EXPECTED_CONFIG = {
    "model": "gpt-6-astra",
    "model_reasoning_effort": "medium",
    "agents": {
        "enabled": True,
        "default_subagent_model": "gpt-5.6-sol",
        "default_subagent_reasoning_effort": "medium",
    },
}
EXPECTED_ROLES = {
    "fp-dev": ("gpt-5.6-sol", "medium", "workspace-write"),
    "fp-qa": ("gpt-5.6-sol", "medium", "workspace-write"),
    "fp-architect": ("gpt-6-astra", "high", "read-only"),
    "fp-reviewer": ("gpt-6-astra", "high", "read-only"),
    "script-runner": ("gpt-5.6-luna", "low", "workspace-write"),
}
LOCKED_FILES = frozenset(
    {".codex/config.toml"}
    | {f".codex/agents/{role}.toml" for role in EXPECTED_ROLES}
)
CONTRACT_FILES = (
    "AGENTS.md",
    "DOCS/guides/manual-loop.md",
    "DOCS/guides/agent-roles.md",
)
FORBIDDEN_CLAUDE_ROLES = (
    ".claude/agents/implementer.md",
    ".claude/agents/reviewer.md",
    ".claude/agents/fp-dev.md",
    ".claude/agents/fp-qa.md",
    ".claude/agents/fp-architect.md",
    ".claude/agents/fp-reviewer.md",
    ".claude/agents/script-runner.md",
)


def validate_policy_data(
    config: dict[str, Any], role_configs: dict[str, dict[str, Any]]
) -> list[str]:
    """Validate exact project pins after generic structural validation."""

    errors: list[str] = []
    if config != EXPECTED_CONFIG:
        errors.append("project Codex config does not match the mandatory model/effort policy")

    actual_roles = set(role_configs)
    expected_roles = set(EXPECTED_ROLES)
    for role in sorted(expected_roles - actual_roles):
        errors.append(f"missing mandatory Codex role: {role}")
    for role in sorted(actual_roles - expected_roles):
        errors.append(f"unexpected project Codex role: {role}")

    for role in sorted(expected_roles & actual_roles):
        data = role_configs[role]
        model, effort, sandbox = EXPECTED_ROLES[role]
        expected = {
            "name": role,
            "model": model,
            "model_reasoning_effort": effort,
            "sandbox_mode": sandbox,
        }
        for key, value in expected.items():
            if data.get(key) != value:
                errors.append(
                    f"{role} {key} must be {value!r} (found {data.get(key)!r})"
                )
        instructions = data.get("developer_instructions", "")
        if not isinstance(instructions, str):
            errors.append(
                f"{role} requires non-empty developer_instructions when provided"
            )
            continue
        for contract in CONTRACT_FILES:
            if contract not in instructions:
                errors.append(f"{role} instructions must reference {contract}")
        if "competing orchestration loop" not in instructions:
            errors.append(f"{role} instructions must reject a competing orchestration loop")
    return errors


def validate_lock_data(lock: Any, contents: dict[str, bytes]) -> list[str]:
    """Compare supplied file bytes to the accepted lock without mutating it."""

    if not isinstance(lock, dict):
        return ["manual-loop lock must contain a JSON object"]
    if lock.get("version") != 1 or lock.get("algorithm") != "sha256":
        return ["manual-loop lock must use version 1 and sha256"]
    files = lock.get("files")
    if not isinstance(files, dict):
        return ["manual-loop lock files must be a JSON object"]

    errors: list[str] = []
    locked = set(files)
    for path in sorted(LOCKED_FILES - locked):
        errors.append(f"manual-loop lock is missing path: {path}")
    for path in sorted(locked - LOCKED_FILES):
        errors.append(f"manual-loop lock has unexpected path: {path}")
    for path in sorted(LOCKED_FILES):
        if path not in contents:
            errors.append(f"locked Codex file is missing: {path}")
            continue
        expected = files.get(path)
        actual = hashlib.sha256(contents[path]).hexdigest()
        if expected != actual:
            errors.append(f"locked Codex file drifted: {path}")
    return errors


def _read_toml(path: Path) -> tuple[dict[str, Any] | None, str | None]:
    try:
        value = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        return None, f"cannot parse {path}: {exc}"
    if not isinstance(value, dict):
        return None, f"{path} must contain a TOML table"
    return value, None


def validate_project(root: Path, codex_dir: Path | None = None) -> list[str]:
    """Read repository facts, then apply structural, policy, and lock checks."""

    selected_codex = codex_dir or (root / ".codex")
    if selected_codex.is_symlink():
        return [f"Codex directory must be a local directory: {selected_codex}"]

    agents_dir = selected_codex / "agents"
    if agents_dir.is_symlink():
        return [f"Codex agents directory must be a local directory: {agents_dir}"]

    errors = GENERIC.validate_codex_dir(selected_codex)
    config_path = selected_codex / "config.toml"
    if config_path.is_symlink():
        errors.append(f"Codex config must be a local regular file: {config_path}")
    config, parse_error = _read_toml(config_path)
    if parse_error:
        return errors + ([parse_error] if parse_error not in errors else [])

    role_configs: dict[str, dict[str, Any]] = {}
    if agents_dir.is_dir():
        for path in sorted(agents_dir.glob("*.toml")):
            if path.is_symlink() or not path.is_file():
                errors.append(f"Codex role must be a local regular file: {path}")
                continue
            value, role_error = _read_toml(path)
            if role_error:
                if role_error not in errors:
                    errors.append(role_error)
            elif value is not None:
                role_configs[path.stem] = value
    policy_errors = validate_policy_data(config or {}, role_configs)
    errors.extend(error for error in policy_errors if error not in errors)

    for relative in CONTRACT_FILES:
        if not (root / relative).is_file():
            errors.append(f"missing canonical manual-loop contract: {relative}")
    for relative in FORBIDDEN_CLAUDE_ROLES:
        if (root / relative).exists() or (root / relative).is_symlink():
            errors.append(f"retired local Claude role must remain absent: {relative}")

    lock_path = selected_codex / "manual-loop.lock.json"
    if lock_path.is_symlink():
        errors.append(f"manual-loop lock must be a local regular file: {lock_path}")
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        errors.append(f"cannot parse {lock_path}: {exc}")
        return errors

    contents: dict[str, bytes] = {}
    for relative in LOCKED_FILES:
        selected_relative = Path(relative).relative_to(".codex")
        path = selected_codex / selected_relative
        if path.is_symlink() or not path.is_file():
            if path.is_symlink():
                errors.append(f"locked Codex file must be a local regular file: {relative}")
            continue
        try:
            contents[relative] = path.read_bytes()
        except OSError as exc:
            errors.append(f"cannot read locked Codex file {relative}: {exc}")
    errors.extend(validate_lock_data(lock, contents))
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--codex-dir", type=Path)
    args = parser.parse_args(argv)
    errors = validate_project(args.root, args.codex_dir)
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print("PASS: project Codex manual-loop policy and hash lock validated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
