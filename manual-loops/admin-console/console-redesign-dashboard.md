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
   **AMENDED 2026-07-21 (human sign-off, post-T01 finding 4):** the binding
   design has NO needs-attention panel on Dashboard (it belongs to the
   Channels ops view — L2). Follow the design: metric cards row → API-usage
   chart + Activity row → recent-workflows table (InventoryTable). Decision 3
   below applies only when/where an attention panel exists (L2), not here.
3. Needs-attention rows deep-link to the owning section's route (e.g. a
   failing channel links into Channels); links use existing routes only.
4. No new API endpoints: compose from the data the current dashboard already
   fetches. Missing data = report finding, don't invent.
   **AMENDED 2026-07-21 (human sign-off, post-T01 finding 6):** the
   recent-workflows table renders ONLY columns with real data sources today
   (name, executions, sparkline where a series exists). Trigger, p95 and
   Estado are deferred until the backend exposes them; the hard-coded
   `successRate: 1` must NOT be rendered as if real.

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

**T01 findings (recorded 2026-07-21):**

0. **Prior-art correction — "activity-feed" is not on the Dashboard's Prior-art
   list use:** the Prior art section cites
   `src/app/shared/components/` kpi-card, sparkline, activity-feed as
   "restyled by L0; compose, don't fork." `activity-feed` exists at
   `services/admin-console/src/app/shared/components/activity-feed/activity-feed.component.ts`
   and was indeed shipped by the foundation loop, but the actual design
   contract's Dashboard "Actividad" list (see finding 3 below) is a plain
   timestamp+dot+text row, not the current `dashboard.component.ts` widget —
   no code in `dashboard.component.ts` currently renders `activity-feed` or
   any activity list at all (verified: no `app-activity-feed` selector or
   `recentActivity` reference in the file). This is not wrong, just
   unconfirmed — flagged so T02/T03 know `activity-feed` reuse is a new
   wiring, not a restyle of an existing usage.

1. **`dashboard.service.ts`** (`services/admin-console/src/app/core/services/dashboard.service.ts`,
   89 lines) — single HTTP source: `GET {apiUrl}/dashboard/stats`
   (line 77), refreshed every 60 s via `setInterval` (line 40, wired in
   `startPolling()` lines 52-59). Returns `IDashboardStats` (lines 22-38):
   `requestsToday`/`requestsTodayDelta` (23-24), `activeSessions` (25),
   `avgResponseMs`/`avgResponseDelta` (26-27), `errorRate`/`errorRateDelta`
   (28-29), `dailyBreakdown: IDashboardDailyBreakdown[]` (30, shape at
   lines 5-9: `date`/`requests`/`avgLatencyMs`), `uptime` (31),
   `p95ResponseMs` (32), `quotaApiCalls`/`quotaStorage`/`quotaWebhooks:
   IDashboardQuota` (33-35, shape at lines 11-14: `used`/`limit`),
   `recentActivity: IDashboardActivity[]` (36, shape at lines 16-20:
   `type`/`text`/`timestamp`), `serviceHealth: Record<string, "ok" |
   "unreachable">` (37).

2. **`dashboard.component.ts`** (`services/admin-console/src/app/features/overview/dashboard/dashboard.component.ts`,
   206 lines) currently renders only 4 of the 8 top-level `IDashboardStats`
   fields:
   - `app-kpi-card` "API Calls Today" (lines 45-50) ← `requestsToday`/
     `requestsTodayDelta` via `formattedRequests()` (150-152) and
     `requestsDeltaText()`/`requestsTrend()` (154-157, 164-167).
   - `app-kpi-card` "Active Sessions" (51-55) ← `activeSessions` directly.
   - `app-kpi-card` "Avg Response" (56-59) ← `avgResponseMs` directly (no
     sub-text rendered, even though `avgDeltaText`/`avgDeltaCss` computeds
     exist at lines 169-178 — **dead code, never bound in the template**).
   - `app-kpi-card` "Error Rate" (60-66) ← `errorRate`/`errorRateDelta` via
     `errorDeltaText()`/`errorTrend()` (159-162, 180-183).
   - `app-sparkline` "API Usage" (78-86) ← `dailyBreakdown[].requests` via
     `apiUsageData()` (185-187); "Request Latency" (87-102) ←
     `dailyBreakdown[].avgLatencyMs` via `latencyData()` (189-191);
     `dayLabels()` (193-197) derives weekday labels from `dailyBreakdown[].date`.
   - **`uptime`, `p95ResponseMs`, `quotaApiCalls`/`quotaStorage`/
     `quotaWebhooks`, `recentActivity`, and `serviceHealth` are fetched by
     the service but consumed nowhere in the current component** — these
     are the fields available for the redesign without any new endpoint.

3. **Design contract — Dashboard section**, `manual-loops/admin-console/design/Rediseño Terminal.dc.html`
   lines 92-155 (`data-screen-label="Dashboard"`, line 94), confirmed
   against `manual-loops/admin-console/design/01-dashboard.png`. Contents,
   top to bottom:
   - Header (95-101): title + subtitle "Última actualización hace 15 s ·
     ● todos los servicios operativos" (98) + "Export report" button (100).
   - 4-column metric strip (102-123): "API calls today" ↑12.4% vs ayer
     (104-106), "Active sessions" / últimos 15 min (108-111), "Avg response"
     214ms / "p50 · 7 días" (113-116), "Error rate" 0.42% ↓0.08% vs ayer
     (118-121).
   - 2-column row (124-146): "API usage · 7 días" sparkline + static
     "NORMAL" badge (125-136), "Actividad" list — 4 rows of
     `timestamp + colored dot + text` (137-145, e.g. green dot "workflow
     lead-qualification ejecutado" at 14:22, red dot "delivery fallida"
     at 14:07).
   - "Workflows recientes" table (147-153): columns Nombre / Trigger /
     Ejecuciones / p95 / Estado, 3 sample rows.
   - **There is no "needs attention" panel anywhere in the Dashboard
     section (lines 92-155).** A "Necesita atención" panel does exist in
     the design file, but only in the Channels ops-view screen (lines
     301-319, `showChannelsOps`), not Dashboard.

4. **FLAG — User decision 2 contradicts the visual contract it cites.**
   Decision 2 specifies the Dashboard layout as "metric cards row →
   needs-attention panel → recent-activity table", and the Prior art /
   Goal sections repeat "needs-attention panel surfacing degraded items
   across all sections" as part of Dashboard. Per finding 3, the actual
   Dashboard screen in `Rediseño Terminal.dc.html` (the visual contract
   named in decision 1) has no needs-attention panel — that layout element
   belongs to the Channels screen. This is a **human decision required**
   per this SPEC's own "Human boundaries" section ("Deviating from the
   binding visual contract requires human sign-off."): either (a) T02 adds
   a needs-attention panel to Dashboard as a deliberate deviation from the
   binding mock (sign-off needed), or (b) decision 2 is corrected to drop
   the needs-attention panel and Dashboard keeps only metric cards →
   API-usage/Actividad row → Workflows-recientes table, matching the mock
   exactly.

5. **Design-metric → data-source mapping** (assuming decision 4, "compose
   from data the current dashboard already fetches"):
   - "API calls today", "Active sessions", "Avg response", "Error rate" →
     `IDashboardStats.requestsToday`/`activeSessions`/`avgResponseMs`/
     `errorRate` (+ their `*Delta` fields) — **clean, already wired** (see
     finding 2).
   - "● todos los servicios operativos" header subtitle → derivable from
     `IDashboardStats.serviceHealth` (`dashboard.service.ts:37`): if every
     value is `"ok"`, show the green "operativos" text; otherwise degrade
     the message. **Data exists, not yet consumed.**
   - "Última actualización hace 15 s" (relative refresh time) → **NO DATA
     SOURCE in `IDashboardStats`.** There is no last-fetch timestamp field.
     This is derivable client-side from the component's own poll clock
     (it already knows when `fetchStats()` last resolved via
     `startPolling()`, `dashboard.service.ts:52-59`), not from the API —
     flagged because it is not literally "existing data" from the service,
     it is a new client-side clock the component would have to track.
   - "API usage · 7 días" sparkline → `dailyBreakdown[].requests` — clean,
     already wired (`apiUsageData()`, `dashboard.component.ts:185-187`).
   - Static "NORMAL" badge on the API-usage chart → **NO DATA SOURCE** for
     a computed value; the design hard-codes this text/color, and so does
     the current component (`<span class="badge badge-green">Normal</span>`,
     `dashboard.component.ts:76`) — consistent with the mock, not a gap.
   - "Actividad" recent-activity rows → `IDashboardStats.recentActivity`
     (`type`/`text`/`timestamp`, `dashboard.service.ts:16-20,36`) — text and
     timestamp map cleanly, but **the dot color in the design is a severity
     derived from context (green=success, red=failed delivery,
     link-blue=info, yellow=degraded) and `IDashboardActivity.type` is an
     untyped free string with no defined severity mapping anywhere in the
     codebase.** A `type` → dot-color/severity mapping function would need
     to be written in T02/T03; it is a derivation gap, not a missing raw
     field.
   - "Workflows recientes" table (columns Nombre / Trigger / Ejecuciones /
     p95 / Estado) → closest existing source is
     `ProcessesMetricsService.topWorkflows`
     (`services/admin-console/src/app/core/services/metrics/processes-metrics.service.ts:40`,
     `ITopWorkflowEntry` shape at lines 11-16: `id`/`name`/`runs7d`/
     `successRate`, populated by `loadTopWorkflows()` lines 51-78 against
     `${apiUrl}/workflows` + `${apiUrl}/workflows/executions/counts`).
     **Only 2 of 5 design columns map: Nombre ← `name`, Ejecuciones ←
     `runs7d`. Trigger (channel binding), p95 (latency), and Estado
     (active/disabled) have NO existing data source** — `successRate` is
     the closest field but is hard-coded to `1` for every row (line 68,
     never computed from real success/failure counts) and does not map to
     "Estado". **FLAG per decision 4: Trigger/p95/Estado are a finding for
     human decision, not to be invented.**

6. **Needs-attention candidate sources** (relevant only if finding 4 is
   resolved in favor of keeping a needs-attention panel on Dashboard):
   - `IDashboardStats.serviceHealth` (`dashboard.service.ts:37`) — the only
     currently *populated*, real, cross-fleet health signal; each
     `"unreachable"` entry could become a critical row. This is the one
     legitimately usable source without new work.
   - `ConnectionsMetricsService.httpErrored`/`externalErrored`/
     `internalErrored`
     (`services/admin-console/src/app/core/services/metrics/connections-metrics.service.ts:43,45,65-72`)
     — real, populated via `loadCounts()`; could deep-link to
     `connections/http` per decision 3.
   - `ChannelsMetricsService.failedDeliveries24h`
     (`services/admin-console/src/app/core/services/metrics/channels-metrics.service.ts:36`)
     — **declared but never `.set()` anywhere in the file; stays `null`
     forever.** Not usable as-is.
   - `ProcessesMetricsService.workflowsFailing`
     (`processes-metrics.service.ts:36`) — **also declared but never set.**
     Not usable as-is.
   - `SettingsMetricsService.quotasNearLimit`/`auditAlerts`
     (`services/admin-console/src/app/core/services/metrics/settings-metrics.service.ts:38-39`)
     and `AiMetricsService.pendingMemoryProposals`
     (`services/admin-console/src/app/core/services/metrics/ai-metrics.service.ts:29`)
     — all three are explicitly commented **"PHASE 2 DEMO SEEDS"**
     (`settings-metrics.service.ts:35`, `ai-metrics.service.ts:25`) with
     hard-coded literal values (e.g. `signal<number | null>(3)`). These are
     already-invented placeholder numbers, not live data — using them in a
     needs-attention panel would surface fake incidents and violates
     decision 4's spirit even though the signals technically exist. **FLAG
     for human decision: exclude, or accept as known-fake placeholders.**
   - `OverviewMetricsService` (`overview-metrics.service.ts`, 24 lines) is
     a **"Phase 1 stub"** (file header comment, line 6): every signal
     (`conversationsActive`, `messages24h`, `aiInvocations24h`,
     `workflowRuns24h`, `errorRate24h`) returns `null` and is never wired to
     a fetch. Not usable for any Dashboard metric.

7. **Foundation primitives available for composition, confirmed present**
   at `services/admin-console/src/app/shared/components/`: `kpi-card/`,
   `sparkline/`, `status-badge/`, `inventory-table/`, `needs-attention-panel/`,
   `detail-dialog/`, `activity-feed/`, `page-header/`. `needs-attention-panel`
   (`needs-attention-panel.component.ts`, selector `app-needs-attention-panel`
   line 33, class `NeedsAttentionPanelComponent` line 136) takes
   `IAttentionIssue[]` with `severity: "critical" | "warning" | "info"`
   (lines 10, 19-24) — compatible with the `serviceHealth`/error-count
   sources in finding 6, once mapped to that shape.

### T02 — Metrics row + API-usage/activity row (amended per decision 2)

- Rebuild the top of the dashboard per the amended decision 2: MetricCard row
  with sparklines (4 metrics from `IDashboardStats`), then the API-usage
  chart + Activity row as the design shows. NO needs-attention panel here.
- Unit tests: metrics map from service data; empty/loading states; activity
  rows render from `recentActivity`.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Recent-workflows table + old-widget retirement (amended per decision 4)

- Recent-workflows via InventoryTable, real columns only (name, executions,
  sparkline where a series exists — per amended decision 4); remove replaced
  legacy widgets and their dead styles. DO NOT remove data services still
  used elsewhere.
- Unit tests: table renders workflow rows; removed widgets' specs deleted
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

- [x] T01 inventory report
- [x] T02 metrics + needs-attention
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
