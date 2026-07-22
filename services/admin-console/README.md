# Admin Console

Tenant-scoped administration dashboard for the Yoizen platform. Built with Angular 21, standalone components, signals, Angular Material, and the Yoizen UI shell. Each authenticated user sees data for the tenant encoded in their JWT.

## Quick Start

```bash
npm install
ng serve
```

Open `http://localhost:4200/`. Unauthenticated users are redirected to `/login`.

## Authentication and tenant scope

The console authenticates via `POST /auth/login` (email + password). The JWT payload provides:

- `scope` — tenant scope, for example `tenant:<id>`
- `role` — `tenant_admin`, `tenant_editor`, or `tenant_viewer`
- `tenant_id` — tenant identifier
- `email` — user email

The client decodes the JWT to derive the user profile and tenant context. HTTP interceptors attach the bearer token and `x-yoizen-tenant` header to API requests. The app has no tenant switcher; tenant selection comes from the token.

## Current navigation model

The shell uses top header sections plus a left sub-nav, not the older role-filtered sidebar. Current top sections come from `src/app/layout/nav/nav.config.ts`:

| Top section | Landing | Sub-nav pages |
| --- | --- | --- |
| Overview | `/dashboard` | Dashboard, Analytics |
| Channels | `/channels` | WhatsApp, Telegram, HTTP |
| Connections | `/connections` | Overview, HTTP, MCP, Hosted services |
| AI | `/ai` | Agents, Playground, Memories, Skills, Knowledge Bases, System Variables |
| Processes | `/processes` | Workflows, Schedules |
| Settings | `/settings` | Users, Roles, API keys, Billing |

Route access is protected by `authGuard` at the shell level. Individual feature pages should not be documented as permission-gated unless the route actually has a guard.

## User management

Tenant admins can manage tenant users from **Settings › Users** (`/users`):

- View tenant users with email, display name, role, and creation date
- Create tenant users via the API gateway
- Deactivate tenant users

These operations use the API gateway auth tenant-user routes.

## Project Structure

```
src/
├── app/
│   ├── core/
│   │   ├── guards/           # authGuard route protection
│   │   ├── interceptors/     # auth + tenant headers
│   │   ├── models/
│   │   └── services/
│   ├── features/
│   │   ├── auth/             # Login
│   │   ├── overview/         # Dashboard, Analytics
│   │   ├── channels/         # Channel landing and channel account detail
│   │   ├── connections/      # Connections landing, MCP list/detail
│   │   ├── automation/       # Workflows, schedules, hosted services, AI feature pages
│   │   ├── processes/        # Processes landing and direct message trace route
│   │   ├── identity/         # Users, Roles, API keys
│   │   └── settings-hub/     # Settings landing hub
│   ├── layout/
│   │   ├── shell/            # Header + sub-nav + main outlet
│   │   ├── header/           # Top section tabs
│   │   ├── nav/              # NAV_SECTIONS source of truth
│   │   └── sub-nav/          # Left section sub-nav
│   └── shared/components/    # PageHeader, KPI, ActivityFeed, SubTabs, status primitives
├── environments/
├── styles.scss
└── main.ts
```

## Building

```bash
ng build
ng build --configuration=production
```

The production build is packaged into an nginx container via the Dockerfile.

## Environment Configuration

| File | `apiUrl` |
|------|----------|
| `environment.ts` (dev) | `http://api-gateway.platform-services-dev.192.168.49.2.sslip.io` |
| `environment.prod.ts` | `/api` |

## Component testing strategy

See **Angular consoles** under *Testing* in the repo root `AGENTS.md`. Use Angular `TestBed`, HTTP testing utilities for services, and focused component tests around routing, guards, interceptors, and metrics services before broad feature snapshots.

## Redesign foundation (theming, tokens, primitives)

The visual foundation delivered by `manual-loops/admin-console/console-redesign-foundation.md`
(design tokens, theme service, shell restyle, and the shared primitive
catalog below). Section screens are migrated incrementally on top of this
foundation (separate loops); the shell and primitives already use it.

### Theming

- **Dark is the default theme.** `core/services/theme.service.ts`
  (`ThemeService`) exposes a `readonly isDark = signal<boolean>(...)` and a
  `toggle(): void` method; the toggle lives in the header.
- On every change, `ThemeService` applies **both** a `data-theme="dark" | "light"`
  attribute on `<html>` (the mechanism the redesign tokens key off) and the
  legacy `light-theme` CSS class on `<html>` (kept so pre-redesign selectors
  that already depended on the class keep working during migration).
- The preference persists to `localStorage` under the key
  `admin-console-theme` (values `"dark"` / `"light"`) and is restored on
  init; with no stored value, the app defaults to dark regardless of the OS
  `prefers-color-scheme` setting.

```ts
import { ThemeService } from "./core/services/theme.service";

constructor(private readonly theme: ThemeService) {}

toggleTheme(): void {
  this.theme.toggle();
}
```

### Token conventions

- All redesign colors, type scale, spacing, radii, and shadows are CSS
  custom properties namespaced `--rd-*`, defined once in `src/styles.scss`:
  dark values on `:root` (default), light overrides under
  `[data-theme="light"], .light-theme`.
- Source of truth for every value is the design file
  `manual-loops/admin-console/design/Rediseño Terminal.dc.html` — token
  values are transcribed from it, never invented.
- The pre-existing (non-`--rd-`) Yoizen UI tokens (`--bg`, `--text`, `--accent`,
  etc.) stay untouched and keep serving screens not yet migrated to the
  redesign.
- **No hard-coded hex/rgb colors in component SCSS.** Every color, spacing,
  radius, or shadow value in a component stylesheet must reference an
  `--rd-*` custom property (e.g. `color: var(--rd-text-1);`), never a
  literal like `#0a0a0a`.

### Primitive catalog

Shared, feature-agnostic UI primitives live in `src/app/shared/components/`.
Section screens (L1–L7 loops) compose these rather than building their own
metric cards, tables, or dialogs.

- **`app-kpi-card`** (`kpi-card/kpi-card.component.ts`) — metric card with
  label, value, optional delta/trend and an optional inline sparkline slot.

  ```html
  <app-kpi-card
    label="Active connections"
    [value]="42"
    trend="up"
    trendLabel="+8% this week"
    [sparklineData]="[12, 18, 15, 22, 30, 28, 34]"
  />
  ```

- **`app-sparkline`** (`sparkline/sparkline.component.ts`) — compact
  gradient-filled trend chart from a plain number series; used standalone or
  embedded via `kpi-card`'s `sparklineData` input or an `inventory-table`
  sparkline column.

  ```html
  <app-sparkline [data]="[3, 5, 4, 8, 7, 9]" color="var(--rd-green)" />
  ```

- **`app-status-badge`** (`status-badge/status-badge.component.ts`) — two
  render modes via `variant`: `"badge"` (default pill, backward-compatible)
  and `"dot"` (health dot: `ok` / `warn` / `error` / `idle`).

  ```html
  <!-- pill -->
  <app-status-badge status="active" color="green" />

  <!-- health dot -->
  <app-status-badge status="Healthy" variant="dot" health="ok" />
  ```

- **`app-inventory-table`** (`inventory-table/inventory-table.component.ts`)
  — generic, strictly typed table: pass `columns` (type `"text"` / `"mono"` /
  `"status-badge"` / `"sparkline"`, each with a `value` accessor) and `rows`;
  emits `rowClick` and shows `emptyMessage` when `rows` is empty.

  ```html
  <app-inventory-table
    [columns]="[
      { key: 'id', header: 'ID', type: 'mono', value: (r) => r.id },
      { key: 'health', header: 'Health', type: 'status-badge', value: (r) => r.status, health: (r) => r.health },
      { key: 'trend', header: 'Trend', type: 'sparkline', value: (r) => r.series }
    ]"
    [rows]="accounts()"
    (rowClick)="openDetail($event)"
  />
  ```

- **`app-needs-attention-panel`**
  (`needs-attention-panel/needs-attention-panel.component.ts`) — list of
  issue rows with a severity dot (`critical` / `warning` / `info`) and an
  optional action link; renders `emptyMessage` when `issues` is empty and
  emits `actionClick`.

  ```html
  <app-needs-attention-panel
    title="Needs attention"
    [issues]="[
      { id: '1', message: 'Webhook signing key expiring soon', severity: 'warning', action: { label: 'Rotate' } }
    ]"
    (actionClick)="onAttentionAction($event)"
  />
  ```

- **`app-detail-dialog`** (`detail-dialog/detail-dialog.component.ts`) —
  generic key/value detail overlay; reuses `MatDialog` (no custom modal).
  Open it through `MatDialog.open` with the global `rd-dialog-panel`
  `panelClass` so the dialog surface picks up the `--rd-*` theme.

  ```ts
  this.dialog.open(DetailDialogComponent, {
    panelClass: "rd-dialog-panel",
    data: {
      title: "conn_8f2a91",
      subtitle: "HTTP connector",
      fields: [
        { label: "Status", value: "active" },
        { label: "Created", value: "2026-07-10" },
      ],
    },
  });
  ```

### Dashboard composition

The Overview → Dashboard screen (`features/overview/dashboard/`) was rebuilt
on top of the foundation primitives above, per
`manual-loops/admin-console/console-redesign-dashboard.md`. Top to bottom:

- **Metric strip** — four `app-kpi-card`s driven by `IDashboardStats`
  (`requestsToday`, `activeSessions`, `avgResponseMs`, `errorRate`, each with
  its `*Delta`/trend where the service provides one). Sparklines render only
  on `requestsToday` and `avgResponseMs`, the two metrics with an actual
  `dailyBreakdown` series behind them — the other two cards render as plain
  value/delta cards, no invented series.
- **API-usage panel + Activity row** — `app-sparkline` renders the 7-day
  `dailyBreakdown[].requests` series ("API usage"), next to an activity feed
  built from `IDashboardStats.recentActivity`. Each row's dot color is
  derived from `IDashboardActivity.type` via an `activityTone` mapping, kept
  consistent with the severity mapping already established by
  `RightPanelComponent.activityColor` rather than inventing a new palette.
- **Recent workflows** — `app-inventory-table` sourced from
  `ProcessesMetricsService.topWorkflows`, with **Name and Executions columns
  only**. Trigger, p95, and Estado are intentionally omitted: none of them
  has a real data source today (`successRate` is hard-coded to `1` for every
  row and must not be rendered as a live status). Row click navigates to
  `/workflows/:id`.
- **No needs-attention panel on this screen.** The binding design
  (`Rediseño Terminal.dc.html`, Dashboard section) does not include one — the
  needs-attention panel is a Channels ops-view element (L2), not Dashboard.
  Both the real-columns-only table and the absence of the attention panel
  here are documented, human-signed-off amendments to the original SPEC
  layout — see `manual-loops/admin-console/console-redesign-dashboard.md`
  §"User decisions", amendments dated 2026-07-21.

### Channels composition

The Channels → per-channel fleet screen (`features/channels/channels.component.ts`,
routed at `/channels/:channel`) and the account detail screen
(`features/channels/detail/channel-detail.component.ts`, routed unchanged at
`/channels/:channel/accounts/:accountId`) were rebuilt on top of the
foundation primitives, per
`manual-loops/admin-console/console-redesign-channels.md`.

- **Fleet view** — a metric-card row (messages 24h, active/inactive account
  counts) above an `app-inventory-table` of accounts (health dot, sparkline
  column, status) sourced from `ChannelAdminService.listAccounts()`, plus an
  `app-needs-attention-panel` listing inactive accounts. A row click
  navigates to that account's detail route.
- **Health mapping (Mapping A)** — the inventory table's health dot uses
  `IChannelAccount.isActive` as the only status source: `isActive === true`
  → primitive `ok` (green), `isActive === false` → primitive `error` (red).
  This is a 2-state mapping; the design's third state, `warn` (yellow), is
  **unreachable** with the fields available today and is documented as a
  backend follow-up (a per-account degradation signal — e.g. recent `dlq`
  events or a `reauth`-specific flag — does not exist on `IChannelAccount`
  or in `listAccounts()`'s response). It is never derived from DLQ counts in
  this loop, since that would require an extra `getUsageTotals` call per
  row. The `status-badge` primitive's `idle` value stays unused here.
- **Detail view** — Edit and Delete were relocated from the fleet table
  (the design has no action column there) to the account-detail header,
  reusing the existing `AccountDialogComponent` edit mode and
  `ChannelAdminService.deleteAccount`; delete confirms via the existing
  confirm-dialog and navigates back to the fleet on success. This is a
  human-signed amendment to the original SPEC layout, recorded in
  `manual-loops/admin-console/console-redesign-channels.md` §"T03 — Account
  detail view". The account for the detail route is resolved client-side by
  matching `listAccounts()` against the route's `:accountId` (no dedicated
  get-by-id endpoint); an unknown id renders a not-found state.
