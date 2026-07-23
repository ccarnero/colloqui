# SPEC — Console redesign: Users, Analytics, Settings (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-foundation.md` (must be shipped).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-users-analytics-settings'.

## Goal

Users, Analytics, and Settings render in the new visual language: Users as an
inventory table with role/status, Analytics with the metric-card + chart
compositions of the contract, Settings as the grouped-form layout — all
keeping current behavior, permissions, and data sources.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: "Users", "Analytics", "Settings" sections of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (+ screenshots
   `18-analytics.png`, `19-analytics-tables.png`, `17-settings-users.png`).
2. These are restyles: no new capabilities, columns, metrics, or settings.
   **AMENDED 2026-07-23 (human sign-off, post-T01 findings 2-3):**
   (a) Analytics: the current screen is 100% hard-coded mock data. T03
   rebuilds it from REAL metrics already available (dashboard service stats,
   channel usage totals, workflows summary) composed with kpi-card +
   UsageChart; the mocks are removed. The design's metric set
   (conversaciones / resueltas sin humano / tokens LLM / per-agent tables)
   has no data source — backend follow-up, never invented.
   (b) Settings: there is no Settings form screen (in code or design). T04
   re-scopes to restyling the existing settings-hub navigation cards with
   tokens/primitives; the field-id snapshot test is replaced by link +
   permission assertions.
3. Analytics charts reuse whatever chart approach exists today; if none, use
   the foundation Sparkline plus simple SVG bar/line composition — no chart
   library without human sign-off.
   **RESOLVED 2026-07-23 (post-T01): reuse the existing `UsageChartComponent`
   multi-series SVG area+line pattern (features/channels/detail/) — no new
   chart library needed.**
4. No new API endpoints.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `features/identity/users/users.component.ts`;
  `core/services/tenant-users.service.ts`, `role.service.ts`;
  `core/models/user.model.ts`; `core/guards/auth.guard.ts`. Forms and
  guards REUSED unchanged.
- `features/overview/analytics/analytics.component.ts` +
  `core/services/metrics/` — existing metrics only.
- `features/settings-hub/settings-hub.component.ts` — settings hub.
- `src/app/shared/components/` — foundation primitives; consume, never fork.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex.
- Only the three feature folders are touched, one per task — a diff spanning
  two sections is automatic rejection.

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

Gate rules: identical to `manual-loops/admin-console/console-redesign-foundation.md`.

---

## Task queue

### T01 — Inventory report (no code)

- Map the three features: components, services, forms, guards, existing
  chart usage in analytics. Record "**T01 findings (recorded <date>):**"
  in this SPEC.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-users-analytics-settings.md
```

**T01 findings (recorded 2026-07-23):**

1. **Users** — `services/admin-console/src/app/features/identity/users/users.component.ts:97-149`
   renders a `mat-table` (Angular Material table), not cards. Columns
   (`displayedColumns`, line 159-165): `email`, `display_name`, `role`,
   `created_at`, `actions`. The `role` cell uses the foundation
   `StatusBadgeComponent` (line 112-116); `created_at` is formatted with
   `UtcDatePipe`.
   - Fields per user come from `IUser`
     (`core/models/user.model.ts:1-10`): `id`, `tenant_id`, `email`,
     `role_id`, `role`, `display_name`, `created_at`, `updated_at`. There is
     **no `status` field and no `last-active`/`last_active` field anywhere
     on `IUser`** — a "last active" or "status" column has no backing data.
     This is moot for this task: the design mock (see point 4) does **not**
     show a status or last-active column either, so decision 2 is
     satisfied — no flag needed, but any future addition of those columns
     would violate decision 2.
   - Actions found: "+ Add User" button (`users.component.ts:50-58`), gated
     by `authService.hasPermission("users:create")`, opens
     `CreateTenantUserDialogComponent`
     (`features/identity/users/create-tenant-user-dialog.component.ts:39-121`,
     a Material dialog with Email/Display Name/Password/Role fields,
     `submit()` at line 188 calling `tenantUsers.createUser(...)`). Row
     action: "Deactivate user" icon button (`users.component.ts:127-137`),
     gated by `authService.hasPermission("users:delete")`, calls
     `deactivateUser(id)` (line 188) → `tenantUsers.deleteUser(id)`. **There
     is no "edit" action or edit dialog anywhere under
     `features/identity/users/`** (only `create-tenant-user-dialog.component.ts`
     exists; `fd` over the folder returns just the component, its dialog,
     and their `.spec.ts` files). `hasPermission` is implemented on
     `BaseAuthService` from `@yoizen/angular-shared`
     (`core/services/auth.service.ts:12`), not defined locally.
   - APIs: `TenantUsersService` (`core/services/tenant-users.service.ts:23-37`)
     exposes `listUsers()` (GET `/auth/tenant-users`), `deleteUser(id)`
     (DELETE), `createUser(body)` (POST) — no update/edit endpoint.
     `RoleService` (`core/services/role.service.ts:17-104`) exposes
     `loadRoles`, `createRole`/`createRoleRequest`,
     `updateRole`/`patchRoleRequest`, `deleteRole`, `getRole`,
     `listRoles$` against `/auth/tenant-roles` — used by the create-user
     dialog to populate the role `<mat-select>`, not used by
     `UsersComponent` directly.

2. **Analytics** — `features/overview/analytics/analytics.component.ts:120-172`.
   All metrics and table rows are **hard-coded component fields**
   (`apiVolumeData`, `topEndpoints`, `errorBreakdown`, lines 122-169) — the
   component injects only `TenantService` (line 121) and does **not**
   inject anything from `core/services/metrics/`. `rg -ln
   "core/services/metrics" src/app` confirms `analytics.component.ts` is
   absent from the list of consumers; those services
   (`overview-metrics.service.ts`, `channels-metrics.service.ts`,
   `connections-metrics.service.ts`, `ai-metrics.service.ts`,
   `processes-metrics.service.ts`, `settings-metrics.service.ts`) are
   consumed by `dashboard.component.ts`, `channels-landing.component.ts`,
   `connections-landing.component.ts`, `ai-landing.component.ts`,
   `processes-landing.component.ts`, `settings-hub.component.ts`, and
   `shell`/`sub-nav`, never by Analytics. `OverviewMetricsService`
   (`core/services/metrics/overview-metrics.service.ts:1-24`) is itself a
   "Phase 1 stub" per its own doc comment — its signals
   (`conversationsActive`, `messages24h`, `aiInvocations24h`,
   `workflowRuns24h`, `errorRate24h`) all return `null`, real fetches are
   "Phase 2" (not implemented).
   - Chart usage today: within `analytics.component.ts` itself, only
     `app-sparkline` (foundation primitive, `shared/components/sparkline/`)
     is used, rendering the hard-coded `apiVolumeData` array
     (`analytics.component.ts:52`) as a single-series SVG line. No canvas,
     no chart library — `rg -i "chart" package.json` in
     `services/admin-console` returns no matches, confirming **decision
     3's premise (no chart library today)**.
   - However, Sparkline is **not** the only chart primitive in the app:
     `features/channels/detail/usage-chart.component.ts`
     (`UsageChartComponent`, selector `app-usage-chart`, line 88; class
     line 205) is an existing **multi-series SVG area+line chart** —
     three series (ingress/egress/dlq, `SERIES_COLORS`, lines 39-44),
     legend (lines 93-100), gradient-filled polygons per series (`<defs>`
     linearGradients lines 131-144, `<polygon [attr.fill]="'url(#uc-'..."`
     lines 146-151) plus `<polyline>` line strokes (lines 152-160), and an
     explicit "No usage data for the selected range." empty state (line
     103). It is wired into `channel-detail.component.ts` (imported line
     53, used in the component's `imports` array line 104, rendered via
     `<app-usage-chart` at line 180). This is prior art for exactly the
     shape T03 needs: a dual-series (ingress/egress-style) area+line
     chart with a legend. Per decision 3 ("reuse whatever chart approach
     exists today"), **the chart mechanism for T03's "Mensajes · 30
     días" dual-series area+line chart is resolved by adapting
     `UsageChartComponent`'s pattern — no new chart library, no sign-off
     needed for the chart mechanism itself.**
   - **Critical mismatch with decision 2** ("no new metrics"): the design's
     Analytics section (mock lines 174-242, screenshots 18/19) shows
     entirely different metrics than what exists today — "Conversaciones",
     "Resueltas sin humano %", "1ª respuesta p50/p95", "Tokens LLM · 30d"
     (KPI strip, mock lines 174-195), a dual-series "Mensajes · 30 días"
     in/out area+line chart (mock lines 196-208), "Por canal" volume bars
     per channel (mock lines 210-227), "Por agente · tokens y handoff"
     table (mock lines 228-234), and "Por workflow" table (mock lines
     236-242). None of these map to the current hard-coded "Page Views /
     Unique Sessions / Avg Session / Bounce Rate" KPIs or
     "Top Endpoints / Error Breakdown" tables
     (`analytics.component.ts:23-102`), and none are backed by any real
     service in `core/services/metrics/` today (all are stubs or scoped to
     other features, per above). **T03 cannot satisfy "same metrics as
     today" (decision 2) by restyling alone** — the design's Analytics
     content has no current data source at all. Note this mismatch is
     about the **metric set**, not the chart mechanism: per the prior
     point, the dual-series area+line chart itself is already resolved by
     reusing `UsageChartComponent`'s pattern (decision 3, no sign-off
     needed there). The remaining open item is only the metric set. This
     needs a human decision before T03 runs: either (a) restyle using the
     current hard-coded metrics under the new visual primitives (ignoring
     the design's specific metric labels/tables), or (b) treat the new
     metric set as in-scope, which decision 2 explicitly forbids without
     sign-off.

3. **Settings** — `features/settings-hub/settings-hub.component.ts:135-174`
   is a **navigation hub of link cards, not a form**. Its own doc comment
   (lines 27-35) states: "Settings has 14 sub-pages spread across 5
   conceptual groups... the standard KPI-strip template doesn't fit, so we
   render a 2-col grid of group cards instead... chips below double as
   nav." The component has **no form fields, no `<input>`/`<mat-form-field>`
   controls, no validation, and no save path** — it renders two
   `ISettingsGroup` cards ("Identity", "Tenant", lines 145-167) each with a
   headline stat and `chips` that `router.navigate()` (line 172) to
   `/users`, `/roles`, `/api-keys`, `/billing`. It injects
   `SettingsMetricsService` (`core/services/metrics/settings-metrics.service.ts`)
   for `usersActive()`/`invitationsPending()` counts only.
   - **T04's premise does not hold as written.** There is no "field ids"
     snapshot possible on `settings-hub.component.ts` because it has no
     fields — the grouped-form layout and "settings/fields/forms" T04
     describes do not exist in this component. The design HTML has **no
     dedicated "Settings" screen at all**: `rg -n "showSettings|screen ===
     \"settings\""` returns no matches, and there is no
     `data-screen-label="Settings"` block. In the design's `NAV` array
     (mock lines 1358-1363), "Settings" is only a **nav-group label**
     whose pages are `Users` (`screen: "users"`), `Roles`, `API keys`,
     `Billing`; the group's landing screen is `users`
     (`LANDING.settings = "users"`, mock line 1366). Screenshot
     `17-settings-users.png` visually confirms this: the browser tab
     reads "Settings" but the rendered content is the **Users table**
     (Email/Name/Role/Created columns, "Add user" button, per-row
     deactivate icon) — identical to the "Users" screen block (mock lines
     658-681), not a settings form.
   - This means **T04 as scoped in this SPEC has no matching design
     artifact and no current form to restyle** — the actual
     `settings-hub.component.ts` (card/chip hub) is out of the design's
     visible scope entirely (no mock, no screenshot). This needs a human
     decision before T04 runs: either (a) restyle the hub's own card grid
     using foundation primitives (no form/field inventory to snapshot,
     contradicting T04's acceptance criterion as written), or (b) drop T04
     since "Settings" in the design is not a distinct screen but a nav
     label whose content is the Users table already covered by T02.

4. **Design ground truth** — `manual-loops/admin-console/design/Rediseño
   Terminal.dc.html`:
   - Users section: lines 658-681 (`data-screen-label="Users"`), table
     columns Email/Name/Role/Created via a `sc-for` over `{{ users }}`
     (line 670-678), single row action = "Deactivate user" icon
     (`person_off`, line 676), header action = "Add user" button (line
     666). No status/last-active column, no edit action — matches current
     code exactly (point 1).
   - Analytics section: lines 157-244 (`data-screen-label="Analytics"`),
     structure detailed in point 2 above (KPI strip lines 174-195, area
     chart lines 196-208, "Por canal"/"Por agente" lines 209-235, "Por
     workflow" table lines 236-242).
   - No "Settings" section exists in the mock (point 3); "Settings" only
     appears as: (a) a nav-group label (`NAV`, mock lines 1358-1363), (b)
     a disabled/unused button reference on line 413 (unrelated —
     Overview-tab context-menu style button, not a screen), and (c) the
     tab bar breadcrumb visible in screenshot `17-settings-users.png`
     (which renders the Users table underneath it).
   - Screenshots: `17-settings-users.png` = Users table under the
     "Settings" tab (confirms point 1 & 3); `18-analytics.png` = KPI strip
     + "Mensajes · 30 días" dual-series chart; `19-analytics-tables.png` =
     "Por canal" bars + "Por agente" and "Por workflow" tables (confirms
     point 2).

5. **Guards/permissions** — Only one route guard applies to all three
   screens: `authGuard` (`core/guards/auth.guard.ts:1`, re-exported from
   `@yoizen/angular-shared`), attached once at the shell/parent route
   (`app.routes.ts:20`, `canActivate: [authGuard]`) — session/auth only,
   no per-feature route guard for `/users`, `/analytics` (nested under
   `/dashboard`'s overview area per `app.routes.ts`), or `/settings`
   (`app.routes.ts:408-421`). Fine-grained permission gating is done
   **inside** the Users component via `authService.hasPermission(...)`
   calls (`"users:create"` at line 50, `"users:delete"` at line 127), not
   via guards. No permission checks exist in `analytics.component.ts` or
   `settings-hub.component.ts` today.

6. **Prior-art corrections** (SPEC lines 29-35):
   - Line 29-32 lists `core/guards/auth.guard.ts` as reused "unchanged" —
     accurate; it is a one-line re-export, confirmed present and used at
     the shell root (point 5), not per-feature.
   - The Prior-art list is otherwise accurate for **file existence** (all
     six paths cited exist and were verified by direct read), but T02's
     task text ("existing actions (invite/edit/deactivate)", line 78-79)
     is **wrong** — there is no "edit" action or edit dialog in the
     current code or in the design mock (point 1). T02 should scope to
     invite + deactivate only.
   - Line 33-34 ("`core/services/metrics/` — existing metrics only") is
     **misleading for Analytics**: `analytics.component.ts` does not use
     `core/services/metrics/` at all today (point 2); citing it as
     Analytics' data source implies a live integration that does not
     exist. The metrics package is real and used elsewhere, but not by
     this component.
   - The Prior-art list (SPEC lines 29-35) is also **missing an entry**:
     `features/channels/detail/usage-chart.component.ts`
     (`UsageChartComponent`, `app-usage-chart`) was absent from both the
     SPEC's prior-art list and this findings doc's original chart-usage
     bullet (point 2 above, now corrected). It should be added as prior
     art for T03's chart mechanism — the existing multi-series SVG
     area+line chart (legend, gradient-filled polygons, polylines, empty
     state) already used in `channel-detail.component.ts`.
   - Line 35 ("`features/settings-hub/settings-hub.component.ts` —
     settings hub") is accurate as a file/role description, but the Goal
     and T04 sections built on top of it (`Settings as the grouped-form
     layout`, `Grouped-form layout per contract`) mischaracterize what the
     component is — see point 3 for the correction and the two required
     human decisions before T03/T04 can proceed as scoped.

### T02 — Users

- InventoryTable of users (role, status, last active), existing actions
  (invite/edit/deactivate) rewired to the new table's row actions; forms and
  guards reused unchanged.
- Unit tests: row mapping, permission-gated actions hidden without rights,
  action wiring identical to old behavior.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Analytics

- MetricCard rows + chart compositions per contract, same metrics as today
  (decision 2), chart approach per decision 3.
- Unit tests: metric mapping, empty/loading states, chart data
  transformation.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Settings

- Grouped-form layout per contract; existing form controls, validation, and
  save paths reused unchanged.
- Unit tests: all existing settings present (snapshot of field ids vs old
  screen), save path untouched.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T05 — Docs + index

- Update `services/admin-console/README.md`, add entry to `cowork/INDEX.md`, log
  decisions to Engram topic 'admin-console/redesign-users-analytics-settings'.

**Accept**
```
grep -n "console-redesign-users-analytics-settings" cowork/INDEX.md
```

---

- [x] T01 inventory report
- [x] T02 users
- [x] T03 analytics
- [x] T04 settings
- [ ] T05 docs + index

## Out of scope (explicit)

- New user-management capabilities (SSO, roles editor) — restyle only.
- New analytics metrics or date-range features.
- New settings — field set is frozen (decision 2).
- Backend/API changes.
- Roles, API keys, and billing screens (`features/identity/roles`,
  `api-keys`, `tenant-management/billing`) — follow-up loop.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Introducing a chart library requires human sign-off (decision 3).
- Deviating from the binding visual contract requires human sign-off.
