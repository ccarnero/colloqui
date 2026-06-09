---
name: yz-ui
description: >
  YoizenClaw / Yoizen Platform UI design system + Angular admin-console patterns.
  Trigger: When working on Yoizen UI (React yoizen-ui or Angular admin-console),
  components, styling, layout shells, sub-nav, KPIs, section landings, settings hub,
  workflow detail, or connector pages.
license: Apache-2.0
metadata:
  author: Yoizen
  version: "2.0"
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
    - "connector list"
---

## When to Use

Use this skill when:
- Creating or editing pages in **admin-console** (Angular 21, standalone components, signals, OnPush)
- Creating or editing components in **yoizen-ui** (React + Tailwind)
- Building section landings (KPI strip + panel split)
- Working with the sub-nav, indicators, or sub-nav collapse mode
- Building a detail mini-app (sub-tabs above a `<router-outlet/>`)
- Building a connector list / table with status dots
- Building the settings hub (group cards + chip-list nav)
- Building an empty-state placeholder for unbacked features
- Choosing colors, fonts, spacing, or icons across either app

There are two consumers in this repo:

| App | Stack | Path |
|---|---|---|
| `admin-console` | Angular 21 · standalone components · signals · OnPush · CSS variables · Angular Material | `services/admin-console/` |
| `yoizen-ui` | React · Tailwind · CSS variables | `Services/yoizen-ui/` (legacy reference) |

Brand tokens are shared. Component patterns are app-specific — pick the right column below.

---

## Brand tokens (universal)

### Color palette

**Primary colors:**
| Color | Hex | Usage |
|-------|-----|-------|
| Primary | `#1A66FF` | Buttons, links, primary actions |
| Secondary | `#4A3ABF` | Purple accents, gradients |
| Accent | `#FD6421` | Orange highlights |
| Yellow | `#FDBD27` | Auxiliary highlights |

**Surfaces:**
| Color | Hex | Usage |
|-------|-----|-------|
| Background | `#1a1a1a` | Main page background |
| Surface | `#2d2d2d` | Cards, panels |
| Card | `#3a3a3a` | Inset cards / elevated rows |
| Sidebar | `#050505` | Navigation sidebar |

**Text:**
| Color | Hex | Usage |
|-------|-----|-------|
| Primary | `#ffffff` | Headlines, primary content |
| Secondary | `#b3b3b3` | Descriptions |
| Muted | `#808080` | Placeholders, hints |

**Utility:**
| Color | Hex | Usage |
|-------|-----|-------|
| Border | `#404040` | Dividers, borders |
| Hover | `#2563eb` | Hover/active states |
| Green | `#16a34a` | Success status, OK dots |
| Red | `#ef4444` | Failure status, danger counts |
| Amber | `#eab308` | Warning status, warn counts |

### Typography

- **Primary**: `Barlow, sans-serif` — body
- **Sans**: `Plus Jakarta Sans, Inter, system-ui, sans-serif` — UI
- **Mono**: `JetBrains Mono, ui-monospace, monospace` — code, IDs, paths

Sizes: `12px` smallest readable. Headings 16–22px, weight 500 (avoid 600/700 — too heavy on dark surfaces).

### Spacing scale

Base 4px. Use `8 / 12 / 16 / 24 / 32` for component-internal gaps. Use rem-based vertical rhythm for page sections (`1rem`, `1.5rem`, `2rem`).

### Radius

| Token | Value | Usage |
|-------|-------|-------|
| Small | `6px` (`var(--radius)`) | Buttons, inputs, list rows |
| Medium | `8px` | Cards, panels |
| Large | `12px` | Modals, hero cards |
| Pill | `9999px` | Status pills, badges |

### Brand gradient

```css
background: linear-gradient(90deg, #1A66FF 0%, #4A3ABF 60%, #FD6421 100%);
```

Use sparingly — landing/marketing surfaces only. Never inside the admin shell.

---

## Admin console — CSS variable conventions

The Angular admin-console uses these variables. Always reference vars, never hex literals.

| Variable | Purpose |
|---|---|
| `--bg-background` | Page background (the shell main area) |
| `--bg-surface` | Cards, panels |
| `--bg3` | Inset rows, hovered list items |
| `--text-primary` | Headlines, primary content |
| `--text2` | Secondary text |
| `--text3` | Muted text, hints, timestamps |
| `--border-subtle` | All borders unless emphasized |
| `--primary` | Brand blue (`#1a66ff`) |
| `--accent-dim` | Active item tint (`rgba(26,102,255,0.06)`) |
| `--green` / `--red` / `--yellow` | Status colors |
| `--radius` | Default 6px corner radius |
| `--font-mono` | Mono stack for IDs, paths, code |

Color-mix is fine for tinted surfaces:
```css
background: color-mix(in srgb, var(--green) 15%, transparent);
```

### Mapping back to brand tokens

| Brand hex | Admin-console var |
|---|---|
| `#1A66FF` (primary) | `--primary` |
| `#1a1a1a` (background) | `--bg-background` |
| `#2d2d2d` (surface) | `--bg-surface` |
| `#3a3a3a` (card) | `--bg3` |
| `#ffffff` (text-primary) | `--text-primary` |
| `#b3b3b3` (text-secondary) | `--text2` |
| `#808080` (muted) | `--text3` |
| `#404040` (border) | `--border-subtle` |

---

## Layout architecture (admin-console)

### Six top-level sections

```
Overview · Channels · Connections · AI · Processes · Settings
```

Defined as `INavSection[]` in `src/app/layout/nav/nav.config.ts`. Each section has:
- `key` — stable ID
- `label` — header tab text
- `matchPaths[]` — URL prefixes the section claims (drives "active section" detection)
- `landingPath` — where the section tab navigates to
- `pages[]` — entries shown in the sub-nav

### Header (top tabs)

`src/app/layout/header/header.component.ts`
- Underline tab-nav style. Active tab gets `border-bottom: 2px solid var(--primary)` with `margin-bottom: -1px` to overlap the header divider.
- Tabs hidden on mobile (<900px); hamburger shown.
- Tabs route to `section.landingPath` (NOT `pages[0].route`) so "click a section tab" always lands on its landing.

### Sub-nav (left rail)

`src/app/layout/sub-nav/sub-nav.component.ts`
- 180px flat panel. Active item: `border-left: 2px solid var(--primary)` + `var(--accent-dim)` tint.
- Renders `INavIndicator` next to items: count / count-warn / count-danger / dot. Hides on null/zero.
- **Collapse mode**: when route data sets `subNavCollapsed: true`, the rail becomes a 48px icon strip (uses 2-letter abbreviations of page labels). Only the workflow `/builder` sub-route uses this — the canvas needs the room.

### Shell

`src/app/layout/shell/shell.component.ts`
- Vertical flex: `<app-header>` (56px) + `.shell-body` (sub-nav + `<main>`).
- `subNavCollapsed` signal walks the active route tree on every `NavigationEnd` looking for `data.subNavCollapsed`.
- `mobileNavOpen` signal drives a hamburger overlay on mobile.

---

## Sub-nav indicators

Declare on a nav page:

```ts
{
  label: "Memories",
  route: "/platform/memories",
  indicator: { kind: "count-danger", source: "ai.memories.pending" },
}
```

`source` is a string key resolved by `NavIndicatorRegistry` (`src/app/core/services/metrics/nav-indicator-registry.service.ts`), which routes by prefix to a per-section metrics service:

| Prefix | Service |
|---|---|
| `ai.*` | `AiMetricsService` |
| `channels.*` | `ChannelsMetricsService` |
| `connections.*` | `ConnectionsMetricsService` |
| `processes.*` | `ProcessesMetricsService` |
| `settings.*` | `SettingsMetricsService` |
| `overview.*` | `OverviewMetricsService` |

Each metrics service exposes `Signal<number | null>` per metric + a `resolve(source)` method.

**Indicator kinds:**

| Kind | Visual | Use when |
|---|---|---|
| `count` | Muted gray number | Informational ("Users 142") |
| `count-warn` | Amber number, tinted background | Approaching a limit ("Quotas 1") |
| `count-danger` | Red number, tinted background | Needs action now ("Audit log 3") |
| `dot` | Single colored dot, no number | Boolean alert state |

A null or zero value hides the indicator. Don't render `0` — it's noise.

---

## Reusable primitives (admin-console)

Catalog of standalone components in `src/app/shared/components/`. All use `ChangeDetectionStrategy.OnPush`, signals, and `input()` / `input.required()`.

| Component | Selector | Purpose |
|---|---|---|
| `PageHeaderComponent` | `app-page-header` | Title + subtitle + status slot + actions slot |
| `KpiCardComponent` | `app-kpi-card` | Label + big value + optional trend arrow + sub-line |
| `ActivityFeedComponent` | `app-activity-feed` | Vertical timeline (time pill + tone dot + text/html) |
| `SubTabsComponent` | `app-sub-tabs` | Within-page tabs with `routerLinkActive` |
| `BreadcrumbsComponent` | `app-breadcrumbs` | Crumbs nav with router links |
| `SectionLandingShellComponent` | `app-section-landing-shell` | Composes header + KPI grid slot + 2-col content |

Plus existing:
- `StatusBadgeComponent` (`app-status-badge`) — pill badge with semantic color
- `ConfirmDialogComponent` (`app-confirm-dialog`) — destructive action confirm
- `ProgressBarComponent` / `SparklineComponent` — small data viz

---

## Page-level patterns

### 1. Section landing template

The reusable shape: title row + 3–4 KPI cards + 50/50 panel split (top-N + recent activity).

```ts
@Component({
  imports: [SectionLandingShellComponent, KpiCardComponent, ActivityFeedComponent],
  template: `
    <app-section-landing-shell title="AI · Yoizenclaw" [hasSecondary]="true">
      <div slot="actions">
        <button class="btn btn-primary">+ New agent</button>
      </div>

      <div slot="kpis" class="kpis">
        <app-kpi-card label="Active agents" [value]="ai.activeAgents() ?? '—'" />
        <app-kpi-card label="Tokens MTD" [value]="formattedTokens()" [sub]="costSub()" />
        <app-kpi-card label="Memory proposals" [value]="ai.pendingMemoryProposals() ?? 0" />
      </div>

      <div slot="primary" class="panel">
        <h2 class="panel-h">Top agents · last 7 days</h2>
        <!-- list with bars -->
      </div>

      <div slot="secondary" class="panel">
        <h2 class="panel-h">Recent activity</h2>
        <app-activity-feed [entries]="recentActivity()" />
      </div>
    </app-section-landing-shell>
  `,
})
```

Section-specific KPIs:
- **Channels**: connected/total, msgs 24h, hit rate, p95 latency
- **AI**: active agents, tokens MTD, memory proposals
- **Connections**: HTTP count, MCP, Hosted services count
- **Processes**: workflows active, executions today, schedules active

The only section that **doesn't** follow this template is Settings (uses the hub pattern below).

### 2. Settings hub

`src/app/features/settings-hub/settings-hub.component.ts` — special case.

Two group cards, no KPI strip:

```
Identity        Tenant
[Users] [Roles] [Billing]
[API keys]
142 users       Pro plan · renews May 15
3 invitations
```

Each card has a `headline` (single most action-relevant fact) + `chips[]` (the actual sub-pages). Chips double as nav. Tones: `neutral` / `warn` / `danger` / `ok` color the headline. Use `span: true` on a card to make it span both columns (Tenant uses this when it's the only second-row card).

### 3. Detail mini-app (sub-tabs)

Pattern from the workflows detail page (`src/app/features/automation/workflows/detail/`).

```
/workflows/:id          ← shell route loads WorkflowDetailComponent
  /                     ← redirects to /overview
  /overview             ← Overview sub-tab
  /builder              ← Builder sub-tab (subNavCollapsed: true)
  /executions           ← Executions sub-tab
  /runs/:runId          ← Single-run detail page
  /settings             ← Settings sub-tab
```

The shell renders breadcrumbs + title row (with status pill + actions) + `<app-sub-tabs>` + `<router-outlet/>`. Child components walk up to read `:id`:

```ts
private readonly parentParams = toSignal(
  this.route.parent?.params ?? this.route.params,
  { initialValue: this.route.parent?.snapshot.params ?? {} },
);
private readonly id = computed<string>(() => this.parentParams()["id"] ?? "");
```

Use this pattern any time a page needs more than 2 deeply-related views (workflows: Overview/Builder/Executions/Settings; future Channels detail: Overview/Stream/Egress/Settings).

### 4. Connector list

Single-panel table with status-dot rows. See `connections/internal-http.component.ts` for the canonical example.

```html
<div class="panel">
  <div class="row row-head">
    <span class="c-status">Status</span>
    <span class="c-name">Name</span>
    <span class="c-meta">Tag</span>
    <span class="c-time">Last used</span>
  </div>
  @for (r of rows(); track r.id) {
    <div class="row">
      <span class="c-status" [class]="'rs-' + statusClass(r.status)">
        <span class="dot"></span>{{ r.status }}
      </span>
      <span class="c-name">{{ r.name }}</span>
      <span class="c-meta">{{ r.tag }}</span>
      <span class="c-time">{{ r.lastUsed }}</span>
    </div>
  } @empty {
    <p class="empty">No connectors yet.</p>
  }
</div>
```

Status classes: `rs-ok` (green), `rs-fail` (red), `rs-running` (blue), `rs-other` (text2).

### 5. Empty-state placeholder

For features whose backend is in development. See `connections/mcp-placeholder.component.ts`.

```html
<app-page-header title="MCP" subtitle="Conectores Model Context Protocol">
  <div slot="actions">
    <button class="btn" type="button" disabled>+ Add MCP server</button>
  </div>
</app-page-header>

<section class="empty-card">
  <div class="empty-icon">⏱</div>
  <h2 class="empty-h">Backend in development</h2>
  <p class="empty-sub">La interfaz ya está lista; el backend vendrá pronto.</p>
  <button class="btn" type="button" disabled>Notify me when ready</button>
</section>
```

Use the SAME page shell + actions row as the eventual real page so swap-in is trivial later. Disabled action button telegraphs "this exists, just waiting".

### 6. Filterable list with pagination

Workflow Executions tab is the pattern (`workflow-executions.component.ts`).

```html
<header class="exec-h">
  <div class="exec-filter">
    <label>Status</label>
    <select [value]="statusFilter()" (change)="onStatusFilter($event)">
      <option value="">All</option>
      <option value="completed">Completed</option>
      <option value="failed">Failed</option>
    </select>
  </div>
  <div class="exec-meta">{{ total() }} executions</div>
</header>

<!-- table -->

<footer class="pager">
  <button [disabled]="page() === 0" (click)="prev()">← Prev</button>
  <span>Page {{ page() + 1 }} · {{ pageSize }}/page</span>
  <button [disabled]="!hasNext()" (click)="next()">Next →</button>
</footer>
```

Server-side pagination (`page` + `pageSize` + `sort` triple) — the API service holds the filter state, the component drives signals.

---

## Status pills

Inline pill next to a title:

```html
<span class="status-pill" [class]="'sp-' + statusClass(s)">
  <span class="dot"></span>{{ label }}
</span>
```

```css
.status-pill {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  display: inline-flex; align-items: center; gap: 5px;
  font-weight: 500;
}
.sp-ok { background: color-mix(in srgb, var(--green) 15%, transparent); color: var(--green); }
.sp-fail { background: color-mix(in srgb, var(--red) 15%, transparent); color: var(--red); }
.sp-running { background: color-mix(in srgb, var(--primary) 15%, transparent); color: var(--primary); }
.sp-other { background: var(--bg3); color: var(--text2); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: 0.85; }
```

For passive list-row status (no pill), use a colored leading dot only:

```html
<span class="rs-ok"><span class="dot"></span>ok</span>
```

---

## React (yoizen-ui) component recipes

These remain relevant for the React app. Tailwind utility-first.

**Card:**
```tsx
<div className="bg-card border border-subtle rounded-lg p-4 shadow-lg">
  <h3 className="text-lg font-semibold text-primary">Title</h3>
  <p className="text-secondary mt-2">Description</p>
</div>
```

**Buttons:**
```tsx
<button className="bg-primary hover:bg-blue-600 text-white px-4 py-2 rounded-md transition-all">
  Primary
</button>
<button className="bg-surface border border-subtle hover:bg-card text-white px-4 py-2 rounded-md transition-all">
  Secondary
</button>
<button className="bg-accent hover:bg-orange-600 text-white px-4 py-2 rounded-md transition-all">
  Highlight
</button>
```

**Input:**
```tsx
<input
  className="w-full bg-surface border border-subtle rounded-md px-3 py-2 text-primary
             focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary
             placeholder:text-muted"
  placeholder="Enter text..."
/>
```

**Layout (sidebar + main):**
```tsx
<div className="flex h-screen">
  <aside className="w-64 bg-sidebar border-r border-subtle">{/* nav */}</aside>
  <main className="flex-1 bg-background overflow-auto p-6">{/* content */}</main>
</div>
```

---

## Tailwind config (yoizen-ui)

```javascript
export default {
  theme: {
    extend: {
      fontFamily: {
        sans: ["Plus Jakarta Sans", "Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
        barlow: ['Barlow', 'sans-serif'],
      },
      colors: {
        primary: '#1A66FF',
        secondary: '#4A3ABF',
        accent: '#FD6421',
        yellow: '#FDBD27',
        background: '#1a1a1a',
        surface: '#2d2d2d',
        card: '#3a3a3a',
        muted: '#808080',
        subtle: '#404040',
      },
    },
  },
};
```

Admin-console does **not** use Tailwind — it composes inline `styles:` in components and references CSS variables via `:host` styles or inline.

---

## Brand assets

Located in `skills/yz-ui/assets/`:

| File | Use |
|------|-----|
| `logo.svg` | Main logo |
| `logo-sec-slogan.svg` | Logo with slogan |
| `logo-negativo.svg` | Negative |
| `logo-negative.svg` | Alt negative |
| `logo-footer.svg` | Footer |
| `logo-dorso-maneas.svg` | Special variant |
| `icon.svg` | Favicon / avatar |

Also: `assets/css-snippets.css` (React/Tailwind utility snippets), `assets/admin-console-snippets.css` (admin-console CSS-variable patterns), `assets/component-template.tsx` (React skeleton), `assets/component-template.angular.ts` (Angular standalone skeleton).

---

## Best practices

### DO
- Reference CSS variables in admin-console; use `bg-*`/`text-*` Tailwind classes in yoizen-ui — never raw hex.
- Apply `ChangeDetectionStrategy.OnPush` on every Angular component.
- Use signals + `computed()` for derived state. `toSignal(...)` to bridge observables.
- Use `input.required()` / `input()` for inputs; never `@Input` decorators.
- `routerLinkActive` for active state on nav items, not manual class toggles.
- Use the existing primitives (KpiCardComponent etc.) — don't roll your own KPI card.
- Match the section-landing slot layout (`actions` / `kpis` / `primary` / `secondary`) when building a new landing.
- Status pills 11px / radius pill / `color-mix` tinted backgrounds.
- Empty values render as `—`, not as `null` or `0` (count indicators hide entirely on 0).

### DON'T
- Hardcode hex colors anywhere.
- Use Material Dialog for in-flow editing — prefer docked panels (left for nav, right for inspector).
- Render `0` in count indicators — hide them.
- Use `100vh`/`100vw` inside the shell — the shell already manages height.
- Reach into private properties of services (`service["http"]`) — add a public method instead.
- Add new sections to the top nav without updating `matchPaths` AND `landingPath` AND a metrics service.

---

## Paths reference

See `references/docs.md` for the canonical file map across both apps (admin-console + yoizen-ui).
