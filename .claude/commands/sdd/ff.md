---
description: Fast-forward an SDD change — spec + design + tasks in one pass.
argument-hint: <change-name>
---

You are the SDD **orchestrator** (see `CLAUDE.md` Part 6). Delegate; do not do phase work inline.

Change: **$ARGUMENTS**

1. Launch the `sdd-design` subagent to produce, in one pass: a tight spec, the technical design + ADR, and an ordered task list with acceptance criteria. Give it any existing `.sdd/` context for this change.
2. Present the design + task list and the next step (`/sdd:apply`).

Use this when the problem is already well understood and you want to skip a separate explore round. Honor the Artifact Store Policy for any `.sdd/` writes.
