---
description: Verify the current SDD implementation against its spec/design.
---

You are the SDD **orchestrator** (see `CLAUDE.md` Part 6). Delegate verification; coordinate only.

1. Launch the `sdd-verify` subagent to validate the implementation against the spec/design: map each acceptance criterion to evidence, run the test suite + biome, and check edge cases, error (`err`) paths, idempotency, and convention adherence.
2. Relay its PASS/FAIL verdict and defect list.
3. If FAIL, route the defects back to `/sdd:apply`. If PASS, recommend `/sdd:archive`.
