# SPEC: Operating documentation alignment

> Origin: user authorization on 2026-09-05 to align operational READMEs and guides.
> Engram topic: architecture/operating-docs-alignment

## Goal

Developers find one consistent workflow from repository entry points, guides,
and legacy commands, without changing runtime behavior or historical task state.

## User decisions

Use current AGENTS.md and the manual-loop engine. KISS is the default guard mode.
Preserve history; replace duplicate operational procedures with canonical links.

## Constraints

Full AGENTS.md applies. English additions. Preserve prior workspace changes.
No service implementation, dependencies, task-state changes, commits, deployment,
or remote settings changes. Snapshot every edited file for isolated review.
Existing product behavior and dated records are not re-certified by this task.

## Gates

```sh
/bin/bash -n scripts/checks/doc-code-guards.sh
/bin/bash scripts/checks/doc-code-guards.sh
```

Check local Markdown links in changed documents and review the isolated diff.
The guard's read-only Git queries are permitted; no Git writes or commits.

## Task queue

### T01: Align navigation, operating guidance and legacy command

Allowed paths: root README.md; DOCS/README.md; DOCS/guides/LOOP-PLAYBOOK.md,
doc-code-guards.md and dev-mode.md; .claude/commands/build-console.md;
PENDIENTES/README.md; manual-loops/README.md; scripts/checks/doc-code-guards.sh
(usage comments only); DOCS/PROJECT-ARCHITECTURE-MEMORY-INDEX.md and
DOCS/archive/INDEX.md (append-only entry). Component READMEs may be adjusted
only when the audit finds an actual workflow contradiction, with paths recorded.
The template guide and both SPEC templates are also allowed for the specific
validator safety warning discovered during review: its unconditional EXIT trap
can discard canary-file edits even when preflight refuses to run.

Replace the duplicate build-console engine with a safe pointer to manual-loop
requiring an explicit approved SPEC path, retaining an explanation of the legacy
missing root SPEC. Shorten the playbook to current workflow navigation. Correct
KISS/full and CI descriptions without changing guard behavior. Link working
queues in PENDIENTES separately from the historical manual-loops inventory.
Keep actual validator implementation descriptions accurate; do not claim its
destructive canary restore is fixed by documentation. Review service/package/SDK
READMEs and other active documentation for relevant contradictory instructions.

**Accept:** Gates and changed-link checks pass; isolated diff receives two
independent approvals; Progress reports coverage, changes, and exceptions.

## Progress

- [x] T01: Align operating documentation and record verification.

Evidence (2026-09-05):

- Updated 15 files: root/DOCS READMEs; LOOP-PLAYBOOK, doc-code-guards and
  dev-mode guides; build-console command; PENDIENTES and manual-loops indexes;
  guard usage comments; persistent architecture navigation; append-only change
  register; admin-console README; template guide and both SPEC templates.
- Additional scoped audit searched 71 files: 20 service READMEs, 5 package
  READMEs, 1 SDK README, 2 script READMEs and 43 DOCS files; also searched
  22 PENDIENTES documents. Contextual inspection of relevant matches found one
  stale admin-console section pointer, now corrected. This was a workflow-text
  audit, not a line-by-line certification of every document or runtime behavior.
- PENDIENTES is a separate working register. The earlier 41-record inventory
  covered manual-loops only and did not establish absence of repository backlog.
  No task states in either location changed during this documentation task.
- Baseline and isolated diff: `/tmp/operating-docs-alignment-20260905/`.
  Parent applied documentation edits directly; independent reviewers assessed
  the isolated diff. No normal engine commit cycle was executed.
- `/bin/bash -n scripts/checks/doc-code-guards.sh`: passed.
- `/bin/bash scripts/checks/doc-code-guards.sh`: exit 0,
  `KISS doc/code guards passed.` DI scanned zero modified code files; this is
  not DI coverage of the whole repository or of a remote pull request.
- `ruby /tmp/operating-docs-alignment-20260905/check.rb`: exit 0,
  223 local links resolve; executable guard content unchanged; archive append-only.
  Both reviewers independently reran this check. Link anchors were not validated.
- Verification retry: initial check caught literal escaped newline text in the
  edited guard guide; corrected it and reran successfully before final review.
- Review round 1: both reviewers rejected incomplete validator safety guidance.
  Its unconditional EXIT trap can discard unstaged canary edits even on failed
  preflight. Retry1 clarified the guide and added the warning to all three
  template entry points. The validator implementation is unchanged and was not run.
- Open runtime defect: `scripts/validate-dev-mode.sh`, `cleanup`/EXIT trap before
  preflight. Preflight refusal does not protect canary edits. A separate scoped
  fix with regression tests is needed; documentation is not a fix or mitigation
  enforced by the tool itself.
- Audit agent: `01a0721a-7ceb-71f2-afe8-0aaef4a4d5fc`.
- Reviewer A: `01a0721f-bbe7-75c2-8e65-a269985d2c2c`, refreshed APPROVED.
- Reviewer B: `01a0721f-bc46-78d1-a442-784f6d0fa45f`, refreshed APPROVED.
  Agents inherited the parent's model with no weaker override. Both independently
  reviewed the same final diff, including the expanded template-warning scope.
- Final reviewed diff SHA256:
  `b3817f46263d6ca90b7d493af2dcf087efac674e2847a59accfd46e556437f1f`.
- No runtime tests, cluster operations, remote CI verification, commits or pushes.
  Frozen records were preserved; the change register received only an appended
  entry. Engram was not used; this SPEC persists decisions and evidence locally.

## Out of scope

Runtime fixes, historical record rewrites, queue execution, full-repository
implementation audit, and remotely required CI configuration.

## Human boundaries

This documentation update is authorized. Functional changes require separate scope.
