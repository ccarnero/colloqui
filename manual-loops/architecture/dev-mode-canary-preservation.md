# SPEC: Preserve local files during dev-mode validation

> Origin: user approval on 2026-09-05 to fix the validator before a live cycle.
> Engram topic: architecture/dev-mode-canary-preservation

## Goal

Failed preflight never writes the canary file. Cleanup only restores changes
owned by this validator, preserves unexpected edits and reports recovery paths.

## User decisions

Fix and test locally with isolated command stubs first. The user is bringing up
OrbStack; the live dev-mode cycle is a subsequent checkpoint, not part of T01.

## Constraints

Full AGENTS.md applies. Bash 3.2, no new dependencies. Use simple imperative
shell state for file ownership; do not introduce a generic rollback framework.
Never weaken tests, overwrite unexpected edits, or reset files through Git.
Capture before-edit snapshots for review. No commits or live cluster operations.
Read-only Git queries used by guards and preflight are permitted. Test mutations
must be confined to disposable fixtures; never execute the real dev-mode entry
point or contact a live cluster from tests.

## Gates

```sh
/bin/bash -n scripts/validate-dev-mode.sh
/bin/bash -n scripts/tests/validate-dev-mode.test.sh
/bin/bash scripts/tests/validate-dev-mode.test.sh
/bin/bash scripts/checks/doc-code-guards.sh
```

## Task queue

### T01: Fix ownership-aware canary restoration and document it

Allowed paths: scripts/validate-dev-mode.sh; new
scripts/tests/validate-dev-mode.test.sh; DOCS/guides/dev-mode.md;
manual-loops-templates/README.md and both SPEC templates; append-only
DOCS/archive/INDEX.md. Parent owns this SPEC and documentation updates.

Write regression tests before the fix and observe failure against the original
script using disposable fixtures and stub commands. Cover early prerequisite
failure with a dirty canary, dirty/staged/untracked canary refusal, failing Git
status, failure before canary append, successful restoration, failure after append,
unexpected concurrent edits, and cleanup failure reporting. Preserve nonzero exit
status; restoration failures must not become success. Do not silently delete
recovery snapshots when restoration fails. Keep the current cluster validation
stages; this task does not promise automatic cluster rollback on early exit.

Replace both destructive Git restores with explicit ownership tracking and a
snapshot made before the validator's mutation. Compare before restoring so known
concurrent changes are preserved; document remaining exclusive-access requirement
and that an interrupted cluster run may leave dev mode enabled. Do not claim
interprocess locking or SIGKILL recovery. Update the current warning to the tested
behavior, leaving historical defect records intact.

**Accept:** Regression fails before and passes after; all Gates pass; two
independent reviews approve the isolated final diff. Progress records results
and the separate live-cycle prerequisites and success criteria.

## Progress

- [x] T01: Preserve canary files and verify with isolated regression tests.

Observed verification (2026-09-05):

- Implementer: `01a07234-4c3e-7b03-9679-0ac232c0c9c0`; code baseline,
  diff and red/green evidence in `/tmp/canary-t01-baseline.soprHp/`.
- Before fix: same isolated suite against captured original returned exit 1,
  0 passed / 14 failed. This does not mean 14 distinct behavioral defects:
  the Git stub writes different HEAD bytes on checkout and the suite also
  enforces the no-Git-restoration contract. Failed-preflight data loss was
  independently confirmed by comparing original fixture bytes with HEAD bytes.
- After fix: `/bin/bash scripts/tests/validate-dev-mode.test.sh` returned
  exit 0, 14 passed / 0 failed under Bash 3.2.57. Both reviewers independently
  reran the candidate suite; reviewer A also reran the captured original.
- Cases: early prerequisite failure, dirty/staged/untracked status, Git failure,
  failure before append, successful restoration, failure after append, concurrent
  edits, already-restored content, copy failure, original/replacement symlinks,
  and missing file. Nonzero exits 29 and 37 remained unchanged.
- Parent explicitly reran `/bin/bash -n scripts/validate-dev-mode.sh`: exit 0,
  no output (execution df1668); `/bin/bash -n scripts/tests/validate-dev-mode.test.sh`:
  exit 0, no output (f70741). Reviewer A independently observed both passes.
- Parent reran `/bin/bash scripts/checks/doc-code-guards.sh`: exit 0,
  `KISS doc/code guards passed` (6c5ba7). DI scanned zero changed source files;
  it does not certify service behavior. Read-only Git queries are allowed here.
- Documentation: 6 local Markdown links resolve; archive entry is append-only.
  Baseline/diff in `/tmp/dev-mode-canary-docs-20260905/`.
- Combined reviewed diff SHA256:
  `d48edaf7f9d4705cd719f490763e6221e84324179f709709384f94ead365dd58`.
- Implementer reported a test-stub injection correction before implementation
  without loosening assertions, and one patch-conflict retry. No cluster calls
  or real Git writes were made by the fixture suite.
- Reviewer A `01a07239-71de-7fc1-b1a4-e64bc846a901`: APPROVED.
- Reviewer B `01a07239-7233-77d0-9a25-720abd627cf7`: initially REJECTED for
  missing explicit syntax evidence and interpretation of the red result.
  The evidence above resolves those points without changing the reviewed code.
  Final verdict: APPROVED for the unchanged artifacts after evidence clarification.
  Agents inherited the parent model without weaker overrides.
- Parent updated documentation; implementer changed only validator and tests.
  No commit, live validation, deployment or cluster-state change was performed.
  Exclusive access remains required; no locking, SIGKILL recovery or automatic
  cluster rollback is claimed. Engram was not used; this SPEC persists evidence.

Next checkpoint (not run): OrbStack Kubernetes and platform stack ready; test
tenant/admin available; canary clean with no concurrent editor; workflow-service
targets initially outside dev mode. Run readiness, refresh dependencies if needed,
then `./scripts/validate-dev-mode.sh --with-e2e`. Require exit 0, observed reload,
API barrier/e2e success, source restoration and restored target images/commands.
If interrupted, inspect cluster state before recovery or retry; local-file cleanup
does not imply dev-mode off. The guide contains the command sequence.

## Out of scope

Live cluster execution, bootstrap, seeding, automatic cluster rollback, SIGKILL
recovery, service changes, and enabling remotely required checks.

## Human boundaries

T01 is approved. Report readiness and the live-cycle plan to the user after local
verification. Do not start the cluster test merely because OrbStack becomes ready.
