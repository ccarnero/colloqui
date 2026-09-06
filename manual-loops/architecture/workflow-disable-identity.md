# Workflow disable: stable execution ownership

Origin: user-approved W1 remediation, 2026-09-05; local tests explicitly authorized.
Engram topic: `architecture/workflow-disable-identity`.

## Goal

Disabling a definition terminates only its tenant-scoped executions, including
executions started under an earlier name. Never infer ownership from name prefixes.

## Constraints

- Follow full AGENTS.md. Preserve all preexisting work; no git commands or commits.
- Reuse the existing tenant-scoped execution repository and Temporal list API.
- Read definition execution rows in bounded pages; match exact Temporal workflow IDs.
- Do not filter by projected database status: Temporal supplies running status.
- Keep selection pure and I/O/logging in the service shell. No new dependencies.
- No workflow ID format changes, schema migrations, messaging changes or deployment.
- A run missing its persisted execution row cannot be attributed safely; never fall
  back to a name match. The existing start/persist race remains separate work.

## Gates

Run locally from the repository root, in order:

```sh
/bin/bash scripts/checks/doc-code-guards.sh
(cd services/workflow-service && bun test test/unit)
./node_modules/.bin/tsc --noEmit --incremental false -p services/workflow-service/tsconfig.json
```

Cluster iteration, built-image validation and frozen-install/build evidence remain
pending, not waived. No claim of deployment readiness or fully completed loop until
those gates and two independent reviews are recorded. No OrbStack calls this task.

## Task queue

### T01: Replace name-prefix termination selection

Allowed write paths:
- `services/workflow-service/src/modules/workflows/workflows.service.ts`
- `services/workflow-service/src/modules/workflows/select-owned-workflow-ids.ts`
- `services/workflow-service/test/unit/workflows.service.spec.ts`
- `services/workflow-service/test/unit/select-owned-workflow-ids.spec.ts`
- `services/workflow-service/src/modules/workflows/executions.postgres.repository.ts`
- `services/workflow-service/src/modules/workflows/executions.mongo.repository.ts`
- `services/workflow-service/test/unit/executions.repository.spec.ts`
- `services/workflow-service/test/unit/executions-pagination.spec.ts`
- This SPEC (orchestrator evidence only).

Use `findExecutionsByDefinition` with tenant + definition ID and bounded pagination.
Select exact IDs through a pure helper using existing row types. Query Temporal's
running executions for the tenant and terminate only IDs owned by the definition.
Pass `row.id`, not `row.name`, from `updateWorkflowStatus`. Preserve per-run failure
reporting, run-specific handles, enable behavior, and idempotent empty sweeps.
No other audit finding is in scope. This supersedes the flawed prefix algorithm in
historical `manual-loops/workflow-toggle.md` T04 without rewriting its history.

**Accept**
- Regression coverage: prefix collisions, renamed definitions, another tenant,
  another definition, multiple repository pages, stale projected status, empty
  results, per-run failure continuation and repository failure before termination.
- Existing tests retain their behavioral assertions; adapt fixtures and obsolete
  prefix-specific descriptions to stable ownership, never weaken guarantees.
- Pure selection tests are data-driven without I/O mocks.
- Definition pagination uses a total order: `created_at, id` for Postgres and
  `created_at, _id` for Mongo, both keys following the requested direction.
- Regression checks exercise the actual repository query construction for both
  directions and both engines, including more than 100 rows with equal timestamps
  across pages, without omissions or duplicates. Local boundary doubles are not
  evidence of execution against a real database.
- Local gates above pass; two independent reviewers assess the unchanged patch.

## Human boundaries

User approved the narrow fix and local tests. No infrastructure, installs, commits
or unrelated remediation authorized. Missing evidence stays explicit and pending.
On 2026-09-05 the user approved expanding T01 to both execution repositories and
their tests to correct the independently identified pagination defect. Only
`findExecutionsByDefinition` ordering changes; unrelated queries remain untouched.

## Progress

- [x] T01 implemented, validated and reviewed (local stage).
- [ ] Frozen-install/build and live integration evidence; full loop closure.

Preflight: git inventory unavailable by instruction; capture allowed-file baseline
copies before edits and preserve existing content. Do not claim clean worktree.

### Attempt 1: local gates passed; dual review rejected (2026-09-05)

- Implementation preserved in the four allowed code/test files. No commit or deployment.
- Implementer: Epicurus, agent `01a072f7-cf5a-7641-affb-18ae8dabe949`, inherited parent model without override. Exact model identifier was not exposed; full model provenance remains unavailable, not inferred from configuration.
- `/bin/bash scripts/checks/doc-code-guards.sh`: exit 0; KISS, 2 files scanned.
- `(cd services/workflow-service && bun test test/unit)`: exit 0; 292 passed, 0 failed, 632 assertions, 19 files; Bun 1.3.1.
- `./node_modules/.bin/tsc --noEmit --incremental false -p services/workflow-service/tsconfig.json`: exit 0, no diagnostics; TypeScript 5.9.3.
- Evidence directory: `/tmp/workflow-disable-identity-20260905`; baseline copies, `patch.diff`, full new files, `state.sha256`, `kiss.log`, `unit.log`, `types.log`. These temporary files are local evidence, not durable CI artifacts.
- Reviewed source hashes: service `a4acda9260b43627701c6a8ddc0c8acadcf0f2be055d4a59025b2bd4a2056ee8`; helper `42c0d66b589542aa3d907c65ff1115f6febf7df5f87b16c1a05c862d479512c9`.
- Reviewed test hashes: service suite `cbd4f5ed50985482fe6a22d7298c335005c208441c8c03586b4fb26bf5b06a69`; pure suite `5dcd35c9fc49a9cdd56e243bf266d395a7a9b359f1ec4fb8807c584b92e85a96`.
- Reviewer Avicenna (`01a072fa-dc42-7c70-8314-95769167fb4e`): REJECTED, P2 unstable pagination. Reviewer Plato (`01a072fa-dca5-7021-8737-99352d14a9a7`): independently REJECTED for the same issue. Both compared baseline diffs, full new files and hashes; neither reran gates. Both inherited parent model with no override; exact model identifiers unavailable.
- Required correction: repository ordering uses only `created_at`; equal timestamps across LIMIT/OFFSET pages can cause omissions. Add a unique tie-breaker in both Postgres and Mongo and regression coverage exceeding 100 rows with repeated timestamps. This requires explicit write-scope expansion before editing repositories. Current patch is not approved.
- No gate retries, installs, OrbStack calls, direct Git commands or commits. KISS uses Git internally. Truncated read output was recovered from baseline by implementer; reviewers used textual search instead of codegraph. No test assertions were found weakened.
- Frozen-install/build and live integration remain unexecuted. Engram tools unavailable; persistence is this SPEC. Work is preserved pending user authorization for the discovered correction and expanded paths.

### Attempt 2: pagination corrected; local reviews approved (2026-09-05)

- User approved repository/test scope expansion. Changed only the two repository ordering expressions and added `test/unit/executions-pagination.spec.ts`; the prior four implementation files and both locks retained their hashes.
- Implementer Herschel: `01a07316-aabb-7e40-b4fd-68b0d91b63c4`. Inherited parent model with no override; exact model identifier unavailable.
- Gates ran in SPEC order: KISS exit 0; unit suite exit 0 (296 passed, 0 failed, 718 assertions, 20 files); typecheck exit 0 without diagnostics. Bun 1.3.1 and TypeScript 5.9.3. No gate retries.
- Regression coverage: 205 equal-timestamp rows, ascending and descending order, Postgres and Mongo query construction, complete paginated coverage. Uses local boundary doubles, not live database execution.
- Evidence: `/tmp/workflow-disable-identity-20260905/attempt2/combined.patch.diff`, `state.sha256`, `kiss.log`, `unit.log`, `types.log`, baseline copies and full new files. Temporary logs are not durable CI artifacts.
- New source hashes: Postgres `6babd53920fa3c393a13cb191ed714e7a860ec9df2e627cd288486044a9fe8b3`; Mongo `1dbf23d47b006c99693b089c80cb0fa438975b8d4e081be0f2aa519ee89687a1`; pagination test `9de190f5643393dc1c38caa0681d441fc7e10ba6bdf7f53f4c99ca17aa5cb196`. Prior four hashes are recorded above and unchanged.
- Independent reviewers Anscombe (`01a07318-ed38-7393-9e80-616b10d5bb79`) and Godel (`01a07318-ed92-7193-9974-47be83263888`) both APPROVED the combined local code patch. Each reviewed full diffs/new files, logs and nine matching hashes without seeing the other verdict or rerunning gates. Both inherited parent model without override; exact model identifiers unavailable.
- Parent subsequently identified a fixture typing omission: the new `IWorkflowExecutionRow[]` fixture lacks required `correlation_id: null`. Existing local gates did not report it. Not corrected automatically; awaiting user decision under the active editing instructions. Local T01 checkbox remains open despite reviewer approvals.
- Frozen-install, build, live integration and exact model provenance remain pending; no full-loop closure or deployment readiness claimed. No installs, builds, OrbStack, commits or direct Git operations. KISS uses Git internally. One implementer read was truncated and recovered; reviewers used textual search instead of codegraph. `diff` exit 1 meant changes present, not a failed gate.

### Attempt 3: fixture corrected; final local reviews approved (2026-09-05)

- User authorized correcting the fixture omission and repeating local validation. Only `correlation_id: null` was added to the pagination test fixture. No production changes in this attempt.
- Implementer Kant: `01a0731a-dfc1-71d2-a834-b3ac71f1c48a`, inherited parent model with no override; exact model identifier unavailable.
- All SPEC gates reran in order: KISS exit 0; unit suite exit 0 (296 passed, 0 failed, 718 assertions, 20 files); typecheck exit 0 without diagnostics. Bun 1.3.1; TypeScript 5.9.3. The service typecheck includes source, not test files; it does not certify test-file typing.
- Evidence: `/tmp/workflow-disable-identity-20260905/attempt3/patch.diff`, `state.sha256`, `statuses.log`, full gate logs and fixture baseline. Final pagination test SHA-256: `bd955313fd748da12c3051278eecdfc86e9eef2ece6e2e888bf41cd4d3ff6502`. The other eight manifest hashes remain unchanged from attempt 2.
- Independent reviewers Feynman (`01a0731c-516e-7dc1-bdae-fe234477fbb5`) and Bacon (`01a0731c-51e4-7003-811f-2a1c3eecf15b`) APPROVED the final combined local code patch. Both reviewed full diffs/new files and logs, confirmed nine hashes, and checked fixture completeness. Neither reran gates or saw the other verdict before completing.
- Both reviewers inherited the parent model without overrides. Exact model identifiers are not exposed; model-provenance completeness remains pending, not inferred from configuration. Agent identifiers above are tool-returned identities.
- Evidence capture alone was retried after a conflict with the special zsh `path` variable; no gate retries. Reviewers used textual tools instead of codegraph. No installs, builds, OrbStack, direct Git commands, commits or deployment. KISS uses Git internally.
- Local code/test stage is complete; full-loop closure remains blocked by frozen-install/build, live integration and exact model provenance. Existing start/persist race remains out of scope. Engram remains unavailable; evidence is persisted here, with temporary detailed logs as supplementary local artifacts.
