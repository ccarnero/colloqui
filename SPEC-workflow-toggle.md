# SPEC — Per-tenant workflow enable/disable (admin console)

> Task queue for the `/build` loop. One task at a time, gated by tests and dual review.
> Origin: user decision 2026-07-10 (Cowork session). Engram topic: `workflows/tenant-toggle`.

## Goal

A tenant admin can enable/disable each workflow from the admin console.
Disabling a workflow: (a) blocks NEW executions from every entry point, and
(b) TERMINATES the tenant's running Temporal executions of that workflow.
Enabling restores normal behavior. Default for all existing workflows: `enabled`.

## User decisions (human boundary — do not reinterpret)

1. Disable = block new + terminate running (not just hide, not drain).
2. Scope: per tenant. The tenant DB is the boundary (as everywhere else).
3. Field: `status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled','disabled'))`
   — mirrors the HTTP adapter precedent (`packages/shared/src/adapter-schema.ts:30`,
   `adapter.interfaces.ts:47-50`). `disabled` is NOT `deleted_at`: both coexist.
4. Console UI strings in English (existing convention of the workflows feature).

## Constraints (apply to every task)

- Schemas and types live in `packages/shared` and are IMPORTED. Never duplicated.
- DDL migrations are idempotent: `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
  (pattern: `packages/shared/src/workflow-schema.ts:30-31`). Mongo schema updated in
  the same task as Postgres — they never diverge.
- Repo style wins: NestJS modules/services, class-validator DTOs, `@TenantId()`
  decorator, `TenantGuard`. Follow the file you are editing, not personal taste.
- Every new gateway route is EXPLICIT (workflow-service controller + api-gateway
  proxy controller + `WorkflowApiService`). The gateway does not auto-forward.
- Verbose logging: every blocked execution and every termination logs tenant,
  workflow id, and reason. Nothing fails silently.
- Tests are written IN the task that introduces the behavior (judge before/with
  product), never in a later task.
- Never modify existing tests to make them pass. Never stub Temporal in prod code.

## Gates (the `/build` loop runs these verbatim, in order)

```
G1  cd services/workflow-service && bun test     # FULL suite: unit + integration
G2  cd services/workflow-service && bunx tsc -p tsconfig.json --noEmit
G3  cd services/api-gateway && bun test          # runs test:unit + test:integration — from T05 onward
G4  cd services/admin-console && pnpm test       # from T06 onward (vitest via ng test)
G5a ITERATION (per attempt, source-mounted) — while a task is being attempted,
    each touched backend service runs in dev mode:
      ./dev-mode.sh deps                # at task start: sha-compare, installs
                                        # only if pnpm-lock.yaml changed (cheap)
      ./dev-mode.sh <service> on        # once, at task start
      ./scripts/e2e-http-workflow.sh    # per attempt, exit 0 required
    bun --watch picks up edits in ~2s — no image rebuild per attempt.
    If an attempt modifies pnpm-lock.yaml (new dependency): re-run
    `./dev-mode.sh deps` and cycle the service off/on BEFORE trusting any
    in-pod result — a stale deps PVC breaks workspace-package resolution
    (`Cannot find module '@yoizen/shared'`, seen 2026-07-10; see
    DOCS/guides/dev-mode.md § Stale deps).
    EXCEPTION: admin-console has no dev-mode (Angular, image flow only) —
    console tasks skip G5a and rely on G5b.
G5b COMMIT GATE (once per task, real artifact) — before a task can commit:
      ./dev-mode.sh <service> off       # restore declared state first
      ./rebuild-redeploy.sh <service> dev   # for EACH service touched by the diff
    (wait for the rollout to report ready), then run the cluster smoke:
      ./scripts/e2e-http-workflow.sh
    Exit 0 required. This verifies the http-channel → trigger → workflow →
    Temporal chain end-to-end against the BUILT IMAGE on the live k8s cluster —
    dev-mode tests mounted source; only G5b catches Dockerfile/build breakage.
```

Plus each task's own **Accept** commands, verbatim.

Gate rules:

- PRECONDITION (once, before the first task): `./scripts/validate-dev-mode.sh
  --with-e2e` must exit 0. If it fails, dev-mode is not trustworthy: skip G5a
  entirely and run G5b's rebuild-redeploy per attempt instead.
- ALL existing unit AND integration tests must pass — in every touched service,
  every task. Weakening, skipping, or deleting an existing test is an automatic
  reviewer rejection.
- G5b runs for every task (schema changes deploy too — the cluster must never
  drift from the branch). Diff touching `packages/shared` → redeploy
  `workflow-service` at minimum; T05 adds `api-gateway`; T06+ adds `admin-console`.
- Commits only happen with dev-mode OFF and the built image live: never commit
  a task whose cluster verification ran only against mounted source.
- G5a/G5b failures count as failed attempts like any other gate.

---

## Task queue

### T01 — Schema + types: `status` on workflow definitions

Add `status` to `workflow_definitions` in ALL shape definitions, default `'enabled'`:

- `packages/shared/src/workflow-schema.ts`: idempotent `ALTER TABLE` + column in CREATE,
  with `CHECK (status IN ('enabled','disabled'))`.
- `packages/shared/src/workflow-mongo-schema.ts`: same field.
- `packages/shared/src/workflow.interfaces.ts`: `status: WorkflowStatus` on
  `WorkflowDefinition` + exported `WorkflowStatus` type (mirror `AdapterStatus` shape).
- `services/workflow-service/src/modules/workflows/workflows.repository.interface.ts`:
  row shape includes `status`.
- Both repositories read/write the field; existing rows without it read as `'enabled'`.

**Accept**
```
cd services/workflow-service && bun test && bunx tsc -p tsconfig.json --noEmit
grep -n "ADD COLUMN IF NOT EXISTS status" ../../packages/shared/src/workflow-schema.ts
```

### T02 — Repository: `setStatus`

`setStatus(tenantId, workflowId, status)` on `IWorkflowsRepository`, implemented in
`workflows.postgres.repository.ts` and `workflows.mongo.repository.ts`. Returns the
updated row; not-found is an explicit error. Unit tests for both implementations
(existing spec file: `test/unit/workflows.repository.spec.ts`), covering: set to
disabled, set to enabled, idempotent re-set, unknown id.

**Accept**
```
cd services/workflow-service && bun test test/unit/workflows.repository.spec.ts
```

### T03 — Block new executions at the choke point

In `WorkflowsService.executeWorkflow` (`workflows.service.ts:284-388`), after the
definition is loaded (lines 290-296): if `status === 'disabled'`:

- HTTP path (`POST /workflows/:id/execute`): respond 409 with code
  `WORKFLOW_DISABLED`, tenant + workflow in the log line.
- Trigger path (`trigger-consumer.service.ts:232`): skip WITHOUT throwing (the
  message is handled, not retried), log at warn with tenant, workflow, trigger type.

Unit tests FIRST for both paths (disabled blocks, enabled passes, disabled trigger
does not nack the message).

**Accept**
```
cd services/workflow-service && bun test test/unit/workflows.service.spec.ts
```

### T04 — Temporal termination wrapper

New method on `WorkflowsService` (uses the existing `TEMPORAL_CLIENT` from
`temporal.provider.ts`): `terminateRunningExecutions(tenantId, definitionName)`:

- Enumerate via `client.workflow.list({ query: "TenantId='<t>' AND ExecutionStatus='Running'" })`
  (the `TenantId` search attribute is already registered, `temporal.provider.ts:11-30`).
- Filter by workflow id prefix `${tenantId}:${definitionName}:` (id scheme from
  `workflows.service.ts:299-301`).
- `handle.terminate("workflow disabled by tenant admin")` on each; collect and
  return `{ terminated: n, failed: [...] }` — one failure does not stop the rest.
- Log every termination (tenant, workflowId, runId).

Unit tests with mocked Temporal client: filters correctly, partial failure reported,
zero-running is a clean no-op.

**Accept**
```
cd services/workflow-service && bun test
```

### T05 — REST endpoint + gateway proxy

- workflow-service: `PATCH /workflows/:id/status`, DTO `{ status: 'enabled'|'disabled' }`
  (class-validator), guarded by `TenantGuard` + `@TenantId()`. On `disabled`:
  `setStatus` THEN `terminateRunningExecutions`; response includes `{ terminated }` count.
  On `enabled`: `setStatus` only. Idempotent both ways.
- api-gateway: mirror route in `services/api-gateway/src/modules/workflows/`
  (controller + `WorkflowProxyService` + gateway DTO), same 1:1 pattern as the
  existing routes.

Controller unit tests in both services.

**Accept**
```
cd services/workflow-service && bun test
cd services/api-gateway && bun test
```

### T06 — Console API client

`WorkflowApiService.setStatus(id, status)` in
`services/admin-console/src/app/features/automation/workflows/services/workflow-api.service.ts`
calling `PATCH ${environment.apiUrl}/workflows/:id/status`. Typed response includes
`terminated` count. Unit test (vitest).

**Accept**
```
cd services/admin-console && pnpm test
```

### T07 — Console UI: toggle + confirm

In `workflows.component.ts` (card list):

- `mat-slide-toggle` per card bound to `status === 'enabled'` (pattern:
  `schedule-form-dialog.component.ts`).
- Toggling OFF opens the shared `confirm-dialog` warning (English): running
  executions of this workflow will be terminated. Confirm → `setStatus('disabled')`;
  snackbar shows terminated count. Cancel → toggle reverts.
- Toggling ON: no dialog, direct call.
- Disabled workflows render with `<app-status-badge status="disabled">` and reduced
  opacity; the badge takes priority over the current `trigger ? 'active' : 'draft'`.
- Component test: toggle off → dialog → confirmed call; cancel → no call.

**Accept**
```
cd services/admin-console && pnpm test
```

### T08 — Cluster e2e: toggle scenario in the smoke script

Extend `scripts/e2e-http-workflow.sh` (keeping its stage-per-function pattern and
exit-code contract) with the toggle chain, after the existing happy path:

1. `PATCH /workflows/:id/status` → `disabled` (assert response includes
   `terminated` count).
2. POST a webhook message with a fresh nonce → poll and assert NO new execution
   is created for it (bounded wait).
3. `PATCH` back to `enabled` → POST another nonce → assert the execution
   completes (reuses the existing polling stage).

Exit 0 only if all three hold. This makes the disable semantics a permanent,
executable judge on the cluster.

**Accept**
```
./rebuild-redeploy.sh workflow-service dev
./rebuild-redeploy.sh api-gateway dev
./scripts/e2e-http-workflow.sh
```

### T09 — Docs + index

- `services/workflow-service/README.md`: document `status`, the block point, the
  termination semantics, and the 409 `WORKFLOW_DISABLED` contract.
- `cowork/INDEX.md`: entry for this change pointing at this SPEC.
- Note the decision cuádruple: rule (this SPEC §User decisions), why (per-tenant
  control of automation), evidence (`workflows.service.ts` block point), engram
  topic `workflows/tenant-toggle`.

**Accept**
```
grep -n "WORKFLOW_DISABLED" services/workflow-service/README.md
grep -n "workflow-toggle" cowork/INDEX.md
```

---

## Progress

- [x] T01 schema + types
- [x] T02 repository setStatus
- [ ] T03 block new executions
- [ ] T04 temporal termination wrapper
- [ ] T05 endpoint + gateway proxy
- [ ] T06 console api client
- [ ] T07 console ui toggle + confirm
- [ ] T08 cluster e2e toggle scenario
- [ ] T09 docs + index

## Out of scope (explicit)

- Global/platform-level flag (decided: per tenant only).
- Draining instead of terminating (decided: terminate).
- Feature-flag framework. This is one column + one endpoint, KISS.
- E2E Playwright coverage — candidate for a later change once the flow is stable.

## Human boundaries for this change

- Approving this SPEC before the first `/build` run.
- Any change to the termination semantics (e.g. drain instead of terminate).
- Running the loop itself (`claude --model fable` → `/build SPEC-workflow-toggle.md`).
