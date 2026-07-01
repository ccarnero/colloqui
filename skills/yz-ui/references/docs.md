# Yoizen UI — paths reference

There are two consumers of this design system in the repo:

- **admin-console** — Angular 21 (standalone components, signals, OnPush, CSS variables, Angular Material). Currently the most active surface; documents most of the patterns described in `SKILL.md`.
- **yoizen-ui** (legacy) — React + Tailwind. Brand-level reference; the pre-existing app the skill was originally written for.

All paths below are relative to the repo root (`platform-cluster/`).

---

## Admin Console (Angular)

Path root: `services/admin-console/`

### Layout shell

| File | Purpose |
|---|---|
| `src/app/layout/nav/nav.config.ts` | Sections + sub-nav pages + indicators + landingPath. Single source of truth for navigation. |
| `src/app/layout/shell/shell.component.ts` | Top-level shell. Reads `data.subNavCollapsed` from the active route. |
| `src/app/layout/header/header.component.ts` | Underline tab-nav header. Tabs route to `section.landingPath`. |
| `src/app/layout/sub-nav/sub-nav.component.ts` | 180px left rail. Renders indicators + supports collapse mode. |

### Reusable shared primitives

Path: `src/app/shared/components/`

| Component | Folder | Purpose |
|---|---|---|
| `PageHeaderComponent` | `page-header/` | Title + subtitle + status slot + actions slot |
| `KpiCardComponent` | `kpi-card/` | KPI tile (label + big value + optional trend) |
| `ActivityFeedComponent` | `activity-feed/` | Vertical timeline (time + tone dot + text/html) |
| `SubTabsComponent` | `sub-tabs/` | Within-page tabs with `routerLinkActive` |
| `BreadcrumbsComponent` | `breadcrumbs/` | Crumb nav with router links |
| `SectionLandingShellComponent` | `section-landing-shell/` | Composes header + KPI grid slot + 2-col content |
| `StatusBadgeComponent` | `status-badge/` | Pill badge with semantic color |
| `ConfirmDialogComponent` | `confirm-dialog/` | Destructive action confirm |
| `SparklineComponent` | `sparkline/` | Tiny inline trend |
| `ProgressBarComponent` | `progress-bar/` | Linear progress |
| `HttpAdapterDialogComponent` | `http-adapter-dialog/` | Shared external-HTTP adapter form |

### Section landings

| Section | Component | Path |
|---|---|---|
| Overview | `DashboardComponent` | `src/app/features/overview/dashboard/dashboard.component.ts` |
| Channels | `ChannelsLandingComponent` | `src/app/features/channels/channels-landing.component.ts` |
| Connections | `ConnectionsLandingComponent` | `src/app/features/connections/connections-landing.component.ts` |
| AI / platform | `PlatformLandingComponent` | `src/app/features/automation/ai/platform-landing.component.ts` |
| Processes | `ProcessesLandingComponent` | `src/app/features/processes/processes-landing.component.ts` |
| Settings hub | `SettingsHubComponent` | `src/app/features/settings-hub/settings-hub.component.ts` |

### Connections sub-pages

Path: `src/app/features/connections/`

| Page | File | Backend |
|---|---|---|
| Connections landing | `connections-landing.component.ts` | n/a (aggregates) |
| HTTP (flat — internal/external sub-tabs deferred) | routed to `ConnectorsComponent` (legacy at `data-integrations/connectors/`) | connector-admin `/connectors` |
| Internal HTTP (orphan, kept for v2) | `internal-http.component.ts` | registry-service routes (fan-out) |
| MCP placeholder | `mcp-placeholder.component.ts` | none yet |
| Hosted services | routed to legacy `automation/hosted-services/hosted-services.component.ts` | registry-service `/services` |

### Processes / workflows

Path: `src/app/features/automation/workflows/`

| Component | Path |
|---|---|
| `WorkflowsComponent` (list) | `workflows.component.ts` |
| `WorkflowBuilderComponent` (canvas) | `builder/workflow-builder.component.ts` |
| `WorkflowDetailComponent` (mini-app shell) | `detail/workflow-detail.component.ts` |
| `WorkflowOverviewComponent` | `detail/workflow-overview.component.ts` |
| `WorkflowExecutionsComponent` | `detail/workflow-executions.component.ts` |
| `WorkflowRunDetailComponent` | `detail/workflow-run-detail.component.ts` |
| `WorkflowSettingsComponent` | `detail/workflow-settings.component.ts` |

Builder sub-components: `builder/components/{workflow-node, workflow-palette, workflow-node-config, workflow-validation-dialog}/`.

### Metrics services

Path: `src/app/core/services/metrics/`

| Service | Source-key prefix |
|---|---|
| `AiMetricsService` | `ai.*` |
| `ChannelsMetricsService` | `channels.*` |
| `ConnectionsMetricsService` | `connections.*` |
| `OverviewMetricsService` | `overview.*` |
| `ProcessesMetricsService` | `processes.*` |
| `SettingsMetricsService` | `settings.*` |
| `NavIndicatorRegistry` | Routes by prefix → returns `Signal<number \| null>` |

### Routes + redirects

`src/app/app.routes.ts` — top-level. Phase 4 redirects:

| Old | New |
|---|---|
| `/connectors` | `/connections/http` |
| `/hosted-services` | `/connections/hosted-services` |
| `/data` | `/connections` |
| `/automate` | `/processes` |
| `/scheduler` | `/schedules` |
| `/connections/internal-http` | `/connections/http` |
| `/connections/external-http` | `/connections/http` |
| `/workflows/:id/edit` | `/workflows/:id/builder` |
| `/auto-reply` (deleted) | `/dashboard` (catch-all) |
| any other unknown | `/dashboard` (catch-all) |

### Build / cleanup

| File | Purpose |
|---|---|
| `package.json` | Scripts: `build:shared`, `prebuild`, `pretest`, `prestart`, `prewatch` |
| `scripts/phase4-cleanup.sh` | Idempotent local cleanup of orphaned files |
| `PHASE4_CLEANUP.md` | Manual checklist (mirrored by the script) |
| `../../packages/angular-shared/scripts/build-lib.mjs` | Idempotent symlink + tsc compile, called via `prebuild` |

---

## yoizen-ui (React, legacy)

Path root: `Services/yoizen-ui/` (in the YoizenClaw workspace, separate from this monorepo).

### Configuration

| File | Description |
|---|---|
| `tailwind.config.js` | Theme extension (colors, fonts) |
| `src/index.css` | CSS variables + global utilities |
| `postcss.config.js` | PostCSS |
| `vite.config.ts` | Bundler |

### Components

| Component | Path | Pattern |
|---|---|---|
| Layout | `src/components/layout/Layout.tsx` | Sidebar + main |
| Sidebar | `src/components/layout/Sidebar.tsx` | Nav + active states |
| Button | `src/components/common/Button.tsx` | Variants, icons, loading |
| Card | `src/components/common/Card.tsx` | Borders, shadows, padding |
| Input | `src/components/common/Input.tsx` | States, validation, focus |
| Modal | `src/components/common/Modal.tsx` | Overlays |
| HealthStatus | `src/components/dashboard/HealthStatus.tsx` | Status badges |
| StatsCards | `src/components/dashboard/StatsCards.tsx` | Metric grids |

### Hooks + types

| File | Purpose |
|---|---|
| `src/hooks/useJobs.ts` | Data-fetching hook |
| `src/hooks/useAiAssist.ts` | AI drawer state |
| `src/services/api.ts` | API client |
| `src/types/{agent,jobs,health,webchat}.ts` | Type definitions |

### Pages

| Page | Path |
|---|---|
| Dashboard | `src/pages/Dashboard.tsx` |
| Agents | `src/pages/Agents.tsx` |
| Agent detail | `src/pages/AgentDetail.tsx` |
| Jobs | `src/pages/Jobs.tsx` |
| Settings | `src/pages/Settings.tsx` |
| Demo | `src/pages/Demo.tsx` |

### Brand assets (shared)

Located in `skills/yz-ui/assets/` and mirrored into the React app's `public/`:

| Asset | Use |
|---|---|
| `logo.svg` | Main logo |
| `logo-negativo.svg` | Negative |
| `logo-sec-slogan.svg` | With slogan |
| `icon.svg` | Favicon / avatar |
| `logo-footer.svg` | Footer |

---

## Skill assets

Path: `skills/yz-ui/assets/`

| File | Use |
|---|---|
| `css-snippets.css` | Universal / React-Tailwind utility patterns |
| `admin-console-snippets.css` | Admin-console CSS variable patterns (status pills, panels, KPIs, hub cards, indicators, empty state) |
| `component-template.tsx` | React component skeleton |
| `component-template.angular.ts` | Angular standalone component skeleton |
| `tailwind-theme-schema.json` | Tailwind theme reference |
| Logo SVGs | Brand assets |
