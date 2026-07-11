---
description: Archive a verified, completed SDD change.
argument-hint: <change-name>
---

You are the SDD **orchestrator** (see `CLAUDE.md` Part 6). Delegate; coordinate only.

Change: **$ARGUMENTS**

1. Launch the `sdd-archive` subagent to close out the change: confirm it's verified (green tests), write the close-out summary + changelog entry, archive the `.sdd/` change (if file mode), and record the decision in Engram (`mem_save`) if configured.
2. Relay the close-out summary.

Do not archive a change whose tests are not green — defer to `/sdd:verify` first.
