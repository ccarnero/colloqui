# ADR — Recent-traces entry point on the Message traces dashboard

- **Status**: Accepted
- **Change**: `add-time-windows-to-avoid-remember-guids`
- **Date**: 2026-07-10
- **Deciders**: platform engineering (adversarial-review consensus)

## Context

The **Message traces** Grafana dashboard (`message-traces.json`, uid `message-traces`) can
only render a trace whose `correlation_id` the operator *already has* — it must be pasted
into the `$correlation_id` textbox. To *discover* a recent `correlation_id`, the operator
leaves the dashboard: either the SQL one-liner in `DOCS/guides/trace-console.md` or the
admin-console `/processes/trace` page. The stated goal is to **stop making operators
remember or hunt for GUIDs** — surface recent traces where they already are.

Constraints in play:

- `tracking.tracked_events` has `idx_tracked_events_correlation_id` and
  `idx_tracked_events_occurred_at`, but NO composite `(correlation_id, occurred_at)` and NO
  retention policy.
- A trace can start before the operator's time window and still be active inside it.
- `correlation_id`, `kind`, and `tenant` are all nullable; drift/non-envelope rows carry a
  NULL `correlation_id`.
- The dashboard already uses `envsubst` (`$$`) for dashboard-level links but plain `$` for
  panel data links.
- The `$tenant` template variable exists but is currently referenced by no panel (dead).

## Decision

Add a single **"Recent traces"** table panel at the top of `message-traces.json`, plus a
small companion **orphan-events** stat, both fed by the existing `tracking-postgres` Postgres
datasource. One row per `correlation_id` active in `$__timeFilter(occurred_at)`, computed
with a **join-back CTE** (windowed id selection, whole-trace aggregation). Per-row data link
opens the same dashboard with `var-correlation_id` interpolated and `${__url_time_range}`
appended to preserve the window. The `$correlation_id` textbox stays as the escape hatch.

**Option A (chosen).** In-dashboard recent-traces table + textbox escape hatch.

### Options considered

**Option A — Recent-traces table panel (CHOSEN).**
- Pros: zero new backend/schema; reuses the existing Postgres datasource and data-link
  idiom already present in this exact file (connector-detail's "Last 50 calls"
  `correlation_id` link); bounded cost via `LIMIT 50`; drift made visible via description +
  orphan stat; single revertable dashboard-only PR; keeps the operator in one screen.
- Cons: rides `idx_tracked_events_correlation_id` (no composite index yet) — acceptable at
  current volume, flagged as a prod prerequisite; drift rows never listed (mitigated by the
  orphan stat).

**Option B — Rely on Tempo search / Explore for "recent traces" (REJECTED).**
- Evidence it loses: Tempo blocks retain on the order of **1 hour** in this deployment, and
  our OTel export emits **zero-duration point spans** per tracked-events row (documented in
  `.sdd/changes/trace-visualization/apply-progress.md` T8 and the connector-detail latency
  panel description). So a Tempo-native "recent traces" list would (a) silently drop
  anything older than the block window and (b) show meaningless zero durations, giving a
  *worse* and *shorter-lived* recency view than the durable Postgres `tracked_events` table.
  Tempo remains the right tool for the span waterfall of ONE known trace — not for
  discovery.

**Option C — GUID dropdown template variable (REJECTED).**
- Evidence it loses: a `query`-type variable listing recent `correlation_id`s is *still a
  wall of GUIDs* — it fails the explicit "don't make operators recognize/remember GUIDs"
  goal (an operator cannot pick "the telegram message from 2 minutes ago" out of a dropdown
  of raw UUIDs). It also scales poorly: Grafana template-variable query results are unbounded
  and re-run on every dashboard load / variable change, with no `LIMIT 50` discipline and no
  per-row context (start time, kind, event count) to disambiguate. A table row with
  start_ts/entry_kind/event_count is the human-legible unit; a bare UUID dropdown is not.

### $tenant decision

**Tenant is a display column only; `$tenant` is NOT wired into the panel WHERE (for now).**
Rationale: the join-back aggregates whole traces, so a correct tenant filter must live inside
the `recent_ids` CTE with multi/`includeAll` quoting in *raw* SQL — that quoting sits right
next to the inherited unquoted-`'$correlation_id'`-interpolation debt we are explicitly not
extending in this slice. A sortable/searchable tenant column gives the same triage power at
zero interpolation risk. `$tenant` stays defined (harmless, already present); wiring it is a
clean follow-up once the composite index lands and the interpolation debt is addressed.

### Drift-row visibility decision

**Document + cheap stat.** Rows with `correlation_id IS NULL` (rules 1/12/13/14/15/18) are
invisible to the list by construction. This is stated verbatim in the panel `description`,
AND surfaced numerically by an **orphan-events stat** — chosen because it is a *trivially
cheap* single aggregate over `idx_tracked_events_occurred_at`, not a scan. If review prefers
a strictly single-panel diff, the stat is droppable and the description alone satisfies the
requirement.

## Consequences

- Operators discover and open recent traces without leaving Grafana or knowing any GUID.
- The dashboard's three existing panels shift down by one row (`y += 8`); no other behavior
  changes; `connector-detail.json` untouched.
- New panel introduces no new interpolation debt and no new datasource.
- At scale, the feature depends on two prerequisites left OUT of this change:
  1. **Composite index `(correlation_id, occurred_at)`** — `CREATE INDEX CONCURRENTLY`,
     separate change (cannot run inside `apply-schema.ts`'s batched transaction).
  2. **`tracked_events` retention policy** — partition-drop/TTL, separate operational change.
- Rollback is `git revert` + re-apply of the ConfigMap (provisioned JSON only).
- Follow-ups: wire `$tenant` into the WHERE once the composite index exists; revisit the
  inherited unquoted `'$correlation_id'` interpolation on panels 2/3 as a hardening task.
