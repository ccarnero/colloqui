---
name: yz-ui
description: >
  Yoizen Platform UI design system + Angular `admin-console` patterns: design tokens,
  layout shell, sub-nav + indicators, section landings, settings hub, detail mini-apps,
  status pills.
  Trigger: When working on admin-console pages or shared components, styling, layout
  shell, sub-nav, KPIs, section landings, settings hub, workflow/agent detail pages.
license: Apache-2.0
metadata:
  author: Yoizen
  version: "3.0"
  scope: [root]
  auto_invoke:
    - "ui design"
    - "yoizen"
    - "styling"
    - "components"
    - "admin console"
    - "section landing"
    - "sub-nav"
    - "kpi card"
    - "settings hub"
    - "workflow detail"
---

> **Normative sources**: `AGENTS.md:55` (admin-console binding style — "Angular
> standalone components, signals, OnPush, lazy `loadComponent` routes, inline SVG
> (no chart libs), tokens-only colors (no hard-coded hex — reviewer rejection),
> no new libraries without human approval") and the visual contract
> `manual-loops/admin-console/design/Rediseño Terminal.dc.html`, whose deviations
> need human sign-off. Where this skill and AGENTS.md conflict, AGENTS.md wins.

## When to Use

Use this skill when:
- Creating or editing pages in **admin-console** (Angular 21 — `services/admin-console/package.json:24` pins `@angular/core: ^21.2.0`)
- Building a section landing (KPI strip + panel split)
- Working with the sub-nav, its indicators, or its collapse/hide modes
- Building a detail mini-app (sub-tabs above a `<router-outlet/>`)
- Building the settings hub (group cards + chip nav)
- Building a filterable, paginated list
- Choosing colors, fonts, spacing, or radii

**One consumer.** `services/admin-console/` is the only UI app in this repo:

```bash
fd -t d -d 1 . services | rg -i 'console|ui'   # → services/admin-console only
```

---

## Design tokens: TWO layers, know which one you are in

`services/admin-console/src/styles.scss` defines two independent token layers.
Restyled screens use `--rd-*`; unmigrated screens still use the legacy layer.
**Read the component you are editing and follow its layer** — do not mix.

### Layer 1 — `--rd-*` (redesign; use this for new/restyled work)

Transcribed from the visual contract; the header comment says so
(`styles.scss:153-158`). Dark values at `styles.scss:159-268`, light overrides
under `[data-theme="light"], .light-theme` at `styles.scss:325-355`
(the attribute is set by `src/app/core/services/theme.service.ts`).

| Token | Dark | Light | Purpose |
|---|---|---|---|
| `--rd-bg` | `#0a0a0a` | `#fafafa` | Page background |
| `--rd-panel` | `#0f0f0f` | `#ffffff` | Panels, cards |
| `--rd-hover` | `#1a1a1a` | `#f0f0f0` | Hover / active row tint |
| `--rd-line` | `#1f1f1f` | `#e4e4e4` | Borders |
| `--rd-text-1/2/3` | `#ededed` / `#a1a1a1` / `#7a7a7a` | `#171717` / `#666666` / `#999999` | Primary / secondary / muted text |
| `--rd-accent` | `#1a66ff` | `#1a66ff` | Brand blue, active states |
| `--rd-accent-soft` | `rgba(26,102,255,0.14)` | `rgba(26,102,255,0.09)` | Accent tint |
| `--rd-green` / `--rd-red` / `--rd-yellow` / `--rd-purple` | `#50e3a4` / `#f5455c` / `#f5a623` / `#bf7af0` | `#0c9f5f` / `#e5484d` / `#b26b00` / `#8e4ec6` | Status colors |

Scales, all enumerated from the design file:
`--rd-text-size-3xs…7xl` (9px→28px, `styles.scss:217-230`),
`--rd-space-1…12` (2px→28px, `:233-244`),
`--rd-radius-1…11` + `--rd-radius-full: 999px` (`:257-268`).
Fonts: `--rd-font-sans: "Geist", system-ui` / `--rd-font-mono: "Geist Mono"`
(`:213-214`; loaded via the `@import` at `styles.scss:13`).
Topbar geometry: `--rd-topbar-crumbs-h: 52px` + `--rd-topbar-tabs-h: 21px`,
summed into `--rd-topbar-h` (`styles.scss:250-254`).

### Layer 2 — legacy Yoizen brand tokens (unmigrated screens only)

`styles.scss:69-125` (dark) with light overrides at `:127-151`.

| Token | Value | Note |
|---|---|---|
| `--primary` / `--secondary` | `#1A66FF` / `#4A3ABF` | Brand blue / purple |
| `--accent-yz` / `--yellow-yz` | `#FD6421` / `#FDBD27` | Brand orange / yellow |
| `--bg-background` / `--bg-surface` / `--bg-card` / `--bg-sidebar` | `#1a1a1a` / `#2d2d2d` / `#3a3a3a` / `#050505` | Aliased as `--bg` / `--bg2` / `--bg3` (`:113-115`) |
| `--text-primary` / `--text-secondary` / `--text-muted` | `#ffffff` / `#D4D4D4` / `#A3A3A3` | Aliased as `--text` / `--text2` / `--text3` (`:119-121`) |
| `--border-subtle` | `#3f3f46` | Aliased as `--border` (`:117`) |
| `--accent-dim` | `rgba(26,102,255,0.12)` | Active-item tint |
| `--green` / `--red` / `--yellow` | `#22c55e` / `#ef4444` / `var(--yellow-yz)` | Plus `-dim` variants at 0.12 alpha (`:97-106`) |
| `--radius` / `--radius2` / `--radius3` | `6px` / `8px` / `12px` | SM / MD / LG (`:107-109`) |
| `--font` | `"Inter", "Barlow", "Plus Jakarta Sans", system-ui` | `:110` |

Both layers are live: `rg -l 'var\(--rd-' src/app` returns 43 files and
`rg -l 'var\(--(bg-surface|text2|primary)\b' src/app` returns 52 (run from
`services/admin-console/`, excluding specs).

Brand gradient — `--brand-gradient` (`styles.scss:91`); the avatar variant is
`--rd-avatar-gradient` (`:204`).

`color-mix` is the convention for tinted surfaces:
```css
background: color-mix(in srgb, var(--green) 15%, transparent);
```

**No Tailwind.** The admin-console composes inline `styles:` blocks in
components and references CSS variables. The only occurrence of the word in the
app is a comment (`styles.scss:838`, "Webkit / Tailwind-like utilities"):
```bash
rg -n -i tailwind services/admin-console/src --glob '!node_modules'
```

---

## Layout architecture

### Six top-level sections

```
Overview · Channels · Connections · AI · Processes · Settings
```

`NAV_SECTIONS: INavSection[]` in `src/app/layout/nav/nav.config.ts` — the six
`key`s are at `:49, :59, :82, :102, :124, :150`. The interface (`:28-35`) gives
each section `key`, `label`, `matchPaths[]` (URL prefixes that mark the section
active), `landingPath` (where the tab navigates), `pages[]` (sub-nav entries).

### Header (top tabs)

`src/app/layout/header/header.component.ts`
- Underline tab-nav. Inactive tabs carry `border-bottom: 2px solid transparent`
  with `margin-bottom: -1px` to overlap the divider (`:273-274`); the active tab
  sets `color` and `border-bottom-color` to `var(--rd-accent)` (`:283-287`).
- Tabs route to `section.landingPath`, not `pages[0].route` (`:164`), so
  clicking a section tab always lands on its landing page.
- Tab row collapses under `@media (max-width: 900px)` (`:202`, `:289`).
- Height is token-driven, not a literal: `--rd-topbar-crumbs-h` (52px) for the
  crumbs row (`:188`) and `--rd-topbar-tabs-h` (21px) for the tab row (`:258`).

### Sub-nav (left rail)

`src/app/layout/sub-nav/sub-nav.component.ts`
- **210px** expanded (`:85-86`); **56px** icon strip when collapsed (`:100-101`),
  rendering 2-letter abbreviations via `abbrev()` (`:346`).
- Active item (expanded): `background: var(--rd-hover)`, `color: var(--rd-text-1)`,
  `font-weight: 500` (`:197-201`). Collapsed adds
  `border-left-color: var(--rd-accent)` (`:141-145`).
- Renders `INavIndicator` next to items; `collapsed` is an `input(false)` (`:283`).

### Shell

`src/app/layout/shell/shell.component.ts`
- Vertical flex `:host { height: 100vh; overflow: hidden }` → `<app-header>` +
  `.shell-body` (sub-nav + `<main class="shell-main">`) (`:52-100`).
- Two independent route-data flags, both read by `readRouteDataFlag` walking the
  active route tree on every `NavigationEnd` (`:33`, `:147-166`):

| Flag | Effect | Who sets it |
|---|---|---|
| `subNavCollapsed: true` | Rail becomes the 56px icon strip | AI agent editor routes — `app.routes.ts:165` (`agents/new`) and `:188` (`agents/:id/configure`) |
| `subNavHidden: true` | Rail removed entirely, `<main>` goes `full-bleed` | Workflow builder — `app.routes.ts:323` (`workflows/new`) and `:357` (`:id/builder`) |

- `mobileNavOpen` signal drives a hamburger overlay (`:144`, `:53-70`).

---

## Sub-nav indicators

Declare on a nav page (real entry, `nav.config.ts:113-116`):

```ts
{
  label: "Memories",
  route: "/ai/memories",
  indicator: { kind: "count", source: "ai.memories.total" },
}
```

`source` is a string key resolved by `NavIndicatorRegistry`
(`src/app/core/services/metrics/nav-indicator-registry.service.ts:78-95`), which
routes by prefix to a per-section metrics service:

| Prefix | Service | Registry line |
|---|---|---|
| `ai.*` | `AiMetricsService` | `:78-79` |
| `channels.*` | `ChannelsMetricsService` | `:81-82` |
| `connections.*` | `ConnectionsMetricsService` | `:84-85` |
| `overview.*` | `OverviewMetricsService` | `:87-88` |
| `processes.*` | `ProcessesMetricsService` | `:90-91` |
| `settings.*` | `SettingsMetricsService` | `:93-94` |

All six live in `src/app/core/services/metrics/` and each exposes a
`resolve(source): Signal<number | null> | null` method
(`rg -l 'resolve\(' src/app/core/services/metrics/` → 7 files: the six services
plus the registry itself). The registry fans out
`loadCounts()` to five of them — overview is not in that fan-out
(`nav-indicator-registry.service.ts:70-74`).

**Indicator kinds** — `NavIndicatorKind = "count" | "count-warn" | "count-danger" | "dot"`
(`nav.config.ts:8`, documented at `:3-6`):

| Kind | Visual | Use when |
|---|---|---|
| `count` | Muted number | Informational |
| `count-warn` | Amber number, tinted background | Approaching a limit |
| `count-danger` | Red number, tinted background | Needs action now |
| `dot` | Single colored dot, no number | Boolean alert state |

A null or zero value hides the indicator — don't render `0`, it is noise.

---

## Reusable primitives

Standalone components in `src/app/shared/components/`, one folder each. Current
set (regenerate with `fd -t d -d 1 . src/app/shared/components`):

| Component | Selector |
|---|---|
| `PageHeaderComponent` | `app-page-header` |
| `KpiCardComponent` | `app-kpi-card` |
| `ActivityFeedComponent` | `app-activity-feed` |
| `SubTabsComponent` | `app-sub-tabs` |
| `BreadcrumbsComponent` | `app-breadcrumbs` |
| `SectionLandingShellComponent` | `app-section-landing-shell` |
| `StatusBadgeComponent` | `app-status-badge` |
| `ConfirmDialogComponent` | `app-confirm-dialog` |
| `ProgressBarComponent` / `SparklineComponent` | small data viz |
| `InventoryTableComponent`, `NeedsAttentionPanelComponent`, `DetailDialogComponent`, `HttpAdapterDialogComponent`, `McpServerDialogComponent` | feature-shared |

---

## Page-level patterns

### 1. Section landing

`SectionLandingShellComponent` exposes four content slots — `actions`, `kpis`,
`primary`, `secondary` — and `hasSecondary()` drives the 2-column split
(`src/app/shared/components/section-landing-shell/section-landing-shell.component.ts:12-39`).
The shell deliberately imposes no card grid on `slot=kpis`; the page chooses
3 or 4 (`:17`).

```ts
@Component({
  imports: [SectionLandingShellComponent, KpiCardComponent, ActivityFeedComponent],
  template: `
    <app-section-landing-shell title="AI" [hasSecondary]="true">
      <div slot="actions">…</div>
      <div slot="kpis" class="kpis">
        <app-kpi-card label="Active agents" [value]="…" />
      </div>
      <div slot="primary" class="panel">…</div>
      <div slot="secondary" class="panel">…</div>
    </app-section-landing-shell>
  `,
})
```

**Three of the six sections use it** — verify with
`rg -l SectionLandingShellComponent src/app/features`:

| Section | Landing | KPI labels (verbatim) |
|---|---|---|
| AI | `features/automation/ai/ai-landing.component.ts` | "Active agents", "Tokens MTD", "Memory proposals" (`:57, :64, :69`) |
| Channels | `features/channels/channels-landing.component.ts` | "Connected", "Messages · 24h", "Auto-reply hit rate", "p95 response" (`:55, :60, :65, :70`) |
| Processes | `features/processes/processes-landing.component.ts` | "Workflows", "Executions today", "Services" (`:53, :58, :62`) |

The other three do **not**: Overview is `features/overview/dashboard/dashboard.component.ts`,
Connections composes `app-page-header` directly
(`features/connections/connections-landing.component.ts:28-34`), Settings uses
the hub pattern below.

### 2. Settings hub

`src/app/features/settings-hub/settings-hub.component.ts` — group cards, no KPI
strip. Two groups today: "Identity" (`:172`) and "Tenant" (`:186`).

Each card is `{ title, headline, tone, chips[], span? }` (`:18-24`). `headline` is
the single most action-relevant fact, rendered with a `tone-*` class —
`neutral | ok | warn | danger` (`:21`, CSS at `:128-138`). `chips[]` double as
nav (`:71-72`). `span: true` makes a card span both columns; Tenant uses it
(`:186-189`).

### 3. Detail mini-app (sub-tabs)

Pattern from the workflows detail page
(`src/app/features/automation/workflows/detail/`), routes in `app.routes.ts`:

```
/workflows/:id          ← WorkflowDetailComponent shell
  /                     ← redirects to overview
  /overview
  /builder              ← subNavHidden: true  (full-bleed canvas)
  /executions
  /runs/:runId
  /settings
```

The shell renders breadcrumbs + title row (status pill + actions) +
`<app-sub-tabs>` + `<router-outlet/>`. Children walk up to read `:id` — verbatim
from `detail/workflow-overview.component.ts:270-276`:

```ts
  private readonly parentParams = toSignal(
    this.route.parent?.params ?? this.route.params,
    { initialValue: this.route.parent?.snapshot.params ?? {} }
  );
  protected readonly id = computed<string>(
    () => this.parentParams()["id"] ?? ""
  );
```

Also used by `schedules/detail/schedule-detail.component.ts` and
`automation/ai/detail/ai-agent-detail.component.ts` (`rg -l app-sub-tabs src/app`).

### 4. Filterable list with pagination

`detail/workflow-executions.component.ts` is the pattern: a filter header, the
table, then a pager footer. Server-side pagination (`page` + `pageSize` +
`sort`) — the API service holds filter state, the component drives signals.

---

## Status pills and row status

Inline pill next to a title. Verbatim from
`detail/workflow-run-detail.component.ts:175-197`:

```css
    .status-pill {
      font-size: 11px;
      padding: 3px 9px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-weight: 500;
    }
    .sp-ok {
      background: color-mix(in srgb, var(--green, #16a34a) 15%, transparent);
      color: var(--green, #16a34a);
    }
    .sp-fail {
      background: color-mix(in srgb, var(--red, #ef4444) 15%, transparent);
      color: var(--red, #ef4444);
    }
    .sp-running {
      background: color-mix(in srgb, var(--primary, #1a66ff) 15%, transparent);
      color: var(--primary, #1a66ff);
    }
    .sp-other { background: var(--bg3); color: var(--text2); }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: 0.85; }
```

For passive list-row status (no pill background), a colored leading dot only —
`rs-*` are colors alone (`detail/workflow-executions.component.ts:169-172`):

```css
    .rs-ok { color: var(--green, #16a34a); }
    .rs-fail { color: var(--red, #ef4444); }
    .rs-running { color: var(--primary, #1a66ff); }
    .rs-other { color: var(--text2); }
```

```html
<span class="rs-ok"><span class="dot"></span>ok</span>
```

Detail shells may name the modifier after the domain state instead
(`.status-active` / `.status-draft`, `detail/workflow-detail.component.ts:142-149`)
— the `.status-pill` base is identical.

---

## Assets

`skills/yz-ui/assets/` — brand marks plus two copy-and-adapt snippets:

| File | Use |
|------|-----|
| `logo.svg` | Main logo |
| `logo-sec-slogan.svg` | Logo with slogan |
| `logo-negativo.svg` / `logo-negative.svg` | Negative variants |
| `logo-footer.svg` | Footer |
| `logo-dorso-maneas.svg` | Special variant |
| `icon.svg` | Favicon / avatar |
| `admin-console-snippets.css` | CSS-variable patterns (status pill, row status, KPI grid, landing panels, buttons, mono, indicators, settings card) |
| `component-template.angular.ts` | Angular standalone component skeleton |

---

## Best practices

### DO
- Reference CSS variables — never raw hex (`AGENTS.md:55`: hard-coded hex is a reviewer rejection).
- Match the token layer of the file you are editing: `--rd-*` for restyled screens, legacy tokens for unmigrated ones.
- Apply `ChangeDetectionStrategy.OnPush` on every component.
- Use signals + `computed()` for derived state; `toSignal(...)` to bridge observables.
- Use `input.required()` / `input()`; never `@Input` decorators.
- `routerLinkActive` for nav active state, not manual class toggles.
- Reuse the existing primitives — don't roll your own KPI card.
- Use the section-landing slots (`actions` / `kpis` / `primary` / `secondary`) for a new landing.
- Lazy `loadComponent` routes and inline SVG, no chart libs (`AGENTS.md:55`).
- Empty values render as `—`, not `null` or `0`.

### DON'T
- Hardcode hex colors anywhere.
- Add a new library without human approval (`AGENTS.md:55`).
- Deviate from `manual-loops/admin-console/design/Rediseño Terminal.dc.html` without human sign-off.
- Use Material Dialog for in-flow editing — prefer docked panels.
- Render `0` in count indicators — hide them.
- Use `100vh` / `100vw` inside a page — `shell.component.ts:82-91` already owns the viewport height.
- Reach into private properties of services (`service["http"]`) — add a public method.
- Add a top-nav section without updating `matchPaths` AND `landingPath` AND a metrics service.

---

## Paths reference

No static path map is maintained (the previous one drifted). Find things with:

```bash
cd services/admin-console
fd -t d -d 1 . src/app/features          # sections
fd -t d -d 1 . src/app/shared/components # primitives
rg -n 'landingPath|matchPaths' src/app/layout/nav/nav.config.ts
rg -n 'path:|loadComponent' src/app/app.routes.ts
```
