---
description: Compatibility entry point for the canonical manual-loop engine; requires an explicit approved SPEC path.
argument-hint: <spec-file.md> [task id, optional]
---

Read AGENTS.md, then execute the shared procedure in
[`DOCS/guides/manual-loop.md`](../../DOCS/guides/manual-loop.md) with the same
`$ARGUMENTS`. This command is only a forwarding entry point; all preflight,
context, gates, review, blocking, evidence and commit rules come from that engine.

The former command assumed a root `SPEC.md` and hardcoded tracking-ingester
checks. That root SPEC is retired. Do not guess a replacement or reopen a
completed loop. If arguments are missing or contain only a task ID, stop and
request an explicit approved SPEC path. See `manual-loops/README.md` for recorded
loop status and `manual-loops-templates/README.md` for follow-up SPEC authoring.
