---
description: Forward to the shared manual-loop procedure for an approved SPEC.
argument-hint: <spec-file.md> [task id, optional]
---

Read AGENTS.md and execute the shared procedure in
[`DOCS/guides/manual-loop.md`](../../DOCS/guides/manual-loop.md), passing the
same `$ARGUMENTS` (SPEC path followed by an optional task id). The shared
procedure owns preparation, role routing, context, retries, gates, evidence,
dual review, blocking, and closure. This adapter contains no local model or
role policy.
