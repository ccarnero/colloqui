# Tasks: UTC Enforcement

**Change**: `utc-enforcement`
**Status**: tasks-ready
**Date**: 2026-06-29

---

## Task 1 — Create `UtcDatePipe`

**File**: `services/admin-console/src/app/shared/pipes/utc-date.pipe.ts`

Create the directory `shared/pipes/` and the pipe file. The pipe must be `standalone: true`, inject `DatePipe` from `@angular/common`, override timezone to `'UTC'`, and append `' UTC'` to the formatted output.

**Acceptance check**:
- File exists at the path above.
- `ng build` (or `tsc --noEmit`) passes with no errors in the shared/pipes module.
- Unit test: given ISO string `"2024-01-15T14:30:00.000Z"` and format `"medium"`, the pipe returns a string ending in `' UTC'`.
- Unit test: `null` input returns `null`.
- `grep -r "standalone: true" services/admin-console/src/app/shared/pipes/utc-date.pipe.ts` passes.

---

## Task 2 — Migrate `layout/right-panel` component

**File**: `services/admin-console/src/app/layout/right-panel/right-panel.component.ts`

Replace `DatePipe` import with `UtcDatePipe`. Replace `| date: "short"` with `| utcDate: "short"` at line 100.

**Acceptance check**:
- `DatePipe` no longer appears in `imports` array.
- `UtcDatePipe` appears in `imports` array.
- Template contains `| utcDate:` not `| date:`.
- `ng build` passes.

---

## Task 3 — Migrate `features/identity/users` component

**File**: `services/admin-console/src/app/features/identity/users/users.component.ts`

Replace `| date: "mediumDate"` → `| utcDate: "mediumDate"`. Swap `DatePipe` for `UtcDatePipe` in imports.

**Acceptance check**:
- No `| date:` in file. `UtcDatePipe` in imports. `ng build` passes.

---

## Task 4 — Migrate `features/automation/workflows/detail` components (3 files)

**Files**:
- `workflow-overview.component.ts` — `| date: "short"` → `| utcDate: "short"`
- `workflow-executions.component.ts` — `| date: "medium"` → `| utcDate: "medium"`
- `workflow-run-detail.component.ts` — `| date: "medium"` → `| utcDate: "medium"`

Swap `DatePipe` → `UtcDatePipe` in all three.

**Acceptance check**:
- `grep -n "| date:" services/admin-console/src/app/features/automation/workflows/detail/*.ts` returns no output.
- `ng build` passes.

---

## Task 5 — Migrate `features/automation/schedules/detail` components (2 files)

**Files**:
- `schedule-overview.component.ts` — 3 occurrences of `| date:'medium'` → `| utcDate:'medium'`
- `schedule-executions.component.ts` — 2 occurrences of `| date:'medium'` → `| utcDate:'medium'`

Swap `DatePipe` → `UtcDatePipe` in both.

**Acceptance check**:
- `grep -n "| date:" services/admin-console/src/app/features/automation/schedules/detail/*.ts` returns no output.
- `ng build` passes.

---

## Task 6 — Migrate `features/automation/ai` components (9 files)

**Files**:
- `playground.component.ts` — `| date:'shortTime'` → `| utcDate:'shortTime'`
- `agent-versions.component.ts` — `| date:'medium'` → `| utcDate:'medium'`
- `existing-agents-panel.component.ts` — `| date: "mediumDate"` → `| utcDate: "mediumDate"`
- `memories.component.ts` — `| date: "mediumDate"` → `| utcDate: "mediumDate"`
- `knowledge-bases/knowledge-bases-page.component.ts` — `| date:"short"` → `| utcDate:"short"`
- `ai.component.ts` — `| date: 'short'` → `| utcDate: 'short'`
- `detail/ai-agent-overview.component.ts` — 2 occurrences `| date: "medium"` → `| utcDate: "medium"`
- `detail/ai-agent-settings.component.ts` — 3 occurrences `| date: "medium"` → `| utcDate: "medium"` (note: one is inside a conditional expression `(current.published_at | date: "medium")`)
- `system-variables/system-variables-page.component.ts` — `| date:"short"` → `| utcDate:"short"`
- `knowledge-bases/knowledge-base-detail.component.ts` — `| date:"short"` → `| utcDate:"short"`

Swap `DatePipe` → `UtcDatePipe` in each file.

**Acceptance check**:
- `grep -rn "| date:" services/admin-console/src/app/features/automation/ai/` returns no output.
- `ng build` passes.

---

## Task 7 — Migrate `features/channels` components (3 files) + fix connector-detail raw string

**Files**:
- `channels/channels.component.ts` — `| date: "short"` → `| utcDate: "short"`
- `channels/detail/scoped-stream-cards.component.ts` — 2 occurrences `| date: "medium"` → `| utcDate: "medium"`
- `channels/detail/message-inspector-dialog.component.ts` — `| date: "medium"` → `| utcDate: "medium"`
- `data-integrations/connectors/detail/connector-detail.component.ts:157` — raw `{{ c.timestamp }}` → `{{ c.timestamp | utcDate: "medium" }}` (add `UtcDatePipe` to imports; no `DatePipe` to remove)

**Acceptance check**:
- `grep -rn "| date:" services/admin-console/src/app/features/channels/ services/admin-console/src/app/features/data-integrations/` returns no output.
- `grep "c\.timestamp\b" services/admin-console/src/app/features/data-integrations/connectors/detail/connector-detail.component.ts` shows the pipe applied.
- `ng build` passes.

---

## Task 8 — Add `timezone: "UTC"` to all 4 CNPG cluster manifests

**Files**:
- `infrastructure/base/postgres/postgres-shared-cluster.yaml`
- `infrastructure/base/postgres/postgres-temporal-cluster.yaml`
- `infrastructure/base/postgres/postgres-usage-shared-cluster.yaml`
- `infrastructure/base/postgres/postgres-temporal-visibility-cluster.yaml`

Add `timezone: "UTC"` as the first entry in `spec.postgresql.parameters` in each file.

**Acceptance check**:
- `grep -n "timezone" infrastructure/base/postgres/postgres-*-cluster.yaml` shows 4 matches, one per file.
- `kubectl apply --dry-run=client -f infrastructure/base/postgres/` passes (or equivalent kustomize validation if kustomization.yaml wraps these).

---

## Task 9 — Add `TZ=UTC` env var to all Knative service manifests

**Files** (19 `kind: Service` manifests in `knative/services/base/`):
admin-console, agent-admin-service, agent-admin-service-worker, agent-ai-service, agent-memory-service, agent-scheduler-service, ai-agent-gateway, api-gateway, audit-service-api, audit-service-worker, auth-service, cache-service, channel-service-api, channel-service-worker, connector-admin-api, connector-admin-worker, connector-runtime, registry-service, tenant-service, usage-aggregator-api, usage-aggregator-worker, workflow-service-api, workflow-service-worker, workflow-worker, proxy-service.

Add the following as the first item in each service's `env` list:
```yaml
- name: TZ
  value: "UTC"
```

Skip `auth-secret.yaml`, `registry-service-sa.yaml`, `tenant-service-sa.yaml`, `kustomization.yaml`.

**Acceptance check**:
- `grep -rn "name: TZ" knative/services/base/*.yaml | wc -l` returns 25 (one per Knative Service file).
- `kubectl apply --dry-run=client -f knative/services/base/` passes (or equivalent kustomize validation).

---

## Task 10 — Final audit and build verification

Run a complete audit to confirm no `| date:` remains in the admin-console source, and that the build is clean.

**Acceptance check**:
- `grep -rn "| date:" services/admin-console/src/` returns no output.
- `grep -rn "DatePipe" services/admin-console/src/` returns no output (all replaced by `UtcDatePipe`).
- `ng build` (production build) exits 0.
- `grep -c "name: TZ" knative/services/base/*.yaml | grep -v ":0" | wc -l` returns 25.
- `grep -c "timezone" infrastructure/base/postgres/postgres-*-cluster.yaml | grep -v ":0" | wc -l` returns 4.

---

## Dependency Order

```
Task 1 (create pipe)
  └── Tasks 2–7 (frontend migration, can be done in parallel per file)
        └── Task 10 (final audit)
Task 8 (CNPG) — independent, no dependencies
Task 9 (Knative) — independent, no dependencies
```

Tasks 8 and 9 can be done at any time independently of the frontend work.
