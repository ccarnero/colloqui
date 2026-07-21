# SPEC — Console redesign: Dashboard (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-foundation.md` (must be shipped).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-dashboard'.

## Goal

The Dashboard section renders as the operational overview defined in the
design contract: fleet-level health metrics up top, a "needs attention" panel
surfacing degraded items across all sections, and activity summaries — all
composed from foundation primitives, fed by the existing dashboard data
sources.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: "Dashboard" section of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (+ screenshot).
2. Layout: metric cards row (MetricCard + Sparkline) → needs-attention panel
   (NeedsAttentionPanel) → recent-activity table (InventoryTable).
3. Needs-attention rows deep-link to the owning section's route (e.g. a
   failing channel links into Channels); links use existing routes only.
4. No new API endpoints: compose from the data the current dashboard already
   fetches. Missing data = report finding, don't invent.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `services/admin-console/src/app/features/overview/dashboard/dashboard.component.ts`
  — existing screen; replace presentation only.
- `services/admin-console/src/app/core/services/dashboard.service.ts` +
  `core/services/metrics/` — data sources; reuse as-is.
- `src/app/shared/components/` kpi-card, sparkline, activity-feed — restyled
  by L0; compose, don't fork.
- `src/app/shared/components/` — foundation primitives (L0). Composing screens must
  NOT fork or restyle them.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Colors/spacing only via foundation CSS custom properties — no hard-coded hex.
- Only `services/admin-console/src/app/features/overview/dashboard/` (+ its tests) is touched;
  primitives are consumed, never modified, in this loop.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — unit tests
cd services/admin-console && pnpm exec ng test --watch=false
# G2 — typecheck
cd services/admin-console && pnpm exec tsc -p tsconfig.app.json --noEmit
# G5a — COMMIT GATE (once per task): dev-mode smoke — ng serve boots and serves the shell
cd services/admin-console && node scripts/dev-smoke.mjs
# G5b — COMMIT GATE (once per task): production build
cd services/admin-console && pnpm run build
```

Gate rules: identical to `manual-loops/admin-console/console-redesign-foundation.md`
.

---

## Task queue

### T01 — Inventory report (no code)

- Map `src/app/features/overview/dashboard/` and
  `core/services/dashboard.service.ts` (+ `metrics/`): what data
  each widget consumes today, and which of the redesign's metrics can be
  derived from it. Record as "**T01 findings (recorded <date>):**" in this
  SPEC; flag any redesign metric with no existing data source.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-dashboard.md
```

### T02 — Metrics row + needs-attention panel

- Rebuild the top of the dashboard: MetricCard row with sparklines, then
  NeedsAttentionPanel fed by a `DashboardAttentionService` (or extend the
  existing service per T01 findings) aggregating degraded items.
- Unit tests: metrics map from service data; empty attention state; row
  deep-links match decision 3.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Activity table + old-widget retirement

- Recent-activity via InventoryTable; remove replaced legacy widgets and
  their dead styles. DO NOT remove data services still used elsewhere.
- Unit tests: table renders activity rows; removed widgets' specs deleted
  alongside their components (not skipped).

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Docs + index

- Update `services/admin-console/README.md` (dashboard composition), add entry to
  `cowork/INDEX.md`, log decisions to Engram topic
  'admin-console/redesign-dashboard'.

**Accept**
```
grep -n "console-redesign-dashboard" cowork/INDEX.md
```

---

- [ ] T01 inventory report
- [ ] T02 metrics + needs-attention
- [ ] T03 activity table + retirement
- [ ] T04 docs + index

## Out of scope (explicit)

- New API endpoints or backend aggregation — front composes existing data.
- Realtime/websocket updates — current refresh behavior is kept.
- Touching other sections' screens — deep links only.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Deviating from the binding visual contract requires human sign-off.
- Any metric that needs a new data source is a finding + human decision, not
  an invented number.
