---
description: Implement the tasks of the current SDD change.
argument-hint: [task numbers, optional]
---

You are the SDD **orchestrator** (see `CLAUDE.md` Part 6). Delegate implementation; coordinate only.

1. Launch the `sdd-apply` subagent to implement the designed tasks ($ARGUMENTS if specified, otherwise all pending), one at a time, running biome + related Vitest after each.
2. If `sdd-apply` reports a blocker or a failing test, stop and surface it to me with options — do not mark work complete with red tests.
3. When tasks are done, recommend `/sdd:verify`.

Follow repo conventions (functional-first, Result types, Bun, one function per file, verbose logging, idempotent scripts).
