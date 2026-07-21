# SPEC — Console redesign: foundation (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: none (this is L0 — every other console-redesign loop depends on it).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-foundation'.

## Goal

1. The console renders with the new visual language (dark default + light
   mode, corporate-blue accent, Vercel/Linear-style density) defined in
   `manual-loops/design/Rediseño Terminal.dc.html`.
2. A shared set of UI primitives (health dot, sparkline, metric card,
   needs-attention panel, inventory table, detail modal) exists and is used
   by at least one screen, so section loops (L1–L7) only compose them.
3. Theme toggle persists across reloads and applies to every existing screen
   without visual regressions in layout structure.

## User decisions (human boundary — do not reinterpret)

1. The binding visual contract is `manual-loops/design/Rediseño Terminal.dc.html`
   plus per-section screenshots in `manual-loops/design/`. Pixel values
   (colors, radii, spacing, type scale) come from that file — not invented.
2. Dark is the default theme; light is the secondary. Toggle lives in the
   topbar, persisted in `localStorage`.
3. Old screens keep working during migration: foundation restyles the shell
   and tokens but does NOT rewrite feature screens (those are L1–L7).
4. No new UI library — Angular Material/CDK (already in use) plus hand-built
   standalone components.
5. The sidebar section model is the existing `layout/nav/nav.config.ts` —
   restyle it; reordering/adding/removing sections needs human sign-off.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `admin-console/src/app/layout/` — `shell`, `sidebar`, `header`, `sub-nav`,
  `right-panel` + `nav/nav.config.ts` (section model); restyle in place, do
  not create a parallel shell.
- `admin-console/src/app/core/services/theme.service.ts` — theme service
  ALREADY EXISTS; extend it, never create a second one.
- `admin-console/src/styles.scss` — global styles entrypoint; tokens land here
  as CSS custom properties.
- `admin-console/src/app/shared/components/` — kpi-card, sparkline,
  status-badge, page-header, section-landing-shell, activity-feed,
  progress-bar, sub-tabs, breadcrumbs, confirm-dialog. Primitives EVOLVE
  these in place — no parallel `ui/` folder.
- `packages/angular-shared` (`@yoizen/angular-shared`) — shared providers
  (`provideCoreApp`); consumed, never forked.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Angular standalone components, OnPush change detection, SCSS. No global
  state libraries; the existing `ThemeService` is extended, not duplicated.
- All colors/spacing/typography referenced via CSS custom properties defined
  in T02 — no hard-coded hex in component SCSS (reviewer rejection).
- Only `admin-console/` is touched in this loop. No backend changes.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — unit tests
cd admin-console && pnpm exec ng test --watch=false
# G2 — typecheck
cd admin-console && pnpm exec tsc -p tsconfig.app.json --noEmit
# G5b — COMMIT GATE (once per task): production build
cd admin-console && pnpm run build
```

Gate rules: admin-console has no dev-mode — there is no G5a; G5b is the only
integration gate. G5b failures count as failed attempts like any other gate.

---

## Task queue

### T01 — Inventory report (no code)

- Map the real structure: list every route in `src/app/app.routes.ts`, every
  feature folder under `src/app/features/`, the layout components under
  `src/app/layout/`, and what already exists in `src/app/shared/` and
  `src/app/core/` (theme handling, http interceptors, guards).
- Record findings verbatim in this SPEC under "**T01 findings (recorded
  <date>):**", numbered, with file paths and line numbers. Replace every
  `<verify>` marker in this SPEC and flag any assumption above that is wrong.

**Accept**
```
grep -n "T01 findings" manual-loops/console-redesign-foundation.md
```

**T01 findings (recorded 2026-07-21):**

0. **Path correction (blocks every other task in this SPEC as written):** every
   path in this SPEC prefixed `admin-console/...` (e.g. `admin-console/src/app/...`,
   `admin-console/README.md`) does NOT resolve from the repo root. There is no
   top-level `admin-console/` directory. The real app lives at
   `services/admin-console/` (confirmed via `services/admin-console/src/app/`).
   The G1/G2/G5b gate commands (`cd admin-console && pnpm exec ng test ...`)
   and every task path in T02–T06 must be read as relative to
   `services/admin-console/`, i.e. `cd services/admin-console && pnpm exec ng
   test --watch=false`. This is not fixed here (T01 is inventory-only, no code
   or gate changes) — flagged for human sign-off / correction in a follow-up
   edit to the Gates and Task queue sections. The same prefix problem also
   applies to this task's own Accept command below: `grep -n "T01 findings"
   manual-loops/console-redesign-foundation.md` is missing the `admin-console/`
   segment — the real file is `manual-loops/admin-console/console-redesign-foundation.md`.
   Flagged only, not fixed, for the same reason (no Accept-command edits in T01).

1. **Routes** — `services/admin-console/src/app/app.routes.ts` (438 lines).
   Top-level route tree, guarded by `authGuard` (line 20), shell-wrapped
   (lines 15-430). Every line number below cites the `path:` (or single-line
   redirect) statement, not the following `loadComponent:` line:
   - `dashboard` (line 26, Overview) — default redirect target (line 22)
   - `analytics` (line 33, Overview)
   - `channels` (line 42, landing) / `channels/:channel` (line 50) /
     `channels/:channel/accounts/:accountId` (line 57)
   - `connections` (line 66, landing) with children: `connections/http`
     (line 78), `connections/http/:id` (line 85), back-compat redirects
     `internal-http`/`external-http`/`http/internal`/`http/external` → `http`
     (lines 92-95), `connections/mcp` (line 97), `connections/mcp/:id`
     (line 104), `connections/hosted-services` (line 111)
   - back-compat redirects at shell level: `connectors` → `connections/http`
     (line 120), `hosted-services` → `connections/hosted-services` (line 122),
     `data` → `connections` (line 126)
   - `ai` (line 130, landing) with children: `ai/agents` (line 141),
     `ai/agents/new` (line 148), `ai/agents/:id` (line 156, with nested
     `overview`/`configure`/`settings` at lines 164/171/179), `ai/playground`
     (line 188), `ai/memories` (line 195), `ai/skills` (line 202),
     `ai/system-variables` (line 209), `ai/knowledge-bases` (line 216),
     `ai/knowledge-bases/:id` (line 223), `ai/structured-kb` (line 230),
     `ai/structured-kb/:id` (line 237)
   - `processes` (line 248, landing), `processes/trace` (line 255),
     `processes/trace/:correlationId` (line 262),
     `processes/runs/:workflowId/:runId` (line 279, Run View);
     `automate` → `processes` redirect (line 285)
   - `workflows` (line 289) with children: `workflows/new` (line 300),
     `workflows/:id/edit` → `:id/builder` redirect (line 305),
     `workflows/:id` (line 307, with nested `overview`/`builder`/
     `executions`/`runs/:runId`/`settings` at lines 315/322/330/337/344)
   - `schedules` (line 357) with children: `schedules/:id` (line 367, with
     nested `overview`/`executions` at lines 375/382)
   - `settings` (line 395), `users` (line 402), `roles` (line 409),
     `api-keys` (line 416), `billing` (line 423)
   - `login` (line 432, outside the shell/guard)
   - catch-all `**` → `dashboard` (line 437)

2. **Feature folders** — `services/admin-console/src/app/features/` (10
   top-level folders): `auth`, `automation` (contains `ai/`, `workflows/`,
   `schedules/`, `hosted-services/`), `channels`, `connections`,
   `data-integrations` (contains `connectors/`), `identity` (contains
   `users/`, `roles/`, `api-keys/`), `overview` (contains `dashboard/`,
   `analytics/`), `processes` (contains `trace/`, `run-view/`), `settings-hub`,
   `tenant-management` (contains `billing/`).

3. **Layout components** — `services/admin-console/src/app/layout/`:
   - `shell/shell.component.ts` (148 lines) + `shell.component.spec.ts`
   - `sidebar/sidebar.component.ts` (444 lines) + `sidebar.component.spec.ts`
   - `header/header.component.ts` (428 lines) + `header.component.spec.ts`
   - `sub-nav/sub-nav.component.ts` (339 lines) — no spec file (gap, not a
     SPEC assumption issue, but worth flagging for T03's "unit tests" bullet)
   - `right-panel/right-panel.component.ts` (239 lines) +
     `right-panel.component.spec.ts`
   - `nav/nav.config.ts` (164 lines) — the nav/section model referenced in
     User decision 5

4. **Shared components** — `services/admin-console/src/app/shared/components/`
   contains all 10 primitives listed in Prior art PLUS 2 not mentioned there
   (`http-adapter-dialog/`, `mcp-server-dialog/` — feature-specific dialogs,
   correctly excluded from the primitive list). Confirmed with selector +
   class line numbers:
   - `kpi-card/kpi-card.component.ts` — selector `app-kpi-card` (line 20),
     `class KpiCardComponent` (line 95)
   - `sparkline/sparkline.component.ts` — selector `app-sparkline` (line 9),
     `class SparklineComponent` (line 47), has spec
   - `status-badge/status-badge.component.ts` — selector `app-status-badge`
     (line 21), `class StatusBadgeComponent` (line 87), has spec
   - `page-header/page-header.component.ts` — selector `app-page-header`
     (line 19), `class PageHeaderComponent` (line 77)
   - `section-landing-shell/section-landing-shell.component.ts` — selector
     `app-section-landing-shell` (line 21), `class
     SectionLandingShellComponent` (line 76)
   - `activity-feed/activity-feed.component.ts` — selector `app-activity-feed`
     (line 24), `class ActivityFeedComponent` (line 96)
   - `progress-bar/progress-bar.component.ts` — selector `app-progress-bar`
     (line 9), `class ProgressBarComponent` (line 85), has spec
   - `sub-tabs/sub-tabs.component.ts` — selector `app-sub-tabs` (line 22),
     `class SubTabsComponent` (line 80)
   - `breadcrumbs/breadcrumbs.component.ts` — selector `app-breadcrumbs`
     (line 15), `class BreadcrumbsComponent` (line 61)
   - `confirm-dialog/confirm-dialog.component.ts` — selector
     `app-confirm-dialog` (line 36), `class ConfirmDialogComponent`
     (line 96)
   - Also present, not in Prior art list: `shared/models/http-adapter.model.ts`,
     `shared/pipes/utc-date.pipe.ts`, `shared/utils/format-compact.ts` (+ spec)

5. **Core services/interceptors/guards** —
   `services/admin-console/src/app/core/`:
   - `services/theme.service.ts` (26 lines) — `@Injectable({ providedIn:
     "root" })` (line 3), `class ThemeService` (line 4). Public API: `readonly
     isDark = signal(...)` (line 7), `toggle(): void` (lines 17-19). Persists
     via `localStorage` key `"admin-console-theme"` (line 5, `STORAGE_KEY`),
     applies `light-theme` class on `document.documentElement` (line 12) — NOT
     a `data-theme` attribute as T02's Accept gate assumes (see finding 6
     below). Has `theme.service.spec.ts` alongside it.
   - `guards/auth.guard.ts` — re-exports `authGuard` from
     `@yoizen/angular-shared` (line 1); the real implementation lives in
     `packages/angular-shared`, not locally. Has local `auth.guard.spec.ts`.
   - `interceptors/auth.interceptor.ts` — re-exports `AuthInterceptor` from
     `@yoizen/angular-shared` (line 1). Has local `auth.interceptor.spec.ts`.
   - `interceptors/tenant.interceptor.ts` — re-exports `TenantInterceptor`
     from `@yoizen/angular-shared` (line 1). Has local
     `tenant.interceptor.spec.ts`.
   - Additional non-theme services exist under `core/services/` (dashboard,
     channel-admin, agent-admin, registry, role, tenant, run-view,
     tracking-chain, etc.) and `core/services/metrics/` (per-section metrics
     services) — out of scope for this SPEC's primitives work but noted for
     completeness.

6. **T02 Accept-gate mismatch (flag for T02, not fixed here):** T02's Accept
   command is `grep -n "data-theme" src/styles.scss` and its task bullet says
   "extend ... `data-theme` attr on `<html>`". The CURRENT `ThemeService`
   (finding 5) toggles a `light-theme` CSS class on `document.documentElement`,
   not a `data-theme` attribute — so today that grep would fail against the
   pre-T02 codebase, and T02 must decide (human/T02-implementer call) whether
   to migrate to a `data-theme` attribute or update the Accept gate to match
   the existing `light-theme` class convention. Flagged here per this task's
   "flag any assumption above that is wrong" instruction; not resolved because
   T01 is inventory-only.

7. **`<verify>` markers** — none found. `rg -n "<verify>"` against this file
   matches only the literal instructional text in the T01 task bullet itself
   (line 86 pre-edit), which is not a placeholder to replace — it is prose
   describing the marker-replacement instruction. No actual `<verify>`
   placeholder markers exist elsewhere in this SPEC.

8. **Prior art verification results:**
   - `admin-console/src/app/layout/` → CONFIRMED at corrected path
     `services/admin-console/src/app/layout/`: `shell`, `sidebar`, `header`,
     `sub-nav`, `right-panel` + `nav/nav.config.ts` all present (see finding 3).
   - `admin-console/src/app/core/services/theme.service.ts` → CONFIRMED at
     corrected path `services/admin-console/src/app/core/services/theme.service.ts`
     (26 lines, see finding 5); however its persistence mechanism (CSS class,
     not `data-theme` attribute) does NOT match what T02 assumes — see
     finding 6.
   - `admin-console/src/styles.scss` → CONFIRMED at corrected path
     `services/admin-console/src/styles.scss` (696 lines).
   - `admin-console/src/app/shared/components/` → CONFIRMED at corrected path
     `services/admin-console/src/app/shared/components/`: all 10 named
     primitives exist (kpi-card, sparkline, status-badge, page-header,
     section-landing-shell, activity-feed, progress-bar, sub-tabs,
     breadcrumbs, confirm-dialog) — see finding 4.
   - `packages/angular-shared` with `provideCoreApp` → CONFIRMED:
     `packages/angular-shared/src/app-providers.ts` line 15
     (`export function provideCoreApp(options: {...`), re-exported from
     `packages/angular-shared/src/index.ts` line 21. Also confirms
     `authGuard`, `AuthInterceptor`, `TenantInterceptor` are sourced from this
     package (finding 5), not locally implemented.
   - Overall: the ONLY wrong assumption in Prior art is the top-level
     `admin-console/` path prefix used throughout (finding 0) — every named
     file/folder itself exists exactly as described once the correct
     `services/admin-console/` prefix is applied. The `data-theme` vs
     `light-theme` class mismatch (finding 6) is a T02-Accept-gate risk, not a
     Prior-art path error.

### T02 — Design tokens + theme service

- Add CSS custom properties (dark + light palettes, type scale, spacing,
  radii, shadows) to `src/styles.scss`, values transcribed from
  `manual-loops/design/Rediseño Terminal.dc.html`.
- Extend the EXISTING `core/services/theme.service.ts`: toggle, persistence,
  `data-theme` attr on `<html>`; its current public API and spec stay green.
- Unit tests: default dark, toggle flips, persisted value restored on init.

**Accept**
```
cd admin-console && pnpm exec ng test --watch=false && grep -n "data-theme" src/styles.scss
```

### T03 — Shell restyle (sidebar + topbar)

- Restyle `layout/shell`, `layout/sidebar`, `layout/header`, `layout/sub-nav`
  to match the redesign; nav model from `nav.config.ts` per decision 5; theme
  toggle in the header.
- DO NOT change routing or add/remove routes. DO NOT touch feature screens.
- Unit tests: sidebar renders the nav.config sections in order; toggle
  button calls `ThemeService.toggle()`.

**Accept**
```
cd admin-console && pnpm exec ng test --watch=false
```

### T04 — Shared primitives, batch 1 (health dot, metric card, sparkline)

- Evolve the EXISTING shared components in place: `kpi-card` → MetricCard
  styling per contract (label, value, delta, optional sparkline slot),
  `sparkline` restyle, `status-badge` gains the health-dot variant
  (ok/warn/error/idle). Existing selectors/inputs stay backward-compatible.
- Inputs strictly typed; no feature-specific logic inside primitives.
- Unit tests per component: renders each status/variant, handles empty data.

**Accept**
```
cd admin-console && pnpm exec ng test --watch=false && ls src/app/shared/components
```

### T05 — Shared primitives, batch 2 (inventory table, needs-attention panel, detail modal)

- NEW standalone components in `src/app/shared/components/`:
  `inventory-table` (generic column config, row click output, status-badge
  and sparkline cell renderers), `needs-attention-panel` (issue rows with
  severity + action link). Detail overlays REUSE MatDialog — restyle the
  dialog theme (see `confirm-dialog` precedent), do NOT build a custom modal.
- Unit tests: table renders columns + emits row click; panel renders empty
  state; restyled dialog renders with tokens.

**Accept**
```
cd admin-console && pnpm exec ng test --watch=false
```

### T06 — Docs + index

- Update `admin-console/README.md`: theming, token conventions, primitive
  catalog with usage snippets.
- Add an entry to `cowork/INDEX.md`. Log the decision set (tokens source,
  theme default, primitive catalog) under Engram topic
  'admin-console/redesign-foundation'.

**Accept**
```
grep -n "console-redesign-foundation" admin-console/README.md cowork/INDEX.md
```

---

- [x] T01 inventory report
- [ ] T02 tokens + theme service
- [ ] T03 shell restyle
- [ ] T04 primitives batch 1
- [ ] T05 primitives batch 2
- [ ] T06 docs + index

## Out of scope (explicit)

- Rewriting any feature screen (Dashboard, Channels, …) — that's L1–L7.
- Routing changes or new routes — sections keep their current URLs.
- Backend/API changes — front-only migration.
- Component library extraction to a separate package — premature.
- Animations/micro-interactions beyond what the design file shows — polish
  happens per-section.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Human copies `Rediseño Terminal.dc.html` + screenshots into
  `manual-loops/design/` before T02.
- Deviating from the binding visual contract requires human sign-off.
- Changing the sidebar section order or theme default requires human sign-off.
