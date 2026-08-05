# MCP Connections — Screen-by-Screen Parity with Connectors — Design

Class: descriptive
Summary: MCP servers as first-class citizens alongside HTTP connectors — the original design plus an as-implemented delta recording what shipped and what is still a gap.

Status: Implemented (commit c4da71a). See "As-implemented delta (2026-07-07)"
below for what shipped, what's still a known gap, and how the §0 baseline
below has changed. The rest of this document is kept as the original design
record.

Decision: MCP Servers must become a **first-class citizen equivalent to HTTP
Connectors**, measured concretely — for every screen and action a user has
today for a Connector, the equivalent must exist for an MCP Server, in both
the Connections area and the Workflow builder. This document is organized
**by screen**, not by backend layer, because that's the actual product ask:
"que sea igual que los conectores, funcionalmente, desde lo que se ve en la
UI." Backend work is derived from what each screen needs, not the other way
around.

This document is file-anchored so an implementer (e.g. an Opus delegation)
can execute it without re-deriving decisions or re-exploring the codebase.

---

## As-implemented delta (2026-07-07)

Implemented in commit `c4da71a` (~99 files). All phases in §7 shipped:
entity parity (auth, managed/sync, `:id/tools`), list/landing/dialog, usage
logging + detail page, per-tool granularity, and the `mcpCall` workflow
action. The `## 0.2` baseline below is now historical — see the corrected
summary in "0.2 MCP Servers" further down, which has been rewritten in
place to describe the shipped state.

Known gaps against the original design (closed 2026-07-08 unless noted):

- **SDK `getUsage(id)` — closed.** `sdk/src/resources/mcp-servers/client.ts`
  now ships `getUsage(id, params?)`, calling
  `GET admin/mcp-servers/:id/usage` (optional `window` day-count query
  param), typed via `McpServerUsage`/`McpServerUsageParams` in `types.ts`
  and exported from the resource's `index.ts` barrel.
- **Delete confirm-dialog — closed.** The MCP list
  (`mcp-servers-page.component.ts`) now opens the shared
  `ConfirmDialogComponent` (`shared/components/confirm-dialog/`) before
  deleting a non-managed server, the same pattern
  `schedules.component.ts` uses (danger variant, "Delete"/"Cancel"
  actions). Managed-row deletes are unchanged — still blocked up front
  with the structured-409 explanation banner, no dialog needed since the
  action never reaches the backend.
- **SDK `structuredKb.uploadFile()` — added 2026-07-08.**
  `sdk/src/resources/structured-kb/client.ts` now ships
  `containers.uploadFile(containerId, input)`, calling
  `POST admin/structured-kb/containers/:id/files` (camelCase
  `fileBase64`/`sheetName` mapped to the DTO's `file_base64`/`sheet_name`).
  Resolves once the file row is created and the ingestion event is
  published (`202 Accepted`), not once ingestion completes.
- **SSRF `scope` opt-in — added 2026-07-08.** `IMcpServer` (and the
  Postgres/Mongo schema, `providers/schema-initializer.ts`) now carry a
  `scope: "external" | "internal"` field, default `"external"`. `"internal"`
  is an explicit admin opt-in that relaxes the SSRF guard's
  localhost/RFC1918 checks (used by `mcp-tools-probe.service.ts`,
  `connector-runtime`'s `mcp-call.activity.ts`, and `agent-ai-service`'s
  `mcp-client.service.ts` — the last of which previously had no SSRF guard
  at all and now has one) — cloud-metadata and link-local targets stay
  blocked regardless of scope. Setting `scope: "internal"` on create/update
  is gated behind `MCP_INTERNAL_SCOPE_ENABLED=true` on
  `agent-admin-service`; otherwise the request is rejected with a 400.
  `CreateMcpServerDto`/`UpdateMcpServerDto` validate `scope` via
  `IsIn(["external","internal"])`. The admin-console MCP server dialog
  exposes this as a "Scope" select (External / Internal (in-cluster)),
  defaulting to External.
- **§8 open questions — resolved by implementation:**
  - `@ai-sdk/mcp` probe granularity: the test endpoint
    (`POST admin/mcp-servers/:id/test`) does a full connect, matching the
    original "build once" approach — no separate lightweight probe was
    added.
  - `PUT` → `PATCH`: confirmed and changed; the controller now uses
    `PATCH :id`.
  - No pre-existing shared `AuthConfigDto` was found; MCP's auth config
    validation was implemented directly in `mcp-servers.dto.ts`.
  - Confirm-dialog pattern: resolved — `schedules.component.ts`'s
    `ConfirmDialogComponent` usage was reused verbatim (see gap above).
  - Usage-logging table: implemented as a **single shared table**
    (`mcp_call_events`, Postgres) with **no `source` discriminator
    column** — agent-side and workflow-side calls are not distinguished
    at the schema level.

---

## 0. As-built baseline (verified 2026-07-06 — historical, see delta above)

### 0.1 Connectors (HTTP Adapters) — the parity target, screen by screen

- **Landing** (`admin-console/src/app/features/connections/connections-landing.component.ts`)
  — KPI card with live count + error sub-text.
- **List** (`features/data-integrations/connectors/connectors.component.ts`,
  route `/connections/http`) — Material table, tag-filter chip bar, columns
  Name/Tags/Scope/BaseURL/Auth/Status/Endpoints/Actions, "Synced" badge +
  lock icon for `managed_by` rows, row actions View/Edit/Delete (Delete
  blocked with a structured-409 explanation banner for managed rows).
- **Detail** (`detail/connector-detail.component.ts`, route
  `/connections/http/:id`) — Overview (status/auth/scope/endpoint-count/cache-hits
  cards), Configuration (base URL, auth type, context, timeout, retries,
  managed-by), Endpoints (per-endpoint card, method/path/label/cache tag),
  Cache configuration, **Recent calls** (last hour, up to 20, expandable
  request/response/cache detail, trace link) — gated by `diagnostics:read`
  permission.
- **Create/Edit dialog** (`shared/components/http-adapter-dialog/`) — real
  `MatDialog`, sections: General (scope/name/baseUrl), Tags (chip input),
  **Authentication** (`adapter-auth-config.component.ts` — typed dropdown:
  none/api-key/bearer/basic/oauth2, dedicated masked fields per type), Custom
  Headers (key/value row list), Default Cache (expansion panel:
  enable/TTL/methods/key-headers/key-query-params), Endpoints
  (`adapter-endpoint-config.component.ts` — add/remove endpoint cards, each
  with its own nested cache sub-form), Reliability (timeout/retries/backoff),
  Health Check (path). No test-connection button exists today (gap shared by
  both connector kinds — out of scope to retrofit onto adapters here, but the
  MCP test endpoint built in this plan should be written so it *could* be
  reused for adapters later without rework).
- **Managed/sync**: `adapters.service.ts` — `managed_by` column,
  `REGISTRY_OWNED_FIELD_KEYS` lock `name`/`baseUrl`/`healthCheckPath`/`status`;
  edits/deletes to locked fields rejected with a structured 409
  (`IManagedAdapterConflict`) naming exactly which fields are locked.
- **Agent editor tool form** — Connector is reachable only via the generic
  "Tools" nav item → "+" → a 3-way source toggle labeled **"HTTP Endpoint" /
  "Adapter" / "Built-in"** (`agent-editor-tool-form.component.ts`), then
  `tool-adapter-form.component.ts`'s Adapter/Endpoint dropdowns + a "Resolved
  Configuration" preview. The literal word "Connector" never appears in this
  form — it says "Adapter", inconsistent with the rest of the app.
- **Workflow builder** (`features/automation/workflows/builder/`) — an
  `endpointCall` node type; its config panel
  (`workflow-node-config.component.ts`) lets the user pick an Adapter from a
  dropdown, then a dependent Endpoint dropdown, writing `adapterId`/
  `endpointId` into `EndpointCallArgs` (`packages/shared/src/workflow.interfaces.ts`).
  Executed as a Temporal activity on the `connector-runtime` task queue
  (`endpoint-call.activity.ts`), independent of `agent-ai-service`.

### 0.2 MCP Servers — as implemented (2026-07-07, supersedes the 2026-07-06 baseline below)

> The bullets below described the pre-implementation gap and are kept for
> historical context; each has been corrected to reflect the shipped state.

- **Landing** — live count call, no longer hardcoded (reuses the existing
  list endpoint, per §6.1).
- **List** (`features/connections/mcp-servers-page.component.ts`, route
  `/connections/mcp`) — Material table (`mat-table`), row actions
  View/Edit/Delete, "Synced" badge + lock icon for `managed_by` rows,
  structured-409 explanation banner for managed-row deletes. Non-managed
  deletes now open the shared `ConfirmDialogComponent` before calling the
  delete endpoint (closed 2026-07-08, see delta above).
- **Detail** (`features/connections/mcp-detail/mcp-detail.component.ts`,
  route `/connections/mcp/:id`) — Overview/Configuration/Tools/Recent calls
  sections, mirroring the connector detail page.
- **Create/Edit dialog** (`shared/components/mcp-server-dialog/`) — real
  `MatDialog`, with `mcp-auth-config.component.ts` (typed auth dropdown:
  none/api-key/bearer/basic) and `mcp-headers-config.component.ts`
  (structured key/value rows, no more raw JSON textarea), plus a Test
  Connection button (`POST admin/mcp-servers/:id/test`). Still no
  cache/endpoints section, by design (non-goal, §0.4).
- **Managed/sync** — implemented: `managed_by` + locked-field conflict
  semantics ported from the adapter side.
- **Agent editor** — per-tool enable/description-override shipped
  (`enabled_mcp_tools`, `tool_description_overrides` namespaced
  `<serverName>__<toolName>` keys — double underscore; changed from
  `<serverName>:<toolName>` by agent-mcp-tool-naming.md T01, colon violated
  OpenAI's tool-name pattern), gated by flag
  `AGENT_MCP_TOOL_FILTERING_ENABLED`.
- **Workflow builder** — `mcpCall` node type shipped
  (`services/connector-runtime/src/activities/mcp-call.activity.ts`,
  `packages/shared/src/workflow.interfaces.ts` `McpCallAction`), dispatched
  on the same `connector-runtime` task queue as `endpointCall`/`serviceCall`.

### 0.3 Backend internals relevant to closing these gaps

- `services/agent-admin-service/src/modules/mcp-servers/` — `IMcpServer`,
  DTOs, controller (`admin/mcp-servers`, note: uses `PUT` not `PATCH` —
  inconsistent with the rest of the admin API), service, dual Mongo/Postgres
  repos.
- `services/agent-ai-service/src/modules/tools/`:
  - `mcp-client.service.ts` / `mcp-connection.service.ts` — wraps
    `@ai-sdk/mcp`, per-tenant lazy connect, `Map<name, MCPClient>`.
  - `tool-definition.ts` — `ToolDef` (name/description/inputSchema/
    adapterRef?/builtin?). **MCP tools are not `ToolDef` instances** — they
    come pre-shaped from the MCP client's own `.tools()` call.
  - `tool-bridge.service.ts` — `mergeMcpTools()` merges MCP tools into the
    agent's tool map by connected-server name, filtered only by
    `agent.enabled_mcp_servers` (server-level), no per-tool filter.
  - `adapter-executor.service.ts` — reference implementation for a live
    connectivity probe pattern (timeout, structured error, no persistence
    side-effect, SSRF guard) — reuse this shape for the MCP test endpoint.
- `services/connector-admin/src/modules/adapters/adapter-usage.postgres.repository.ts`
  — the reference implementation for **call-usage logging** (per-adapter
  call counts/error rates/latency), needed as a pattern for MCP's "Recent
  calls" detail-page section (§3), since no equivalent exists for MCP calls
  today anywhere (not in `agent-ai-service`, not in `mcp-connection.service.ts`).
- `services/workflow-service` + `packages/shared/src/workflow.interfaces.ts`
  — `WorkflowAction` discriminated union
  (`EndpointCallAction | JsFunctionAction | ServiceBusCallAction | ServiceCallAction | ChannelSendAction | AgentCallAction | BranchAction | ConditionalAction`),
  dispatched as Temporal activities to `connector-runtime`'s task queue.
- `services/connector-runtime/src/activities/endpoint-call.activity.ts` —
  reference implementation for a new `mcp-call.activity.ts`.
- `sdk/src/resources/mcp-servers/` — existing SDK resource, thinner than
  `sdk/src/resources/agents/` needs it to be once auth/test/tools/managed
  land; no `sdk/src/resources/workflows` support for an `mcpCall` action yet.

### 0.4 Explicit non-goals

- OAuth2 auth type for MCP servers (heavier, distinct consent/token flow —
  ship none/api-key/bearer/basic now, revisit OAuth2 separately for both
  connector kinds).
- `stdio` transport (local-process MCP servers don't fit this multi-tenant
  cloud deployment model).
- Cache-strategy UI for MCP servers — Connector caching exists because HTTP
  GETs are naturally cacheable/idempotent by convention; MCP tool calls have
  no equivalent convention (a tool may or may not be idempotent, and MCP
  doesn't standardize this), so no cache section is being ported. If this
  turns out to be wanted later, it's a separate, smaller follow-up once
  real MCP call telemetry (§3) shows whether it'd help.
- A real internal-registry auto-discovery producer for MCP's managed/sync
  fields — this plan ships the mechanism (schema + locked-field conflict
  semantics) but no actual sync job, mirroring how the adapter side works
  today (registry-service is the one real producer that exists; nothing
  analogous exists for MCP and building one is out of scope).
- Retrofitting a test-connection button onto the *Connector* dialog (called
  out in §0.1) — flagged as a natural follow-up, not part of this delegation.

---

## 1. Screen-by-screen target (what "equal to Connectors" means, concretely)

| # | Screen | Connector today | MCP target | New backend needed |
|---|---|---|---|---|
| 1 | Connections landing KPI | live count + errors | live count (configured / enabled) | none — reuse existing list endpoint |
| 2 | MCP list | — | table (not cards), tag-style filter (by transport type / enabled), "Synced" badge for managed rows, View/Edit/Delete row actions | managed/sync fields (§2.3) |
| 3 | MCP detail (new page) | Overview/Config/Endpoints/Cache/Recent calls | Overview/Config/**Tools** (equivalent of Endpoints — lists what the server exposes)/**Recent calls** (equivalent of adapter usage) | `GET :id/tools`, MCP call usage logging (§3) |
| 4 | MCP create/edit dialog | MatDialog, typed Auth, structured headers, endpoints, cache, reliability | MatDialog, typed Auth (none/api-key/bearer/basic), structured header rows (no more raw JSON textarea), **Test Connection** button; no cache/endpoints section (non-goal) | auth fields + test endpoint (§2.1, §2.2) |
| 5 | Agent editor — MCP selector | n/a (adapters don't have a per-agent picker; they're added directly as Tools) | keep whole-server toggle, add expandable **per-tool** checkbox list + per-tool description override | `enabled_mcp_tools`, `ToolDef` wrapping (§4) |
| 6 | Agent editor — Tools form label | says "Adapter" | rename to "Connector" for naming consistency (small, standalone fix) | none |
| 7 | Workflow builder | `endpointCall` node, Adapter+Endpoint dropdowns | new `mcpCall` node, MCP Server + Tool dropdowns, same visual weight as `endpointCall` in the palette | `McpCallAction` type, `mcp-call.activity.ts` (§5) |

---

## 2. Backend: entity parity (powers screens #2, #3, #4)

### 2.1 Auth — `services/agent-admin-service/src/modules/mcp-servers/`

Add to `IMcpServer` + Postgres/Mongo schema (check
`providers/schema-initializer.ts` for the `mcp_servers` DDL):

```
auth_type: "none" | "api-key" | "bearer" | "basic"   // default "none"
auth_config: Record<string, unknown> | null           // shape per auth_type
```

`CreateMcpServerDto`/`UpdateMcpServerDto` — add `authType`
(`IsIn(["none","api-key","bearer","basic"])`) + `authConfig`. Check
`packages/shared` first for a common `AuthConfigDto` before duplicating
`adapters.dto.ts`'s validation shape.

Fix `PUT /:id` → `PATCH /:id` while touching this controller (confirm no
external SDK consumer depends on `PUT` first — grep SDK changelog/tests).

### 2.2 Test connection endpoint

New: `POST admin/mcp-servers/:id/test` (+ gateway proxy, same passthrough
pattern as `admin-mcp-servers.controller.ts`).

- `transport_type: "http"` — single request with auth applied, short timeout
  (~5s); reuse (or build once, shared with §4) an auth-header-injection
  helper.
- `transport_type: "sse"` — open handshake, confirm it opens, disconnect
  immediately.
- Response: `{ success, latencyMs, toolCount?, error? }`. No persistence
  side-effect — `is_active` stays an explicit admin toggle, not derived from
  the last test result.

### 2.3 Managed/sync fields

Add `managed_by: string | null` and `managed_locked_fields: string[] | null`
to `IMcpServer`. Port `REGISTRY_OWNED_FIELD_KEYS` / `IManagedAdapterConflict`
from `adapters.service.ts` verbatim into `mcp-servers.service.ts`, locking
`name`/`url`/`transport_type` (headers/auth stay editable even for managed
servers — credentials shouldn't be registry-sourced). No sync producer job
in this plan (§0.4).

### 2.4 `GET admin/mcp-servers/:id/tools`

New endpoint — connects transiently (or reuses a live per-tenant connection
if `mcp-connection.service.ts` already has one) and returns
`{ name, description, inputSchema }[]`. This single endpoint powers **three**
screens: MCP detail's "Tools" section (#3), the agent editor's per-tool
picker (#5), and the workflow builder's Tool dropdown (#7) — build it once,
reuse everywhere.

---

## 3. Backend: MCP call usage logging (powers screen #3's "Recent calls")

No equivalent exists today anywhere for MCP tool calls (adapters have
`adapter-usage.postgres.repository.ts`; MCP has nothing). Add:

- A logging hook at the point MCP tools actually execute — this is inside
  the AI SDK's own `Tool.execute` for tools merged in `tool-bridge.service.ts`'s
  `mergeMcpTools()` (agent side, §4) — wrap each merged tool's `execute` to
  record `{ tenantId, mcpServerId, toolName, success, durationMs, error? }`,
  mirroring the shape `adapter-usage.postgres.repository.ts` already stores
  for adapters.
- Once §5 exists, the workflow-side `mcp-call.activity.ts` must log the same
  shape from its own execution path (two producers, one usage table/schema —
  reuse the adapter-usage table's column shape, don't invent a second one).
- New endpoint `GET admin/mcp-servers/:id/usage` (mirrors
  `GET /connectors/usage`) for the detail page's Overview cards and "Recent
  calls" list.

This is a prerequisite for screen #3 to show anything real — without it,
"Recent calls" would ship empty, same failure mode as the currently-stubbed
landing KPI. Don't ship the detail page ahead of this.

---

## 4. Backend + frontend: per-tool granularity (powers screen #5)

1. **Wrap MCP tools in `ToolDef`.** In `tool-bridge.service.ts`'s
   `mergeMcpTools()`, map each MCP tool into a `ToolDef`-compatible shape:
   `name` becomes `"<serverName>__<toolName>"` (namespaced — stable,
   addressable key for filtering/overrides; double underscore, sanitized to
   `^[a-zA-Z0-9_-]+$` via `sanitizeMcpToolKey` — was a colon before
   agent-mcp-tool-naming.md T01, which violated OpenAI's tool-name pattern),
   a new `ToolDef.mcpRef: {serverName, toolName}` variant parallel to
   `adapterRef`. Keep executing via the AI SDK's own `Tool.execute` — the
   wrapping is for addressability and filtering, not for rerouting
   execution through `tool-executor.service.ts`.
2. **`enabled_mcp_tools` on `IAgent`**:
   `Record<string /* serverName */, string[] | null>` — `null` for a server
   means "all tools enabled" (today's default, backward compatible).
3. **Extend `tool_description_overrides`** to accept
   `"<serverName>__<toolName>"` keys (already `Record<string,string>`, no
   schema change, just a documented key-format extension).
4. **Apply both filters in `mergeMcpTools()`** after building the namespaced
   list, before merging into the final tool map — same place
   `toAiSdkToolsForAgent` already applies filters for adapter/builtin tools.
5. **`PATCH admin/agents/:id/mcp-tools`** — mirrors existing
   `PATCH :id/mcp-servers` / `PATCH :id/tools`.
6. **Frontend**: extend `mcp-servers-selector.component.ts` (or add a
   sibling) into an expandable tree — server-level checkbox (existing,
   `enabled_mcp_servers`) expands to a per-tool checkbox list fetched from
   §2.4's `GET :id/tools`, mapping to `enabled_mcp_tools`, with an inline
   description-override text field per tool (reuse whatever component
   already edits `tool_description_overrides` for adapter/builtin tools —
   check `agent-editor-tool-form.component.ts`).

---

## 5. Workflows: `mcpCall` action (powers screen #7)

This is the piece the user flagged as mandatory, not optional — Workflows
must be able to connect to an MCP server exactly like they connect to a
Connector today.

### 5.1 Shared types — `packages/shared/src/workflow.interfaces.ts`

```ts
export interface McpCallArgs {
  serverId: string;
  toolName: string;
  params?: Record<string, unknown>;
}

export interface McpCallAction {
  activity: "mcpCall";
  name: string;
  args: McpCallArgs;
}
```

Add `McpCallAction` to the `WorkflowAction` union (alongside
`EndpointCallAction`, etc.).

### 5.2 Execution — `services/connector-runtime`

New `src/activities/mcp-call.activity.ts`, same shape as
`endpoint-call.activity.ts`: resolves the MCP server config from
`agent-admin-service` (`GET admin/mcp-servers/:id`, same cross-service call
pattern `endpoint-call.activity.ts` uses against `connector-admin`), applies
auth (§2.1's helper), opens an MCP connection via `@ai-sdk/mcp` scoped to
this single activity execution (ephemeral — connector-runtime is not a
long-lived per-tenant process the way `agent-ai-service` is, so there's no
persistent connection pool to reuse here; confirm connect/disconnect cost is
acceptable for a per-workflow-step call, same open question as §2.2's test
endpoint), calls the named tool, returns the result, logs usage (§3).
Registered on the same `CONNECTOR_RUNTIME_TASK_QUEUE`, same retry policy as
`endpoint-call.activity.ts` (5 attempts, 1s→30s backoff).

### 5.3 Frontend — workflow builder

- `features/automation/workflows/domain/workflow-node-types.ts` — add
  `mcpCall` to `EWorkflowNodeType`, same visual tier as `endpointCall` in
  `workflow-palette`.
- `workflow-node-config.component.ts` — new config branch for `mcpCall`:
  MCP Server dropdown (reuse `AdaptersService`-equivalent list call against
  `agent-admin.service.ts`'s MCP methods), dependent Tool dropdown sourced
  from §2.4's `GET :id/tools` (same two-dropdown UX as adapter/endpoint —
  don't invent a different interaction pattern), writing `serverId`/
  `toolName` into `node.configuration`, mirroring exactly how
  `adapterId`/`endpointId` are written today for `endpointCall`.

### 5.4 SDK

- New `sdk/src/resources/workflows/` support for the `mcpCall` action type
  in whatever type already represents `WorkflowAction` there.
- `sdk/src/resources/mcp-servers/client.ts` — add `testConnection(id)`,
  `listTools(id)`, `getUsage(id)`, matching auth fields in `types.ts`,
  following this SDK module's existing header-comment convention
  (documents verified backend behavior/quirks).

---

## 6. Frontend: remaining screen work (#1, #2, #4, #6)

### 6.1 Landing KPI (#1)

`connections-landing.component.ts` — replace the hardcoded `"—"` with a real
call: total configured + total enabled (from the existing list endpoint,
no live-testing all servers on page load — do not wire this to §2.2's test
endpoint in bulk, that's a stampede risk).

### 6.2 MCP list → table (#2)

`mcp-servers-page.component.ts` — replace the card grid with a Material
table matching `connectors.component.ts`'s column structure where
applicable (Name, Transport, URL, Auth type, Status, Tools count via §2.4,
Actions), add a filter (by transport type and/or enabled state — MCP
doesn't have tags, so the exact filter axis should mirror whatever's most
useful once real data exists, not force a tag concept that doesn't apply),
add the "Synced" badge for `managed_by` rows (§2.3), replace the native
`confirm()` delete with whatever confirm pattern the rest of the app uses
(check if `connectors.component.ts`'s no-confirm-at-all is actually the
house style, or if there's a shared confirm-dialog component elsewhere to
adopt instead — don't just copy connectors' weaker pattern by default).

### 6.3 MCP detail page (new) (#3, backend depends on §2.4 + §3)

New route `/connections/mcp/:id`, new component mirroring
`connector-detail.component.ts`'s structure: Overview cards
(status/auth/transport/tool-count/call-count), Configuration (url,
transport, auth type, managed-by if applicable), **Tools** section (list
from §2.4, name+description+schema summary per tool — this is the direct
analog of Connector's Endpoints section), **Recent calls** section (from
§3's usage endpoint, same expandable request/response-ish detail where MCP's
protocol allows it — tool name, params, result, duration, success/error).

### 6.4 MCP create/edit dialog (#4)

Replace the hand-rolled `.modal-backdrop` in `mcp-servers-page.component.ts`
with a real `MatDialog` component (new file, e.g.
`shared/components/mcp-server-dialog/mcp-server-dialog.component.ts`):
- New `mcp-auth-config.component.ts` sibling to `adapter-auth-config.component.ts`,
  same per-type dynamic fields, scoped to none/api-key/bearer/basic.
- Structured key/value headers editor (replaces the raw JSON textarea),
  same list-editor UX class as `adapter-endpoint-config.component.ts`.
- **No Tools/Endpoints section in this dialog, by design.** Unlike Connector
  endpoints (manually defined by the admin via "+ Add"), MCP tools are
  **discovered live from the server's own `tools/list`** (§2.4) — there is no
  "+ Add Tool" affordance anywhere in the product. Tools are only ever
  *viewed* (detail page, §6.3) or *selected* (agent picker §4, workflow node
  §5.3), never *defined*.
- "Test Connection" button wired to §2.2, shown inline result
  (success/latency or error).
- Managed/locked-field display (§2.3) matching `connectors.component.ts`'s
  badge + banner + disabled-fields pattern for `managed_by` rows.

### 6.5 Tool form label fix (#6)

`agent-editor-tool-form.component.ts` + `tool-adapter-form.component.ts` —
rename the "Adapter" label/toggle button to "Connector" throughout, so the
UI's naming matches the feature's name everywhere else in the app
(`/connections/http` is called "Connectors", this form should say the same
thing). Standalone, no dependencies, safe to ship anytime.

---

## 7. Phased delegation (each phase independently mergeable)

Ordered by dependency, not by arbitrary sequence — each phase ships one or
more complete screens, never half a screen:

1. **Phase 1 — Entity foundations**: §2.1 (auth), §2.3 (managed/sync), §2.4
   (`GET :id/tools`). No UI yet. Enables everything downstream.
2. **Phase 2 — List + landing + dialog** (screens #1, #2, #4): §6.1, §6.2,
   §6.4, §2.2 (test endpoint). Ships a fully parity-equivalent MCP
   configuration experience.
3. **Phase 3 — Usage logging + detail page** (screen #3): §3, §6.3. Depends
   on Phase 1's `:id/tools` endpoint and needs its own usage-logging hook
   landed first so the page isn't shipped empty.
4. **Phase 4 — Per-tool granularity** (screen #5): §4 in full. The largest,
   riskiest phase — touches the hot tool-resolution path in
   `tool-bridge.service.ts`. Land last among the Connections-side work;
   consider a feature flag around the new filtering logic in
   `mergeMcpTools()`.
5. **Phase 5 — Workflow integration** (screen #7): §5 in full
   (`McpCallAction`, `mcp-call.activity.ts`, builder node, SDK). Independent
   of Phase 4 — only depends on Phase 1's entity/auth work and Phase 3's
   usage-logging pattern (for its own logging). Can run in parallel with
   Phase 4.
6. **Phase 6 — Naming polish** (#6): §6.5. Trivial, no dependencies, ride
   with any other phase or ship standalone.

Suggested delegation order for Opus: 1 → 2 → 3 → {4, 5 in parallel} → 6, as
separate/chained PRs per the `chained-pr` skill conventions already used in
this repo — Phase 4 and Phase 5 touch entirely disjoint code (agent-ai-service
vs connector-runtime) so they're safe to parallelize once Phase 1-3 land.

---

## 8. Open questions to resolve before/during implementation

- Does `@ai-sdk/mcp`'s client expose a lightweight "probe" (connect + no-op)
  distinct from a full `connect()` + `getTools()`? Affects both §2.2's test
  endpoint and §5.2's per-workflow-step ephemeral connection cost.
- Confirm no external SDK consumer depends on `PUT /admin/mcp-servers/:id`
  before changing it to `PATCH` in §2.1.
- Confirm no shared `AuthConfigDto` already exists in `packages/shared`
  before duplicating adapters' auth-config validation shape for MCP (§2.1).
- What confirm-dialog pattern does the rest of admin-console actually use
  for destructive actions, if any is more standard than both
  connectors' (no confirm) and MCP's current (native browser `confirm()`)
  approaches? (§6.2)
- Is a single shared usage-logging table sensible for both agent-side and
  workflow-side MCP calls (§3), or does the schema need a
  `source: "agent" | "workflow"` discriminator column from day one?
