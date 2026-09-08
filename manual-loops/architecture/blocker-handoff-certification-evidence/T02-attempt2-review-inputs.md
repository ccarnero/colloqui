# T02 attempt 2 unchanged review inputs

Both reviewers must read full AGENTS.md, the full revision-4 certification SPEC,
DOCS/guides/manual-loop.md, agent-roles.md, and codex-manual-loop.md.
The unchanged reviewed-state manifest is T02-attempt2-state.json, SHA-256
275c436f3fa8b75efe0575f33866103f87bcbfa15fdd7dba64c4254635d30900.
T02-attempt2-post-gate-preservation.json reports zero mismatches over 3892 files.
The sole content amendments are R4 SPEC and certification-packet.md. Additional
coordinator records are uniquely named T02-attempt2-*; all attempt-1 files and
unrelated user work are preserved. Read staged/unstaged diffs and full new task
artifacts; baseline ownership is T02-attempt2-baseline* and preservation.json.

Mandatory historical review inputs: T02-predecessor-committed.diff,
T02-predecessor-commits.txt, T02-review-verdicts.md, T02-handoff.md, BLOCKED.md,
T02-attempt1-certification-packet.md, and committed predecessor source evidence.
Mandatory integrated inputs: T02-attempt2-integrated.diff, integrated-log.txt,
integrated-tree.txt; verify roles/config/lock, checker, G19 wiring, tests, policy,
repair records and all 82 committed predecessor evidence files at exact 9fde0baa.
The large diff is untruncated on disk; inspect source objects and structured
historical records as needed for complete coverage. Do not merely approve the
packet: explicitly assess historical defect AND integrated resolution.

Current coverage: T02-attempt2-qa-plan.md, qa.md, implementation.md, preflight.md,
dev-provenance.json, qa-provenance.json, preflight-provenance.json.
Native runner results: T02-attempt2-gates.json and gate-01 through gate-09 raw
JSON/full stdout. All nine exit 0. Commands 4-8 ran in a separate detached tree
at exact 9fde0baa, clean before and after checker exit 0. No files copied in.
The runner's prose summary mistakenly transcribed gate 8 duration as
0.400057958; native evidence is 0.400039667. The persisted raw result and aggregate
use the native value. No rerun or reconstructed measurement occurred. Its summary
also said provenance was not exposed by the command tool; actual model/run/turn
was independently extracted from native turn_context into gates.json (Luna low,
run 01a082d6-fa9a-76f2-b31b-d1eb5fc9d29e, turn
01a082e9-b016-76c3-8a40-6c63a627036a).

Packet pending-proof language describes its pre-gate implementation snapshot;
actual proof and eventual verdicts live in coordinator evidence and Progress,
as required by T02. No developer-written premature certification is permitted.
Two independent native fp-reviewer agents (Astra high) will receive this identical
packet; neither sees the other's verdict. Actual review run/turn will be recorded
in T02-attempt2-review-provenance.json. No implementation/artifact edits during
review. Human composition finding is retained without erasing deviations A/B.
No affected runtime build, cluster gate or dependency install applies.
