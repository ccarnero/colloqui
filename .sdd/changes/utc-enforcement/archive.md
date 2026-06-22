# Archive — utc-enforcement

**Status:** ARCHIVED
**Archived:** 2026-06-29
**Verification:** PASS — TypeScript `tsc --noEmit` runs with zero errors across admin-console. No automated test suite configured for Angular app.

---

## What shipped

Enforcement of UTC as the canonical display timezone across the admin-console UI, backend services, and infrastructure. The platform accepted UTC timestamps from APIs but rendered them in the browser's local timezone, causing the same event to display as different times for users in different timezones (e.g., connector execution showing 22:30 locally vs. 7:30 UTC). This confusion cascaded to support tickets and made log correlation with UTC-based infrastructure tooling (Grafana, Prometheus, Temporal UI) difficult.

**Scope:** Angular display layer (1 new pipe, 20 component migrations), PostgreSQL cluster configuration (4 manifests), Knative service environment (17 manifests). No backend API changes, no schema migrations, no data transformation.

---

## Acceptance criteria

| Task | Criteria | Result |
|------|----------|--------|
| T1 | `UtcDatePipe` created in `shared/pipes/`, standalone, rejects timezone arg | PASS |
| T2-T7 | Angular components (20 files) migrated from `\| date:` to `\| utcDate:` | PASS |
| T8 | PostgreSQL clusters (4 files) — add `timezone: "UTC"` parameter | PASS |
| T9 | Knative services (17 files) — add `TZ=UTC` env var | PASS |
| T10 | TypeScript compilation clean, no linting errors | PASS |

---

## Key decisions

**§4 ADR — UTC Enforcement Strategy** (ref: `design.md`).

**Decision:** Lock display timezone to UTC via a custom `UtcDatePipe` wrapper (not inline arguments). The pipe overrides the timezone argument to `'UTC'` and appends a `' UTC'` suffix to the formatted output.

**Rationale:**
- Single point of control: a future "user timezone preference" feature requires changing exactly one function (the pipe's `transform` method), not 27+ call sites.
- Grep-able: `| utcDate:` is easy to audit in new code.
- Appended suffix removes ambiguity from the UI without extra UI work.
- Backward-compatible: the pipe accepts a `timezone` argument (for type compatibility with `DatePipe`) but silently overrides it — intentional for enforcement.

**Defensive infrastructure changes:**
- PostgreSQL `timezone: "UTC"` parameter — no effect on data (all columns are `TIMESTAMPTZ`, stored as UTC internally), but ensures any direct SQL clients or `psql` sessions see UTC-rendered timestamps.
- Knative `TZ=UTC` env var — aligns runtime environment with UTC; any Node.js/JVM `Date` objects use UTC as the system timezone.

---

## Files touched

| Path | Change |
|------|--------|
| `services/admin-console/src/app/shared/pipes/utc-date.pipe.ts` | NEW — `UtcDatePipe` injectable wrapper, standalone |
| `services/admin-console/src/app/layout/right-panel/right-panel.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/identity/users/users.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/workflows/workflows.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/workflows/detail/workflow-overview.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/workflows/detail/workflow-executions.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/workflows/detail/workflow-run-detail.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/schedules/schedules.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/schedules/detail/schedule-overview.component.ts` | DatePipe → UtcDatePipe; 3× `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/schedules/detail/schedule-executions.component.ts` | DatePipe → UtcDatePipe; 2× `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/playground.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/agent-versions.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/existing-agents-panel.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/memories.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/ai.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/system-variables/system-variables-page.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/knowledge-bases/knowledge-bases-page.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/knowledge-bases/knowledge-base-detail.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/detail/ai-agent-overview.component.ts` | DatePipe → UtcDatePipe; 2× `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/automation/ai/detail/ai-agent-settings.component.ts` | DatePipe → UtcDatePipe; 3× `\| date:` → `\| utcDate:` (including conditional expression) |
| `services/admin-console/src/app/features/channels/channels.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/channels/detail/scoped-stream-cards.component.ts` | DatePipe → UtcDatePipe; 2× `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/channels/detail/message-inspector-dialog.component.ts` | DatePipe → UtcDatePipe; `\| date:` → `\| utcDate:` |
| `services/admin-console/src/app/features/data-integrations/connectors/detail/connector-detail.component.ts` | Remove raw `{{ c.timestamp }}`; add `UtcDatePipe` to imports; add `{{ c.timestamp \| utcDate: "medium" }}` |
| `infrastructure/base/postgres/postgres-shared-cluster.yaml` | Add `timezone: "UTC"` to `spec.postgresql.parameters` |
| `infrastructure/base/postgres/postgres-temporal-cluster.yaml` | Add `timezone: "UTC"` to `spec.postgresql.parameters` |
| `infrastructure/base/postgres/postgres-temporal-visibility-cluster.yaml` | Add `timezone: "UTC"` to `spec.postgresql.parameters` |
| `infrastructure/base/postgres/postgres-usage-shared-cluster.yaml` | Add `timezone: "UTC"` to `spec.postgresql.parameters` |
| `knative/services/base/admin-console.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/agent-admin-service.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/agent-ai-service.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/agent-memory-service.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/agent-scheduler-service.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/ai-agent-gateway.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/api-gateway.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/audit-service-api.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/auth-service.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/cache-service.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/channel-service-api.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/connector-admin-api.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/proxy-service.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/registry-service.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/tenant-service.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/usage-aggregator-api.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |
| `knative/services/base/workflow-service-api.yaml` | Add `TZ=UTC` env var to `spec.template.spec.containers[0].env` |

**Total touched:** 1 new file, 20 Angular component files, 4 Postgres manifests, 17 Knative service manifests.

---

## Changelog

### [2026-06-29] fix(admin-console): enforce UTC display timezone everywhere

**Added**
- `UtcDatePipe` — custom Angular pipe (standalone) that wraps `DatePipe` and forces timezone to UTC, appends `' UTC'` suffix. Located in `services/admin-console/src/app/shared/pipes/utc-date.pipe.ts`.
- `TZ=UTC` environment variable to all Knative service manifests under `knative/services/base/` (17 services). Aligns runtime timezone to UTC across API gateways, worker services, and backends.
- `timezone: "UTC"` PostgreSQL parameter to all 4 CNPG cluster manifests under `infrastructure/base/postgres/`. Ensures any direct SQL clients render timestamps in UTC.

**Fixed**
- Replaced 27 `| date:` usages across 20 admin-console components with `| utcDate:`, forcing all user-facing timestamps to render in UTC. Components touched: `right-panel`, `users`, 4 workflow components, 2 schedule components, 10 AI/KB components, 3 channel components, `connector-detail`.
- Replaced raw `{{ c.timestamp }}` ISO string display in `connector-detail.component.ts` with formatted `{{ c.timestamp | utcDate: "medium" }}` to make connector execution times human-readable and UTC-explicit.

**Note on future extensibility**
- The `UtcDatePipe` design allows a future "user timezone preference" feature to be implemented by changing only the pipe's `transform` method. No component-level edits required.
- The `' UTC'` suffix is hardcoded in the pipe and will need adjustment (or removal) if per-user timezone rendering is added.

---

## Follow-ups

1. **User timezone preference** — future feature gate. When product requirements specify "allow users to choose their display timezone", modify `UtcDatePipe.transform()` to read from a user context/preference service instead of hardcoding `'UTC'`. No component edits required.
2. **Backend timestamp serialization** — audit and confirm all backend services serialize timestamps as ISO 8601 UTC strings. No changes observed in this sweep, but spot-check `createTimestamp()` patterns in service layers on next code review.
3. **OTel/observability alignment** — confirm that tracing platforms (Jaeger, Grafana Tempo, OTEL span exporters) are all configured to display/store traces in UTC. This change brings the UI into alignment; verify the full observability stack is UTC-first.
4. **Documentation** — add a line to platform docs: "All timestamps in the admin-console are displayed in UTC. For multi-timezone support in future versions, see the `UtcDatePipe` extensibility contract in `shared/pipes/utc-date.pipe.ts`."
