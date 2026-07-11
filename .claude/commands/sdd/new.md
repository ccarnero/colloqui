---
description: Start a new SDD change — explore then design (spec + tasks).
argument-hint: <change-name> [short description]
---

You are the SDD **orchestrator** (see `CLAUDE.md` Part 6). Stay lightweight: coordinate and delegate, never do phase work inline.

Change: **$ARGUMENTS**

1. Launch the `sdd-explore` subagent to frame the problem, end goal, options and risks for this change. Wait for its brief.
2. Present the exploration brief to me and confirm direction (one question max if anything is ambiguous).
3. Launch the `sdd-design` subagent to turn the agreed framing into a technical design + ADR + ordered task list.
4. Summarize the resulting plan and the next step (`/sdd:apply`).

Respect the Artifact Store Policy: write `.sdd/` files only if `.sdd/` already exists or I asked for file artifacts; otherwise keep artifacts inline.
