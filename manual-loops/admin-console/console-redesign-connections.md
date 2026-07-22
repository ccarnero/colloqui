# SPEC — Console redesign: Connections (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-foundation.md` (must be shipped).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-connections'.

## Goal

The Connections section shows the connector inventory as an operational view:
fleet metrics, inventory table with health dots and call-volume sparklines, a
needs-attention panel for failing connections, and a connection detail view
(config summary, recent invocations, error breakdown) per the design contract.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: "Connections" + "Connection detail" sections of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (+ screenshots).
2. Detail keeps the existing routes (`/connections/http/:id`,
   `/connections/mcp/:id`); hosted services keep dialog-based editing.
3. Secrets/credentials are never rendered — masked placeholders only.
   **Health mapping (orchestrator ruling 2026-07-22, applying the human
   precedent signed in the channels loop — real fields only, no invented
   thresholds):** hosted services reuse the existing `statusColor()` semantics
   (active→ok, pending→warn, error→error — all real states); MCP servers map
   `enabled && is_active` → ok, else error; HTTP connectors map
   `status === "enabled"` → ok, else error. NO warn derived from call error
   rates or other thresholds — flagged as backend follow-up, same class as
   the DLQ-derived warn the human rejected in channels decision 3.
4. No new API endpoints; existing connections services are the source.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `features/connections/` — `connections-landing.component.ts`,
  `mcp-servers-page.component.ts`, `mcp-detail/mcp-detail.component.ts`.
- `features/data-integrations/connectors/` — `connectors.component.ts`,
  `detail/connector-detail.component.ts`.
- `features/automation/hosted-services/` — component + `service-dialog`,
  `routes-dialog`.
- Services: `connector-call.service.ts`, `http-adapter.service.ts`,
  `registry.service.ts`; shared dialogs `http-adapter-dialog`,
  `mcp-server-dialog`. Forms/dialogs are REUSED, not rewritten.
- `src/app/shared/components/` — foundation primitives; consume, never fork.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex.
- Only the connections feature folder is touched.

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

- Map the connections feature: components, services, models, existing config
  forms, what invocation/health data exists. Record "**T01 findings
  (recorded <date>):**" in this SPEC; flag missing health/volume data.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-connections.md
```

**T01 findings (recorded 2026-07-22):**

1. **Routes** — all under `/connections/*`, `services/admin-console/src/app/app.routes.ts:65-118`:
   - `connections` (landing) → `connections-landing.component.ts:69-75`.
   - `connections/http` → `connectors.component.ts:79-83` (flat list, internal+external
     collapsed per the code comment at `connectors.component.ts:40-44`).
   - `connections/http/:id` → `connector-detail.component.ts:86-90`.
   - `connections/mcp` → `mcp-servers-page.component.ts:98-102`.
   - `connections/mcp/:id` → `mcp-detail.component.ts:104-109`.
   - `connections/hosted-services` → `hosted-services.component.ts:112-116`.
   - Back-compat redirects: `connectors → connections/http` (`app.routes.ts:120`),
     `hosted-services → connections/hosted-services` (`app.routes.ts:121-125`),
     `data → connections` (`app.routes.ts:126`), plus internal/external-http
     redirects (`app.routes.ts:92-95`).

2. **Components — what each renders today, from which data:**
   - `connections-landing.component.ts:159-205` — KPI row (HTTP/MCP/Hosted counts,
     wired to `ConnectionsMetricsService`), a "Most-used connectors" panel and a
     "Recent activity" panel. Both panels are **hard-coded to empty arrays** —
     `topConnectors = computed<ITopConnector[]>(() => [])` (line 181) and
     `recentActivity = computed<IActivityEntry[]>(() => [])` (line 183) — real
     data was never wired; only the empty-state text renders
     ("Usage analytics coming soon" / "No recent activity").
   - `mcp-servers-page.component.ts:315-593` — Material table of `IMcpServer[]`
     from `AgentAdminService.listMcpServers()` (`agent-admin.service.ts`, called
     at line 583). Columns: name (+ "Synced" badge when `managed_by` is set,
     line 156-168), transport (`transport_type`), url, auth (`auth_type`),
     status (derived `r.enabled && r.is_active` → `active`/`inactive`, line
     190-196), tools (on-demand probe via `listMcpServerTools`, never bulk —
     comment at line 36 and 376-380), actions.
   - `mcp-detail.component.ts:198-322` — Overview summary cards (status, auth,
     transport, tool count, `Calls (Nd)` from `usage.summary.totalCalls`),
     Configuration info-grid (url/transport/auth/status/managed-by — no secrets),
     Tools list (read-only, from live `GET :id/tools`), Recent calls list from
     `AgentAdminService.getMcpServerUsage(id)` (`agent-admin.service.ts`,
     line 312) → `IMcpUsage.recentCalls: IMcpUsageRecentCall[]`.
   - `connectors.component.ts:170-...` — Material table of `IAdapterDto[]` via
     `HttpAdapterService.list()`. Columns: name (+"Synced" badge for
     `managedBy`), tags, scope/context, baseUrl, auth (`adapter.auth.type`
     only — **never** `authConfig`, line 297), status
     (`app-status-badge [status]="r.status"`, line 303, raw `AdapterStatus`
     = `"enabled"|"disabled"`), endpoints count, actions.
   - `connector-detail.component.ts` — Overview info-grid renders `a.authType`
     only (line 75-76); no `authConfig`/headers rendered anywhere in this file
     (confirmed via grep — no `secret`/`password`/`authConfig` render sites).
     Also renders cache configuration and a diagnostics/audit-permission-gated
     section (local `DIAGNOSTICS_PERMISSION` const, line 24, gated via
     `auth.service.ts`'s `AuthService`, line 477-486). The component also
     already has a wired "Recent calls" section: `ConnectorCallService`
     imported (line 14), injected as `private readonly calls =
     inject(ConnectorCallService)` (line 476), fetched via
     `this.calls.recentCalls(id, undefined, 20).subscribe({...})` (line 567)
     into `recentCalls`/`callsLoading` signals (lines 482-483), rendered in a
     template block gated by `canViewCalls()` with loading/empty states
     (lines ~139-160). This is existing, wired UI — not a NO-DATA gap.
   - `hosted-services.component.ts:107-209` — Material table of
     `IRegisteredService[]` from `RegistryService.services` signal. Status
     column uses `app-status-badge [status]="s.status" [color]="statusColor(s.status)"`
     (line 107-112) with `statusColor()` mapping `active→green`,
     `pending→yellow`, `error→red`, else `gray` (line 198-209). `service-dialog`
     and `routes-dialog` are the existing create/edit/route-config dialogs
     (unchanged per decision 2).

3. **Services/models — every status/health/volume-like field:**
   - `http-adapter.service.ts` — `IAdapterDto.status: AdapterStatus` (line 45),
     where `AdapterStatus = "enabled" | "disabled"` (`adapter-status.ts:2`).
     **No health/error-rate/volume field on the adapter DTO itself** — call
     volume must come from `ConnectorCallService`.
   - `connector-call.service.ts` — `IConnectorCall` (line 29-49): `status:
     number` (raw HTTP status code, not health enum), `durationMs: number`,
     `cacheResult: "hit"|"miss"|"bypass"|null`, `timestamp`. Fetched via
     `recentCalls(adapterId, windowMin, limit)` (line 81-98) against
     `GET {apiUrl}/tracking/events` filtered by
     `resource=adapter/{adapterId}` and `type=connector.endpoint_call.completed.v1`
     (lines 10-17). **`endpointId` is always `null`** — not present in the
     tracked-events projection (comment at line 104-107, confirmed in
     `toCall()`). This is the only per-call volume/latency/status source for
     HTTP connectors; there is no pre-aggregated calls-24h/p95/error-rate
     field anywhere — the design's fleet-row `calls`/`p95`/`err` columns would
     require aggregating `IConnectorCall[]` client-side (NO-DATA today, flag
     below).
   - `registry.service.ts` / `registry.model.ts` — `IRegisteredService.status:
     string` (raw string, no enum — `registry.model.ts:11`), no health/volume
     field; `IServiceDetail.knativeStatus?: Record<string, unknown>` (line
     18-20, untyped, optional).
   - `connections-metrics.service.ts` — `httpConnectorsTotal`,
     `mcpServersTotal`, `mcpServersEnabled`, `hostedTotal` (counts only,
     lines 30-52). `httpErrored`/`internalErrored`/`externalErrored` signals
     exist (lines 43-45, 64-72) but `loadCounts()` (line 78-104) **never sets
     `internalErrored`/`externalErrored`** — they stay `null` forever, so
     `httpErrored` always resolves to `null` (never populated). No
     `mcpErrored`/`hostedErrored` signal exists at all.
   - `agent-admin.service.ts` + `agent.model.ts` — `IMcpServer.enabled: boolean`,
     `is_active: boolean` (`agent.model.ts:85-86`, combined by every UI site
     into a binary enabled/disabled — no degraded/warn state modeled).
     `IMcpUsage`/`IMcpUsageRecentCall` (referenced at
     `mcp-detail.component.ts:15-16`) carry `summary.totalCalls`,
     `windowDays`, and per-call `createdAt`, `toolName`, `success: boolean`,
     `durationMs`, `error?`. **`success: boolean` is the only real
     ok/fail signal for MCP calls** — no error-rate percentage or p95 field.

4. **Health mapping ground truth** — design/`Rediseño Terminal.dc.html`,
   "Connections" section (line 1025 comment) and "Connection detail" section
   (line 1191 comment):
   - Fleet-table mock data `CONNECTIONS` (lines 1389-1404): each row has
     `health: "ok" | "warn"` — **only two values appear in the mock data**,
     never `"error"` or `"idle"` despite the shared `HealthStatus` type
     (`status-badge.component.ts:30`) defining all four.
     `errBad: boolean` is a separate flag driving the `err`/`spark` column
     colors, decoupled from `health` (e.g. `billing-api` has `health: "warn"`
     AND `errBad: true`, line 1394; all others have `errBad: false`).
   - Dot-color derivation (`dotColor`, line 1717, inside the `connRows` map at
     lines 1711-1721): `c.health === "warn" ? "var(--yellow)" : "var(--green)"`
     — i.e. the design's actual render logic is **binary** (warn vs.
     everything-else-is-green), even though `health: "ok"` is the only other
     value present in the fixture. No red/idle branch is exercised by this
     mock, matching the screenshot (`04-connections-fleet.png`) which shows
     one yellow dot (`billing-api`) among green dots.
   - Error/spark color (line 1719-1720): `errColor: c.errBad ? "var(--red)" :
     "var(--t3)"`, `sparkColor: c.errBad ? "var(--red)" : "var(--accent)"` —
     driven by `errBad`, **not** by `health`.
   - Screenshot `04-connections-fleet.png` confirms: left sub-nav counts
     (Todas 7 / HTTP 3 / MCP 2 / Hosted services 2), health-strip KPIs
     (Calls·24h, Error rate, Avg p95, "Secrets por rotar"), and green/yellow
     dots per row matching the mock data.
   - Screenshot `05-connection-mcp-detail.png` is mislabeled in the design
     folder — **it shows the MCP-filtered fleet list, not a connection
     detail page**; there is no MCP/HTTP connection-detail screenshot
     provided (flag under Prior-art corrections, item 7).
   - **Proposed mapping from real fields (needs-human-confirmation):**
     - HTTP connectors: no real `health`/`errBad` field exists
       (`IAdapterDto` has only `status: "enabled"|"disabled"`, and no
       aggregated error-rate). A mapping from `IConnectorCall[]`
       (client-aggregated error % over the fetch window) to `warn`/`ok`
       would have to invent the threshold (design uses no visible
       percentage cutoff) — **needs-human-confirmation** for the exact
       threshold, or defer to NO-DATA + `status-badge`'s existing
       `enabled`/`disabled` semantics only.
     - MCP servers: `enabled && is_active` → `ok`-ish / `idle`-ish is
       **UNAMBIGUOUS** for the enabled/disabled axis (same logic already
       used at `mcp-servers-page.component.ts:194` and
       `mcp-detail.component.ts:226-227`), but there is still no source
       field for the design's `warn` (degraded/error-rate) state — a
       real `warn` dot cannot be derived without a call-success-rate
       aggregation over `IMcpUsageRecentCall[].success`, which is
       **needs-human-confirmation** (no threshold specified in the SPEC
       or design).
     - Hosted services: `hosted-services.component.ts`'s existing
       `statusColor()` (`active→green, pending→yellow, error→red`, line
       198-209) is **UNAMBIGUOUS** and already matches the health-dot
       3-state model closely (ok/warn/error), reusable as-is for the
       fleet row's dot.

5. **Credentials/secrets — current storage/rendering, decision 3 compliance:**
   - `IAdapterDto.authConfig: Record<string, unknown>` and
     `IMcpServer.auth_config: Record<string, unknown>` are the config
     payloads (`http-adapter.service.ts:38`, `agent.model.ts:84`); both are
     write-only from the list/detail views examined — `connectors.component.ts`
     only reads `dto.authType`/`adapter.auth.type` (never `.authConfig`) when
     building table/detail rows (lines 91-93, 296-297), and
     `connector-detail.component.ts` only renders `a.authType` (line 75-76).
     `mcp-servers-page.component.ts`/`mcp-detail.component.ts` similarly only
     render `auth_type`, never `auth_config`.
   - The only places `authConfig`/`auth_config` values are handled are the
     REUSED edit dialogs — `http-adapter-dialog.component.ts:385-386,447-448`
     (`apiKey`/`apiKeyHeader` form fields) and
     `mcp-server-dialog.component.ts:302,346` (`token` form field). These are
     form inputs (edit-only), not read-only render sites, and are explicitly
     out of scope for T03 (decision 2: "existing edit forms/dialogs are
     embedded unchanged").
   - **Current behavior already satisfies decision 3** (never rendered,
     masked only) in every list/detail view inventoried — no leak found. The
     design's Connection-detail section explicitly shows a masked-style
     `auth` chip (`kdAuth`, `Rediseño Terminal.dc.html:1218`) plus a
     secret-expiry hint ("secret vence en 12 días") with **no raw secret
     value anywhere** — consistent with decision 3. T03 must not introduce
     any new render path that pulls `authConfig`/`auth_config` field values
     (e.g. accidentally spreading the DTO into a template).

6. **Design element → real data source map:**
   - Fleet health-strip "Calls · 24h" (`Rediseño Terminal.dc.html:1038-1039`)
     → **NO-DATA**: no pre-aggregated 24h call-count exists; would require
     client aggregation of `ConnectorCallService.recentCalls()` (HTTP only)
     — no equivalent aggregation source for MCP/hosted at all.
   - Fleet health-strip "Error rate" (line 1042-1043) → **NO-DATA**: same
     gap; no error-rate field anywhere in the inventoried services.
   - Fleet health-strip "Avg p95" (line 1046-1047) → **NO-DATA**: `durationMs`
     exists per-call (`IConnectorCall.durationMs`,
     `IMcpUsageRecentCall.durationMs`) but no p95 aggregation exists
     server- or client-side.
   - Fleet health-strip "Secrets por rotar" (line 1050-1051) → **NO-DATA**:
     no secret-expiry/rotation field exists on `IAdapterDto`, `IMcpServer`,
     or `IRegisteredService`. Fully invented in the mock.
   - Inventory table `name`/`endpoint`/`auth` columns → **REAL DATA**:
     `IAdapterDto.name/baseUrl/authType`, `IMcpServer.name/url/auth_type`,
     `IRegisteredService.name/image` (hosted has no "endpoint" URL concept —
     partial NO-DATA for hosted's endpoint column).
   - Inventory table `Calls · 24h` + sparkline (line 1065-1068) →
     **NO-DATA** for the pre-aggregated number and the sparkline series;
     `ConnectorCallService`/`getMcpServerUsage` give raw call lists, not a
     time-bucketed series suitable for `SparklineComponent`.
   - Inventory table `p95`/`err` columns (line 1069-1070) → **NO-DATA**
     (same aggregation gap as above).
   - Inventory table `usedBy` column (line 1071) → **NO-DATA**: no
     workflow/agent cross-reference field exists on any of the three DTOs.
   - Inventory table health dot (line 1060, `c.dotColor`) → **PARTIAL**: see
     §4 proposed mapping — hosted services real+unambiguous, HTTP/MCP need
     human confirmation of thresholds, and even then only cover
     enabled/disabled, not a true error-rate-derived warn/error.
   - "Necesita atención" panel (needs-attention, line 1078-1094) →
     **NO-DATA**: every listed item (error-rate breach, secret-expiry,
     unused-connector-30d) requires fields that don't exist
     (error-rate, secret-expiry, last-used timestamp).
   - "Actividad" panel (line 1095-1102) → **NO-DATA**: no activity/audit
     feed wired to Connections; mirrors `connections-landing.component.ts`'s
     already-empty `recentActivity` (see §2).
   - Connection-detail Overview KPIs — Calls·24h/p95/Error
     rate/Circuit-breaker (lines 1205-1210) → **NO-DATA** for all four:
     no circuit-breaker state field exists anywhere in the inventoried
     services; the other three share the aggregation gap above.
   - Connection-detail Configuration `dl` (lines 1213-1221) → **REAL DATA**
     for `endpoint`/`tipo`/`auth`/`timeout`/`retries` (all present on
     `IAdapterDto`); `usedBy` and the "secret vence en 12 días" hint →
     **NO-DATA**.
   - Connection-detail Tools/Endpoints/Runtime list (lines 1223-1234) →
     **REAL DATA**: `IAdapterDto.endpoints[]` for HTTP,
     `IMcpServerTool[]` for MCP (already wired in `mcp-detail.component.ts`).
   - Connection-detail "Llamadas recientes" (recent invocations, lines
     1237-1250) → **REAL DATA, already reusable UI**: for HTTP,
     `connector-detail.component.ts` already imports and wires
     `ConnectorCallService` (import line 14, injected line 476, called at
     line 567 `this.calls.recentCalls(id, undefined, 20).subscribe(...)`)
     into a "Recent calls" template section (lines ~139-160, signals
     `recentCalls`/`callsLoading` at lines 482-483, gated by
     `canViewCalls()`) — T03 restyles this existing section, it does not
     build it. For MCP, `AgentAdminService.getMcpServerUsage()` is already
     wired in `mcp-detail.component.ts`. "Error breakdown" from the task
     description is **NO-DATA**: no grouped/categorized error field exists —
     would need client-side grouping of
     `IConnectorCall.status`/`IMcpUsageRecentCall.error` strings, which is a
     reasonable derivation from real per-call data (not a fabricated field)
     but has no precedent UI and needs a T03 design call.

7. **Prior-art corrections:**
   - The SPEC's Prior-art list (lines 25-36) is accurate for
     `connector-detail.component.ts`: it already imports and wires
     `ConnectorCallService` (line 14 import, line 476 injection, line 567
     `recentCalls()` call) into an existing "Recent calls" template section
     (lines ~139-160) — this is REUSABLE UI already, not just a reusable
     service; T03 restyles it, it does not build it from scratch (see §2, §6).
   - `connections-landing.component.ts`'s "most-used connectors" and "recent
     activity" panels look wired (they call `computed()` and consume a
     service) but are dead code paths returning static empty arrays (§2) —
     flagging so T02/T03 do not assume this landing page already has real
     top-connector or activity data to reuse.
   - Screenshot `05-connection-mcp-detail.png` does not actually depict a
     connection-detail screen (§4) — the SPEC's screenshot list should not be
     read as providing a real MCP/HTTP detail-page visual; only the HTML
     mock's "Connection detail" section (`Rediseño Terminal.dc.html:1191-1252`)
     is authoritative for that screen.

### T02 — Inventory list view

- Rebuild the list: fleet MetricCard row, InventoryTable (health dot,
  sparkline, type, status), NeedsAttentionPanel of failing connections.
- Unit tests: mapping to table rows, empty state, row click navigates to the
  detail route.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Detail views restyle

- Restyle `connector-detail` and `mcp-detail` routed views per decision 2:
  config summary (secrets masked per decision 3), recent invocations, error
  breakdown; the EXISTING edit forms/dialogs are embedded unchanged.
- Unit tests: secrets never appear in DOM; form reuse (no duplicated form
  component).

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Docs + index

- Update `services/admin-console/README.md`, add entry to `cowork/INDEX.md`, log
  decisions to Engram topic 'admin-console/redesign-connections'.

**Accept**
```
grep -n "console-redesign-connections" cowork/INDEX.md
```

---

- [x] T01 inventory report
- [x] T02 inventory list view
- [x] T03 detail views
- [x] T04 docs + index

## Out of scope (explicit)

- New connector types or config schema changes — front-only restyle.
- Backend/API changes.
- Credential rotation/testing features — existing behavior only.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Deviating from the binding visual contract requires human sign-off.
- Any change to how credentials are displayed/masked requires human sign-off.
