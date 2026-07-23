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

### Connections composition

The Connections section (fleet landing at `/connections`, plus the existing
per-type routes `/connections/http/:id` and `/connections/mcp/:id`) was
rebuilt on top of the `console-redesign-foundation` primitives, per
`manual-loops/admin-console/console-redesign-connections.md`.

- **Fleet landing** (`features/connections/connections-landing.component.ts`)
  — a `app-kpi-card` row of HTTP/MCP/Hosted counts from
  `ConnectionsMetricsService`, an `app-inventory-table` unifying the three
  connector kinds (HTTP adapters, MCP servers, hosted services) into one
  rows array with a `type` column and a per-row health dot, and an
  `app-needs-attention-panel` listing the failing rows across all three
  types. Selecting a row navigates to that row's per-type route
  (`/connections/http/:id`, `/connections/mcp/:id`); hosted services keep
  their existing dialog-based editing entry point instead of a detail route
  (per SPEC decision 2).
- **Health mapping (orchestrator ruling, applying the Channels-loop
  precedent — real fields only, no invented thresholds)**: each connector
  type maps its own real status field independently, there is no shared
  cross-type health enum:
  - **Hosted services** reuse the existing `statusColor()` semantics
    unchanged (`active` → ok, `pending` → warn, `error` → error — all three
    are real backend states, not derived).
  - **MCP servers** map `enabled && is_active` → ok, else error (the same
    binary logic already used at `mcp-servers-page.component.ts` and
    `mcp-detail.component.ts`); there is no source field for a `warn` state.
  - **HTTP connectors** map `status === "enabled"` → ok, else error (from
    `IAdapterDto.status: "enabled" | "disabled"`); there is no source field
    for a `warn` state either.
  - No health state is ever derived from call error rates, p95, or other
    thresholds — that data does not exist in any of the three services
    today (see `manual-loops/admin-console/console-redesign-connections.md`
    §T01 findings) and inventing a threshold would repeat the DLQ-derived
    `warn` the human explicitly rejected in the Channels loop's decision 3.
    Flagged as a backend follow-up, not fixed in this loop.
- **Detail views** (`features/data-integrations/connectors/detail/connector-detail.component.ts`
  for HTTP, `features/connections/mcp-detail/mcp-detail.component.ts` for
  MCP) were restyled in place per decision 2: a health-dot + identity-chip
  header, `app-kpi-card`s for the config summary, and the existing "Recent
  calls"/"Recent invocations" sections (already wired to
  `ConnectorCallService`/`AgentAdminService.getMcpServerUsage()` before this
  loop) restyled, not rebuilt.
- **Edit-in-header pattern** — Edit opens the pre-existing edit
  dialog/form for that connector type (`http-adapter-dialog`,
  `mcp-server-dialog`) unchanged, from a button in the detail header rather
  than a fork of the form. Save is fail-fast: a failed save renders a
  user-visible `saveError` banner in the detail view instead of failing
  silently; the dialogs themselves are reused as-is (decision 2 — "existing
  edit forms/dialogs are embedded unchanged").
- **Secrets rule (decision 3)** — every list/detail render site reads only
  the `authType`/`auth_type` field; `authConfig`/`auth_config` values are
  never spread or rendered outside the reused edit-dialog form inputs.
  Sentinel-tested in both detail views: unit tests assert a sentinel secret
  value placed in `authConfig`/`auth_config` never appears in the rendered
  DOM of `connector-detail` or `mcp-detail`. The landing table's row-mapping
  functions only read `authType`/`transport_type`/`image` (no secret field
  is ever touched), but there is no equivalent sentinel unit test on
  `connections-landing.component.spec.ts` yet — tracked as a pending
  follow-up.

### AI composition

The AI section (`features/automation/ai/`, routes `/ai/agents` and
`/ai/agents/:id/configure`) was rebuilt on top of the
`console-redesign-foundation` primitives, per
`manual-loops/admin-console/console-redesign-ai.md`.

- **List view** (`ai-agents-page.component.ts` → `ai.component.ts` list
  mode, delegating to `existing-agents-panel.component.ts`) — an
  `app-kpi-card` row of real agent counts, an `app-inventory-table` with a
  runtime-state health mapping (`ai.component.ts`'s `runtimeHealth` signal,
  driven by `AgentRuntimeService.checkRuntimeHealth()`): `synced` → `ok`,
  `draft` → `idle`, `unsynced` → `warn`, `misconfigured` → `error`, plus an
  `app-needs-attention-panel` for agents in a failing runtime state.
  Invocation counts, p95, and sparklines from the design mock have no
  backing field on `IAgent` or any per-agent stats endpoint — flagged
  NO-DATA rather than invented (T01 finding).
- **Editor architecture — Monaco decorations overlay, display-layer only**
  (`ai.component.ts`'s Monaco panes bound to `systemPrompt`/`rules`/`soul`,
  hosted by `ai-agent-editor-page.component.ts`'s `AiAgentEditorPageComponent`,
  which composes `<app-ai>` (editor) side by side with
  `<app-agent-test-panel>` for both `/ai/agents/new` and
  `/ai/agents/:id/configure`). Mention highlighting (`@skill:<id>` /
  `@tool:<id>`, purple/green per the design) is implemented as a Monaco
  decorations layer added alongside the existing `ai-monaco-hover.ts`
  hover/completion providers — it never touches the stored prompt text or
  the save path. The single source of truth is `MENTION_PATTERN_SOURCE`
  in `ai.helpers.ts`: `ai-monaco-decorations.ts`'s
  `computeMentionDecorationRanges` builds its regex via
  `createMentionRegex()` (constructed from `MENTION_PATTERN_SOURCE`), the
  same factory `extractMentionsFromPrompt` also consumes, so highlighting
  and the mention parser can never drift out of sync. Saved payloads are
  byte-identical to what the pre-redesign editor would save.
- **Test panel — invoke reuse, no new endpoints** — a NEW standalone
  `agent-test-panel` component sits beside the editor and reuses
  `AgentRuntimeService`'s existing `createExecution` → poll `getExecution`
  contract, the same pattern already proven in `playground.component.ts`.
  Tokens are read directly from `result.usage.*`; latency is computed
  client-side as `completedAt - startedAt` (not a backend field); failed or
  timed-out executions render a visible error turn, never fail silently.
  No new API endpoints were added.
- **The T04 amendment (human sign-off, 2026-07-22)** — the SPEC originally
  called for restyling the "existing" `chat-panel.component.ts` test panel.
  T01's inventory found `chat-panel.component.ts` was in fact an orphaned
  prompt-editing component with zero invoke wiring, never imported by any
  route or the AI host component. Rather than "restyle in place," the test
  panel was built as the new `agent-test-panel` component described above;
  the orphaned `chat-panel.component.ts` was left untouched, with its
  removal tracked as a follow-up.

### Processes & builder composition

The Processes section (workflow list at `/workflows` and the workflow
builder at `/workflows/:id/builder` etc., under
`features/automation/workflows/`) was rebuilt on top of the
`console-redesign-foundation` primitives, per
`manual-loops/admin-console/console-redesign-processes-builder.md`.

- **List view** (`workflows.component.ts`) — an `app-inventory-table` of
  workflows (health dot, run sparkline, status) plus an
  `app-needs-attention-panel`, sourced from a new `WorkflowApiService`
  wrapper, `getSummary()`, around the **existing**
  `GET /workflows/summary` endpoint (already implemented server-side —
  `WorkflowsService.getWorkflowsSummary`, 7-day-windowed
  `topByExecutionCountLast7d`) — no new backend endpoint was added; T01
  found the endpoint existed but was simply never wired into
  admin-console. Health mapping: `active` → `ok`, `draft` → `idle`,
  `disabled` → `warn` (there is no per-workflow success/error-rate field
  today, so health is derived from workflow status only, not from run
  outcomes). Enable/disable moved off the list row into the workflow
  detail view's **Settings** tab, behind a confirm dialog, with a
  user-visible error banner on a failed toggle (never fails silently).
- **Builder — full-bleed shell.** The builder route hides only the left
  **sub-nav**, not the app header/tabs — this is a documented, human-signed
  amendment to the original SPEC wording; see "Amended decisions" below.
  The mechanism is a new `subNavHidden` route-data flag that extends the
  existing `subNavCollapsed` mechanism (`app.routes.ts` → `ShellComponent`'s
  `readRouteDataFlag`/sub-nav visibility), rather than inventing a
  parallel chrome-hiding system. Floating chrome (back button, workflow
  name, save state, zoom controls) overlays the canvas and drives zoom via
  `@foblex/flow`'s existing `FCanvas`/`fZoom` APIs — no new zoom engine.
- **Builder — node-type port colors.** Ports and node accents are colored
  by `EWorkflowNodeType` via a `KIND_STRIPE`-style mapping (per the
  amended decision 4 below), not by a nonexistent port-level data type:
  `channel` → `--rd-green`, `conditional` → `--rd-yellow`, `agent` →
  `--rd-purple`, every other node type (`jsFunction`, `endpointCall`,
  `mcpCall`, `serviceCall`, `serviceBusCall`, `branch`) → a neutral
  fallback token. Applied consistently to the node border/icon tint and
  to both ends of each port dot.
- **Builder — edge labels.** Edge labels render from
  `IWorkflowConnection.label` via `fConnectionContent`; the field already
  exists on the connection model but is **never populated** by
  `flow-serializer.ts`/`flow-deserializer.ts` today, so labels currently
  render empty/absent for every existing saved workflow. This is a
  wiring-ready display path, not invented data — labels will appear as
  soon as the serializer starts setting the field (see follow-ups).
- **Builder — per-node mini-stats.** The stats badge slot exists in the
  node card markup but renders hidden: T01 confirmed there is no
  per-node execution-count/error-rate aggregate anywhere in the platform
  (`ITopDefinitionRow` is per-definition only), so the badge is a
  documented NO-DATA state rather than invented numbers.
- **Builder — floating inspector.** Node selection opens a floating panel
  embedding the **same** `WorkflowNodeConfigComponent` used before this
  loop (same fields, same save path) — only its container/positioning
  changed. It dismisses on canvas click, `Esc`, or an explicit close (×).
  Fixing the inspector's `Esc` dismissal surfaced a regression: the
  Monaco/autocomplete-style field inputs inside the config form were
  swallowing `Esc` before it reached the inspector's dismiss handler; the
  fix stops the autocomplete's own `Esc` handling from propagating
  further only when it actually closes an open suggestion list, otherwise
  `Esc` propagates and dismisses the inspector. Covered by a regression
  test.
- **Round-trip guarantee.** The builder's save path
  (`flow-serializer.ts`/`flow-deserializer.ts`) was not modified by this
  loop. A unit test opens every one of the 9 `EWorkflowNodeType`s, saves
  without edits, and asserts the resulting `{name, application, actions,
  trigger}` payload is **deep-equal** (not raw-string-equal — key order
  is not guaranteed) to the original, guarding against a future
  regression in the reused engine.

**Amended decisions (human sign-off, 2026-07-22, made after T01's
inventory findings):**

- **Decision 4 (port colors)** — the original wording, "port colors map
  by port data type," does not match the domain model: there is no
  per-port data type anywhere in `workflow-node.types.ts`, only one input
  and one output port per node. The confirmed rule instead colors by
  `EWorkflowNodeType` (node kind), matching both the existing pre-redesign
  `.is-channel`/`.is-branch`/`.is-conditional` CSS classes and the design
  mock's own `KIND_STRIPE` mapping.
- **Decision 3 (full-bleed)** — the original wording, "hides the console
  sidebar/topbar," conflicts with the binding visual contract (the
  `11-builder.png` screenshot and the mock's `showRail: !isBuilder`),
  which keeps the app header and top-section tabs visible in the builder
  and hides only the left sub-nav. The confirmed rule follows the
  screenshot: sub-nav hides, header/tabs stay, floating chrome overlays
  the canvas below the header.

### Trace composition

The trace screens (`processes/trace/:correlationId`,
`processes/runs/:workflowId/:runId`, under `features/processes/trace/`
and `features/processes/run-view/`) were rebuilt on top of the
`console-redesign-foundation` primitives and the existing tracking-chain/
run-view data pipelines, per
`manual-loops/admin-console/console-redesign-trace.md`.

- **Up to four tabs (orchestrator ruling, applying the "design wins" + "real
  data only" precedents, post-T01)** — `TraceDetailComponent` defines three
  static tabs (`TABS`) plus a **run** tab that `visibleTabs()` appends only
  when the chain contains a workflow run
  (`trace-detail.component.ts:877-879`), matching the binding visual
  contract (`Rediseño Terminal.dc.html`'s `traceTabs` script) rather than
  the SPEC Goal section's original four-view wording:
  - **Waterfall** — time-ordered bars per event (`TraceWaterfallComponent`),
    now clickable (selection wiring added in this loop; the pre-existing
    component had no `(click)` handler at all).
  - **Causal graph** — `causation_id`/`causation_depth` node/edge graph
    (`CausalGraphComponent`), migrated off its own local `selected` signal
    and inline detail card onto the shared selection service; payload
    fetch-on-demand and the `tracking:payload:read` permission gate moved
    into the inspector.
  - **Legacy** — the pre-existing `MessageTraceComponent` pipeline
    (`message-trace.service.ts`/`assemble-trace.ts`), left unmodified; it
    keeps its own data source (not `TrackingChainService`) and its own
    richer `{service, durable, role, health}` subscriber shape, which is
    NOT available on the other three tabs (see subscriber note below).
  - **Run** — the run-view canvas (`RunViewComponent`) embedded as a tab,
    plus a **step-log sub-panel inside the run tab** (not a fifth tab —
    the design mock places "Step log" below the run canvas on the same
    `run` tab selection). The step log reuses the run's already-loaded
    `IRunResponse`/`IRunLayout` — no new fetch.
- **`TraceSelectionService` — single selection owner.** Selected event id
  + source view live ONLY in this signal-based, component-provided
  service (scoped to the trace screen, not root-provided); no view holds
  its own selected-event state. Waterfall, causal graph, and run-view all
  read/write through it; selecting in one view highlights the same event
  in the others and drives the shared inspector. The run-view canvas's
  own two prior selection signals (cast-chip highlight, node-click popup)
  and the causal graph's local `selected`/inline detail card were removed
  in favor of this single source.
- **Docked inspector — context-aware content.** One shared docked panel
  renders: base event header (kind/service/time), the base dl
  (event_id/causation/depth/tech/business_fn/claim_check/compliance/
  subject/stream/persisted), a "View payload" toggle that triggers the
  SAME on-demand `TrackingChainService.getEventPayload` fetch the causal
  graph used before this loop (gated by `tracking:payload:read`, handling
  not-captured/404 and scrubbed/410 states). **Subscribers are NOT yet
  rendered** — `trace-detail.component.ts` never reads `event.consumed_by`;
  the field exists only on the `ITrackedEvent` type and in test fixtures.
  Rendering `consumed_by` as a subscriber list remains an open item (the
  richer `{service, durable, role, health}` shape stays legacy-tab-only
  regardless — no backend field carries it on the tracking-chain
  pipeline). Mode-specific additions: timing %
  of total in waterfall mode (`computeEventTimingPercent`, derived from
  the same span-matching `waterfall-geometry.ts` already used for
  bottleneck detection); causal chain in causal-graph mode
  (`computeCausalChain`, a pure derivation over `causation_id`/
  `causation_depth`); step result (status/duration/evaluated value/branch
  taken) in run mode.
- **Deep links — gated on real identifiers, never synthesized.**
  - **Temporal**: rendered via `resolveTemporalDeepLink`, extracted
    verbatim from the legacy tab's `temporalUrl()` pattern
    (`environment.temporalUiBaseUrl`/`temporalNamespace`). Gated on both
    `workflow_id` AND `run_id` being present on the selected event — most
    chain/waterfall/causal-graph events do not carry them (only
    `execution_started`-class events do); the run-view tab always has
    them (`IRunResponse.workflow_id`/`run_id` at the top level). Hidden,
    never a broken link, when either id is missing.
  - **Builder**: stays HIDDEN in every mode. No trace-event→builder-canvas
    node id bridge exists anywhere in the codebase (`ILayoutNode.id` is a
    synthetic `(branchPath, actionIndex)` key inside the run's own step
    tree, not a `@foblex/flow` canvas node id) — per the ruling, the
    builder link is never synthesized/approximated; it ships inert
    pending that id-bridge follow-up.
  - **Entity links** (connector/agent/MCP/hosted-service): render in all
    four modes, including run-mode, via
    `resolveSelectedStepDeepLink`/the shared `resolveEntityDeepLink` —
    unchanged from the prior-art mapping (connector `endpoint_call`
    completions and agent-execution kinds only).
- **Run-view restyle.** `--rd-*` CSS custom properties replace the
  renderer's prior hard-coded styling; step status renders as ✓ (ok) / ✕
  (failed) / – (not_executed) badges sourced from the real `ActionStatus`
  union (`"ok" | "failed" | "not_executed"`), never an invented state.
  `TraceSelectionService` is OPTIONAL on the run-view component — the
  standalone `/processes/runs/:workflowId/:runId` page keeps using its
  own popup-based detail (unaffected by this loop); only the run tab
  embedded inside `TraceDetailComponent` provides the service and gets
  the docked-inspector behavior.
