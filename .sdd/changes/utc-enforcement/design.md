# Design: UTC Enforcement

**Change**: `utc-enforcement`
**Status**: design
**Date**: 2026-06-29

---

## 1. Problem Statement

Angular `DatePipe` defaults to the browser's local timezone when no `timezone` argument is supplied. The admin-console has 27 call sites using `| date:` (confirmed by scan) all missing the timezone argument, plus one raw `{{ c.timestamp }}` string render in connector-detail that produces a visible ISO string rather than a formatted date. This makes timestamps display differently per user location, creating support confusion in a multi-timezone multi-tenant product.

---

## 2. Component Design

### 2.1 `UtcDatePipe`

**Location**: `services/admin-console/src/app/shared/pipes/utc-date.pipe.ts`

The pipe is a thin wrapper around Angular's `DatePipe`. It:
- Is standalone (`standalone: true`) — can be imported directly into standalone components without a module.
- Injects `DatePipe` via Angular DI so locale-aware formatting is handled by the platform.
- Overrides the `timezone` argument to `'UTC'` regardless of what the caller passes.
- Appends `' UTC'` suffix to the formatted string so users always know the displayed time is UTC.
- Accepts the same public API as `DatePipe`: `format` (required), `timezone` (accepted but ignored), `locale` (optional, passed through).

```typescript
import { Pipe, PipeTransform } from '@angular/core';
import { DatePipe } from '@angular/common';

@Pipe({
  name: 'utcDate',
  standalone: true,
  pure: true,
})
export class UtcDatePipe implements PipeTransform {
  private readonly datePipe = inject(DatePipe);

  transform(
    value: Date | string | number | null | undefined,
    format = 'medium',
    _timezone?: string,
    locale?: string,
  ): string | null {
    if (value == null) return null;
    const formatted = this.datePipe.transform(value, format, 'UTC', locale);
    return formatted != null ? `${formatted} UTC` : null;
  }
}
```

Note: `inject()` requires the pipe to be instantiated in an injection context. Because the `DatePipe` provider is registered in `provideAnimations()` / `ApplicationModule`, no extra provider is needed. If a unit test uses `TestBed`, it must provide `DatePipe` explicitly.

**No `SharedPipesModule` needed.** The existing `shared/` directory uses no barrel module — components are imported directly. The `UtcDatePipe` follows the same pattern: imported directly in each component's `imports` array.

### 2.2 Migration surface — confirmed call sites

All components are standalone (confirmed from `right-panel.component.ts` and `workflow-overview.component.ts` imports pattern). Each needs:
1. `DatePipe` removed from `imports` (where present).
2. `UtcDatePipe` added to `imports`.
3. `| date:` → `| utcDate:` in the template.

| File (relative to `services/admin-console/src/app/`) | Template change |
|---|---|
| `layout/right-panel/right-panel.component.ts:100` | `\| date: "short"` → `\| utcDate: "short"` |
| `features/identity/users/users.component.ts:121` | `\| date: "mediumDate"` → `\| utcDate: "mediumDate"` |
| `features/automation/workflows/detail/workflow-overview.component.ts:120` | `\| date: "short"` → `\| utcDate: "short"` |
| `features/automation/workflows/detail/workflow-executions.component.ts:72` | `\| date: "medium"` → `\| utcDate: "medium"` |
| `features/automation/workflows/detail/workflow-run-detail.component.ts:77` | `\| date: "medium"` → `\| utcDate: "medium"` |
| `features/automation/schedules/detail/schedule-overview.component.ts:62` | `\| date:'medium'` × 3 → `\| utcDate:'medium'` |
| `features/automation/schedules/detail/schedule-overview.component.ts:71` | (same file, second and third occurrences) |
| `features/automation/schedules/detail/schedule-overview.component.ts:80` | (same file) |
| `features/automation/schedules/detail/schedule-executions.component.ts:48` | `\| date:'medium'` × 2 → `\| utcDate:'medium'` |
| `features/automation/schedules/detail/schedule-executions.component.ts:82` | (same file) |
| `features/automation/ai/playground.component.ts:163` | `\| date:'shortTime'` → `\| utcDate:'shortTime'` |
| `features/automation/ai/agent-versions.component.ts:67` | `\| date:'medium'` → `\| utcDate:'medium'` |
| `features/automation/ai/existing-agents-panel.component.ts:77` | `\| date: "mediumDate"` → `\| utcDate: "mediumDate"` |
| `features/automation/ai/memories.component.ts:231` | `\| date: "mediumDate"` → `\| utcDate: "mediumDate"` |
| `features/automation/ai/knowledge-bases/knowledge-bases-page.component.ts:78` | `\| date:"short"` → `\| utcDate:"short"` |
| `features/automation/ai/ai.component.ts:168` | `\| date: 'short'` → `\| utcDate: 'short'` |
| `features/automation/ai/detail/ai-agent-overview.component.ts:79` | `\| date: "medium"` × 2 → `\| utcDate: "medium"` |
| `features/automation/ai/detail/ai-agent-overview.component.ts:83` | (same file) |
| `features/automation/ai/detail/ai-agent-settings.component.ts:43` | `\| date: "medium"` × 3 → `\| utcDate: "medium"` |
| `features/automation/ai/detail/ai-agent-settings.component.ts:47` | (same file) |
| `features/automation/ai/detail/ai-agent-settings.component.ts:51` | (same file, conditional expression) |
| `features/automation/ai/system-variables/system-variables-page.component.ts:110` | `\| date:"short"` → `\| utcDate:"short"` |
| `features/automation/ai/knowledge-bases/knowledge-base-detail.component.ts:134` | `\| date:"short"` → `\| utcDate:"short"` |
| `features/channels/channels.component.ts:188` | `\| date: "short"` → `\| utcDate: "short"` |
| `features/channels/detail/scoped-stream-cards.component.ts:88` | `\| date: "medium"` × 2 → `\| utcDate: "medium"` |
| `features/channels/detail/scoped-stream-cards.component.ts:98` | (same file) |
| `features/channels/detail/message-inspector-dialog.component.ts:126` | `\| date: "medium"` → `\| utcDate: "medium"` |
| `features/data-integrations/connectors/detail/connector-detail.component.ts:157` | Raw `{{ c.timestamp }}` → `{{ c.timestamp \| utcDate: "medium" }}` (also add `UtcDatePipe` to imports, no `DatePipe` to remove) |

**Total**: 17 component files, 27 template binding sites.

---

## 3. Infrastructure Design

### 3.1 CNPG PostgreSQL manifests

Add `timezone: "UTC"` to `spec.postgresql.parameters` in all 4 cluster manifests. The `parameters` block already exists in each file, so this is a single-line addition.

**Pattern** (same for all 4):
```yaml
spec:
  postgresql:
    parameters:
      timezone: "UTC"      # ← add here, alongside existing params
      max_connections: "200"
      # ... rest of existing params
```

**Files**:
- `infrastructure/base/postgres/postgres-shared-cluster.yaml`
- `infrastructure/base/postgres/postgres-temporal-cluster.yaml`
- `infrastructure/base/postgres/postgres-usage-shared-cluster.yaml`
- `infrastructure/base/postgres/postgres-temporal-visibility-cluster.yaml`

> **Note on rolling restart**: CNPG treats `timezone` as a non-superuser parameter (`GUC_NOT_IN_SAMPLE`). Setting it via `postgresql.parameters` causes a controlled rolling restart of each cluster instance. In a single-instance dev setup this is immediate. In production (if ever promoted), CNPG performs a zero-downtime rolling restart. No data changes — all columns are `TIMESTAMPTZ` (UTC binary storage).

### 3.2 Knative service manifests

Add `TZ=UTC` env var to all 19 Knative `kind: Service` manifests under `knative/services/base/`. All base manifests already have an `env:` block in `spec.template.spec.containers[0]`, so the addition point is consistent.

**Pattern**:
```yaml
spec:
  template:
    spec:
      containers:
        - name: user-container
          env:
            - name: TZ
              value: "UTC"
            - name: SERVICE_MODE   # ← existing vars follow
```

`TZ` should be the first entry in the `env` list for visibility, but order is not functionally required.

**Files (19 manifests)**:
- `knative/services/base/admin-console.yaml`
- `knative/services/base/agent-admin-service.yaml`
- `knative/services/base/agent-admin-service-worker.yaml`
- `knative/services/base/agent-ai-service.yaml`
- `knative/services/base/agent-memory-service.yaml`
- `knative/services/base/agent-scheduler-service.yaml`
- `knative/services/base/ai-agent-gateway.yaml`
- `knative/services/base/api-gateway.yaml`
- `knative/services/base/audit-service-api.yaml`
- `knative/services/base/audit-service-worker.yaml`
- `knative/services/base/auth-service.yaml`
- `knative/services/base/cache-service.yaml`
- `knative/services/base/channel-service-api.yaml`
- `knative/services/base/channel-service-worker.yaml`
- `knative/services/base/connector-admin-api.yaml`
- `knative/services/base/connector-admin-worker.yaml`
- `knative/services/base/connector-runtime.yaml`
- `knative/services/base/registry-service.yaml`
- `knative/services/base/tenant-service.yaml`
- `knative/services/base/usage-aggregator-api.yaml`
- `knative/services/base/usage-aggregator-worker.yaml`
- `knative/services/base/workflow-service-api.yaml`
- `knative/services/base/workflow-service-worker.yaml`
- `knative/services/base/workflow-worker.yaml`
- `knative/services/base/proxy-service.yaml`

> Skip `auth-secret.yaml`, `registry-service-sa.yaml`, `tenant-service-sa.yaml`, `kustomization.yaml` — these are not `kind: Service` Knative manifests.

---

## 4. ADR — UTC Enforcement Strategy

### Context

The admin-console displays timestamps fetched from backend APIs as ISO 8601 UTC strings. Angular's `DatePipe` with no timezone argument renders them in the browser's local timezone. Users in different timezones see different values for the same event, creating confusion and making log correlation with UTC-based infrastructure tools (Grafana, OTEL, Loki) difficult.

### Decision

**Replace all `| date:` usages with a custom `UtcDatePipe`** that locks the timezone to `'UTC'` and appends a `' UTC'` suffix to the formatted output. Defensively add `timezone: "UTC"` to all CNPG PostgreSQL cluster manifests and `TZ=UTC` to all Knative service manifests.

### Consequences

**Positive**:
- All users see identical timestamps regardless of browser timezone — eliminates timezone-related support tickets.
- Future "user timezone preference" feature requires changing exactly one function (the pipe's `transform` method), not 27+ call sites.
- `| utcDate:` is grep-able — easy to audit new code for compliance.
- Appended `' UTC'` suffix removes ambiguity from the UI without extra UI work.

**Negative**:
- Users accustomed to local-time display will see a change. UTC times may be less intuitive for users in UTC-offset timezones (e.g., UTC-5 shows 3 AM for an 10 PM local event). This is an intentional tradeoff — product decision is UTC-first.
- The `' UTC'` suffix is hardcoded; it will need adjustment if user timezone preference is added in future (the pipe's single change point).

### Alternatives Rejected

| Alternative | Why rejected |
|---|---|
| Add `'UTC'` as third argument inline at every call site | 27 call sites to update; no enforcement for new code; future timezone preference requires another 27-site sweep |
| Use `LOCALE_ID` provider to force UTC globally | `LOCALE_ID` controls number/currency formatting, not `DatePipe` timezone — wrong mechanism |
| Display timestamps as-is (raw ISO strings) | Already broken in connector-detail (`c.timestamp`); unformatted ISO strings are not user-friendly |
| Reformat at API layer (serialize in local timezone) | Multi-tenant — no single "local" timezone; breaks API consumers that expect UTC |

---

## 5. Data Model and Migration Notes

- No schema changes required.
- All existing timestamp columns are `TIMESTAMPTZ` (confirmed by exploration — no `TIMESTAMP WITHOUT TIMEZONE` found). PostgreSQL stores `TIMESTAMPTZ` as UTC internally; the `timezone` parameter only affects how the server renders timestamps in `TEXT` output. Backend services use ISO 8601 UTC strings from the ORM/driver, so the CNPG `timezone` change has no effect on data sent to the API. It is purely defensive for any `psql` shell sessions or direct SQL clients.
- No data migration, no downtime window, no backward-compat breakage.

---

## 6. Backward Compatibility

- The `UtcDatePipe` public signature is a superset of `DatePipe` — the `timezone` argument is accepted (for type-compatibility) but overridden. If any future code passes `'America/New_York'` to `utcDate`, it silently becomes UTC. This is intentional and consistent with the design goal.
- Component-level `DatePipe` imports are replaced, not supplemented. No dual-pipe confusion.
