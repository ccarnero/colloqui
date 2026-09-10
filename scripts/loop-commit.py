#!/usr/bin/env python3
"""Step 7 of the manual loop: the commit, with the human in front of it.

    python3 scripts/loop-commit.py <spec.md> <TASK> [--check | --yes] [--type=feat|fix|test|chore|refactor|docs] [--scope=x]

--check is step 1 (preflight). The tree belongs to the human while the loop runs: whatever
is already uncommitted outside the task's files is recorded as the baseline
(.git/loop-baseline) and ignored from then on. It never fails; it lists what it will
ignore. Without flags it is step 7's dry run: a file outside the task's "Allowed write
paths" (plus the SPEC and BLOCKED.md) that was NOT dirty at preflight is the task's
doing → exit 1 naming it, nothing staged. Otherwise it prints `git status --short`,
the diffstat and the exact commit message, and exits 2 ("waiting for your ok"). The
orchestrator pastes that output and stops; the human runs it again with --yes, or
tells it to. With --yes it checks the task off in the SPEC's Progress list, stages
exactly the task's files and commits; the human's own edits stay where they are.
Idempotent: nothing to commit → exit 0. Never pushes.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASELINE = ROOT / ".git" / "loop-baseline"  # uncommitted paths that were the human's before the task started
TYPES = {"feat", "fix", "test", "chore", "refactor", "docs"}


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout


def task_section(spec: str, task: str) -> tuple[str, str] | None:
    """(title, body) of `### T02 — title` up to the next `### ` or `---`."""
    m = re.search(rf"^### {re.escape(task)}\s*[—-]+\s*(.+?)\s*$", spec, re.M)
    if not m:
        return None
    rest = spec[m.end():]
    end = re.search(r"^(### |---\s*$)", rest, re.M)
    return m.group(1).strip(), rest[: end.start()] if end else rest


def allowed_paths(body: str) -> list[str]:
    m = re.search(r"\*\*Allowed write paths:\*\*(.*?)(?=^- \*\*|\Z)", body, re.S | re.M)
    return re.findall(r"`([^`]+)`", m.group(1)) if m else []


def inside(path: str, allowed: list[str]) -> bool:
    return any(path == a or (a.endswith("/") and path.startswith(a)) or path.startswith(a.rstrip("/") + "/") for a in allowed)


def attempts_of(spec: str, task: str) -> str | None:
    m = re.search(rf"\b{re.escape(task)}\s+(\d+)/(\d+)", spec)
    return f"{m.group(1)}/{m.group(2)}" if m else None


def scope_of(paths: list[str]) -> str:
    for p in paths:
        m = re.match(r"^(?:packages|services|apps|scripts)/([^/]+)", p)
        if m:
            return m.group(1)
    return "loop"


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    flags = [a for a in argv if a.startswith("--")]
    if len(args) != 2:
        print(__doc__)
        return 1
    spec_rel, task = args[0], args[1].upper()
    yes = "--yes" in flags
    check = "--check" in flags
    ctype = next((f.split("=", 1)[1] for f in flags if f.startswith("--type=")), "feat")
    if ctype not in TYPES:
        print(f"✖ --type must be one of {sorted(TYPES)}")
        return 1
    spec_path = ROOT / spec_rel
    if not spec_path.is_file():
        print(f"✖ SPEC not found: {spec_rel}")
        return 1
    spec = spec_path.read_text()
    sec = task_section(spec, task)
    if not sec:
        print(f"✖ no `### {task} — …` heading in {spec_rel}")
        return 1
    title, body = sec
    allowed = allowed_paths(body)
    if not allowed:
        print(f"✖ {task} declares no **Allowed write paths** — add them to the SPEC before committing")
        return 1
    allowed = allowed + [spec_rel, "BLOCKED.md"]

    dirty = [ln[3:].strip() for ln in git("status", "--porcelain", "--untracked-files=all").splitlines() if ln.strip()]
    dirty = [c.split(" -> ")[-1] for c in dirty]
    if check:
        yours = [c for c in dirty if not inside(c, allowed)]
        BASELINE.write_text("\n".join(yours) + ("\n" if yours else ""))
        mine = [c for c in dirty if inside(c, allowed)]
        print(f"preflight ok — {len(yours)} uncommitted file(s) outside {task}'s paths are yours and will be ignored" + (":" if yours else "."))
        for c in yours:
            print(f"    {c}")
        if mine:
            print(f"  {len(mine)} file(s) inside {task}'s paths already in the tree (resuming from them): " + ", ".join(mine))
        return 0
    baseline = set(BASELINE.read_text().split()) if BASELINE.exists() else set()
    changed = [c for c in dirty if inside(c, allowed)]
    outside = [c for c in dirty if not inside(c, allowed) and c not in baseline]
    ignored = [c for c in dirty if not inside(c, allowed) and c in baseline]
    if outside:
        print(f"✖ {len(outside)} file(s) outside {task}'s allowed write paths changed during the task — nothing staged:")
        for c in outside:
            print(f"    {c}")
        print("  allowed: " + ", ".join(allowed))
        return 1
    if not changed:
        last = git("log", "-1", "--format=%h %s").strip()
        print(f"nothing to commit for {task} (last: {last})" + (f"; {len(ignored)} of your own file(s) left untouched" if ignored else ""))
        return 0

    scope = next((f.split("=", 1)[1] for f in flags if f.startswith("--scope=")), scope_of(allowed))
    attempts = attempts_of(spec, task)
    header = f"{ctype}({scope}): {task} {title}"
    lines = [f"SPEC: {spec_rel}"]
    if attempts:
        lines.append(f"Attempts: {attempts}")
    lines.append("Gates green, 2x APPROVED (manual loop step 7).")
    message = header + "\n\n" + "\n".join(lines) + "\n"

    print(f"▸ {task} — {title}")
    print("▸ files of the task (all inside allowed paths):")
    print(git("status", "--short", "--", *changed), end="")
    if ignored:
        print(f"▸ yours, untouched: {', '.join(ignored)}")
    print("▸ diffstat:")
    print(git("diff", "--stat", "HEAD", "--", *changed), end="")
    print("▸ commit message:")
    print("  " + message.replace("\n", "\n  ").rstrip())
    unchecked = re.search(rf"^- \[ \] {re.escape(task)}\b", spec, re.M) is not None
    if not yes:
        print(f"\nwaiting for your ok — run again with --yes to commit{' (it also checks ' + task + ' off in Progress)' if unchecked else ''}")
        return 2

    if unchecked:
        spec = re.sub(rf"^- \[ \] {re.escape(task)}\b", f"- [x] {task}", spec, count=1, flags=re.M)
        spec_path.write_text(spec)
        print(f"▸ checked {task} off in Progress")
        if spec_rel not in changed:
            changed.append(spec_rel)  # the check-off goes in the same commit as the code (manual step 7)
    git("add", "--", *changed)
    subprocess.run(["git", "commit", "-q", "-F", "-"], cwd=ROOT, check=True, input=message, text=True)
    print("▸ committed " + git("log", "-1", "--format=%h %s").strip())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
