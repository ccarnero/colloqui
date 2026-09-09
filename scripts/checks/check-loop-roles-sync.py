#!/usr/bin/env python3
"""G19 — the manual-loop roles are ONE text per role, identical in Codex and Claude Code.

Compares `developer_instructions` of `.codex/agents/<codex>.toml` with the body (front
matter stripped) of `.claude/agents/<claude>.md`. Fails on any difference and names the
pair, so the two engines cannot drift. It syncs; it does not freeze: edit a role in either
place, copy it to the other, and the check is green again.

Replaces (2026-09-09) the SHA-256 lock + policy checker that pinned bytes, models and a
mandatory role set, and that forbade the Claude Code agents this loop runs on.
"""

from __future__ import annotations

import re
import sys
try:
    import tomllib
except ModuleNotFoundError:  # Python < 3.11
    import tomli as tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PAIRS = (
    (".codex/agents/fp-dev.toml", ".claude/agents/implementer.md"),
    (".codex/agents/fp-reviewer.toml", ".claude/agents/reviewer.md"),
)
# Every Codex role, paired or not, must be a well-formed role file: the shape Codex loads, nothing about which model.
ROLE_KEYS = ("name", "description", "model", "model_reasoning_effort", "sandbox_mode", "developer_instructions")
SANDBOXES = ("read-only", "workspace-write")
FRONT_MATTER = re.compile(r"\A---\n.*?\n---\n\s*", re.S)


def claude_body(text: str) -> str:
    return FRONT_MATTER.sub("", text, count=1).strip()


def codex_instructions(text: str) -> str | None:
    data = tomllib.loads(text)
    value = data.get("developer_instructions")
    return value.strip() if isinstance(value, str) else None


def shape_errors(root: Path) -> list[str]:
    errors: list[str] = []
    agents = root / ".codex" / "agents"
    for path in sorted(agents.glob("*.toml")) if agents.is_dir() else []:
        rel = path.relative_to(root)
        try:
            data = tomllib.loads(path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as exc:
            errors.append(f"cannot parse {rel}: {exc}")
            continue
        for key in ROLE_KEYS:
            if not isinstance(data.get(key), str) or not data[key].strip():
                errors.append(f"{rel}: missing or empty {key}")
        if data.get("name") != path.stem:
            errors.append(f"{rel}: name {data.get('name')!r} must equal the file stem {path.stem!r}")
        if data.get("sandbox_mode") not in SANDBOXES:
            errors.append(f"{rel}: sandbox_mode must be one of {SANDBOXES} (found {data.get('sandbox_mode')!r})")
    return errors


def compare(root: Path) -> list[str]:
    errors: list[str] = shape_errors(root)
    for codex_rel, claude_rel in PAIRS:
        codex_path, claude_path = root / codex_rel, root / claude_rel
        for path in (codex_path, claude_path):
            if not path.is_file():
                errors.append(f"missing role file: {path.relative_to(root)}")
        if any(not p.is_file() for p in (codex_path, claude_path)):
            continue
        try:
            codex = codex_instructions(codex_path.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as exc:
            errors.append(f"cannot parse {codex_rel}: {exc}")
            continue
        if codex is None:
            errors.append(f"{codex_rel} has no developer_instructions string")
            continue
        claude = claude_body(claude_path.read_text(encoding="utf-8"))
        if codex != claude:
            first = next((i for i, (a, b) in enumerate(zip(codex.splitlines(), claude.splitlines()), 1) if a != b), min(len(codex.splitlines()), len(claude.splitlines())) + 1)
            errors.append(f"role text differs: {codex_rel} vs {claude_rel} (first difference at line {first} of the body) — copy the edited one over the other")
    return errors


def main() -> int:
    errors = compare(ROOT)
    for error in errors:
        print(f"FAIL: {error}", file=sys.stderr)
    if errors:
        return 1
    print(f"PASS: Codex role files well-formed; {len(PAIRS)} manual-loop roles identical in .codex/agents and .claude/agents")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
