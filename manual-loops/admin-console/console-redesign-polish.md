# SPEC — Console redesign: visual parity polish (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: ALL of L0–L7 (`console-redesign-foundation.md` through
> `console-redesign-users-analytics-settings.md`) — shipped 2026-07-21/23.
> Origin: human review 2026-07-23 — the shipped screens use the new tokens but
> several fall visually short of the binding mocks; the worst offender is the
> workflow builder (`/workflows/:id/builder` still renders inside the legacy
> detail wrapper; palette and node cards keep the old layout).
> Engram topic: 'admin-console/redesign-polish'.

## Goal

Every console screen matches its binding mock at the LAYOUT level — same
chrome, same panel composition, same affordance placement — not just the same
tokens. "Matches" means a reviewer comparing a live screenshot against the
mock finds no structural difference that is not a signed data-gap exclusion.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: `manual-loops/admin-console/design/Rediseño Terminal.dc.html`
   plus screenshots `01`–`19` in `manual-loops/admin-console/design/`. Pixel
   values come from there — never invented.
2. **SIGNED 2026-07-23:** `features/automation/workflows/detail/` is now IN
   SCOPE for the builder full-bleed (the L5 out-of-scope boundary is lifted
   for exactly this: suppressing the detail wrapper chrome when the Builder
   tab is active and moving its navigation into the mock's floating
   segmented control).
3. Standing precedents remain binding: real data only; design elements with
   no data source stay EXCLUDED (they are catalogued per loop in
   `cowork/INDEX.md` — do not re-litigate them); no new capabilities. If a
   mock element implies a new capability (e.g. the topbar `Search… ⌘K` box,
   the builder `Publish` action if no publish API exists), it is a FINDING
   for human sign-off, not something to build.
4. All L0–L7 behavior contracts stay frozen: routes, save paths, selection
   services, permission gates, byte-compatible workflow saves.
5. **SIGNED 2026-07-23 (post-T01):**
   (a) NO new capabilities in this loop — every NEW-CAPABILITY finding from
   T01 item 14 stays unbuilt, catalogued in the INDEX as backlog.
   (b) T05: `/connections/mcp` is UNIFIED into the fleet — the route renders
   the existing unified fleet table pre-filtered to MCP with the mock's
   filter-chips; the legacy MCP page retires (same URL, same data sources).
   (c) T06: the AI agent editor is REBUILT to the mock's single scrolling
   column (07/08) — the 3-pane workstation layout is replaced; the test
   panel remains reachable per mock 09's composition. Save paths, mention
   decorations, and the invoke wiring stay frozen (behavior contracts,
   decision 4).
   (d) T04 scope now includes the `/workflows` list (mock 10) parity.

## Prior art (REUSE, do not duplicate)

- Everything shipped in L0–L7 (see `cowork/INDEX.md` entries and
  `services/admin-console/README.md` composition sections). Primitives are
  extended only when a task explicitly says so.
- The Playwright login+screenshot harness used for live validation during
  L1–L7 (session scratchpad `dashboard-shot.mjs`) — T01 promotes it into the
  repo as `services/admin-console/scripts/visual-audit.mjs`.
- Cluster dev credentials for the harness come from the k8s secret:
  `kubectl get secret auth-secret -n platform-services-dev -o jsonpath='{.data.ADMIN_EMAIL}' | base64 -d`
  (same for `ADMIN_PASSWORD`) — never hard-coded.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex or named colors in component SCSS.
- No behavior changes: presentation-layer only unless the task text says
  otherwise (T02's wrapper suppression is presentation).
- No literal backticks inside template/styles template literals (repo lint
  hook corrupts the file); targeted Edits over full-file rewrites.
- Angular gotchas (empirically proven in L2–L7): `TestBed.overrideProvider`
  for MatDialog; view encapsulation blocks cross-component CSS reuse.

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

Gate rules: identical to `console-redesign-foundation.md`. Additionally,
tasks T02–T08 end with a VISUAL CHECK: the implementer (or orchestrator)
captures the affected screen(s) with `scripts/visual-audit.mjs` against a
local `ng serve`, and the reviewers receive the screenshot path(s) alongside
the diff. A screenshot that still shows the audited delta is a rejection.

---

## Task queue

### T01 — Visual parity audit + harness (tooling + findings)

- Promote the session's Playwright harness into
  `services/admin-console/scripts/visual-audit.mjs`: logs in with
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` env vars, accepts `BASE_URL`, a list of
  `TARGET_PATH`s, `OUT_DIR`; writes one PNG per path plus a DOM-marker JSON
  (`data-theme`, primitive counts). Reuses `playwright-core` from the
  workspace (absolute-path import is acceptable; document it).
- Run it against a local `ng serve` for EVERY screen with a mock:
  `/dashboard`, `/analytics`, `/channels/telegram`,
  `/channels/telegram/accounts/:id` (any real account), `/connections`,
  `/connections/http/:id`, `/connections/mcp/:id`, `/ai/agents`,
  `/ai/agents/:id/configure` (editor + test panel), `/workflows`,
  `/workflows/:id/builder`, `/processes/trace/:correlationId` (all four
  tabs), `/users`, `/settings`.
- Record "**T01 findings (recorded <date>):**" in this SPEC: one numbered
  entry PER SCREEN listing every LAYOUT-level delta vs its mock
  (chrome/composition/placement — not px-perfect colorimetry), each marked
  FIX (in scope) / DATA-GAP (already excluded, cite the INDEX entry) /
  NEW-CAPABILITY (needs human sign-off, e.g. topbar search, Publish).
  The screenshots are committed under
  `manual-loops/admin-console/audit/before/`.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-polish.md && ls services/admin-console/scripts/visual-audit.mjs
```

**T01 findings (recorded 2026-07-23):**

Live session context for this audit: no MCP servers configured (`connections-mcp.png`
is the empty-state), no AI agents configured (`ai-agents.png` is the empty-state,
`ai-agents-new.png` is the blank `/ai/agents/new` create flow, not an edit of an
existing agent), and the trace screenshot captured only the default **Waterfall**
tab — Causal graph / Legacy / Run view (mocks `13`–`16`) were NOT captured live and
have no recorded delta below; T07 must re-screenshot those three tabs before
scoping. Do not read any finding below as "layout is broken" when the live panel is
simply rendering its documented empty/zero state.

1. **`/dashboard` vs `01-dashboard.png`**
   - Topbar structure differs: mock is a two-row header (breadcrumb row: org mark +
     tenant chip `acme-latam` + section breadcrumb + `Search… ⌘K` + bell/theme/avatar,
     then a separate section-tabs row); live renders ONE row with the section tabs
     (Overview/Channels/.../Settings) inline next to the `Yoizen` logo and no
     breadcrumb row. **FIX (T08)** — restructure topbar into mock's two-row chrome.
   - `Search… ⌘K` box in the topbar has no equivalent live element. **NEW-CAPABILITY**
     — flag for human sign-off, default not built (decision 3 names this exact
     example).
   - Tenant identity: mock shows the real tenant slug (`acme-latam`) in the
     breadcrumb; live shows a `Unknown` chip in the top-right instead — this repeats
     on every audited screen (topbar tenant chip resolves to the literal string
     `Unknown`). **FIX (T08)** — looks like a wiring bug in the shared shell/topbar
     component, not a missing-data case (tenant slug is known — it renders correctly
     in the sidebar's org context elsewhere); verify `TenantService`/topbar binding.
   - Dashboard subtitle: mock renders `Última actualización hace 15 s · ● todos los
     servicios operativos` (live status + relative refresh time); live renders the
     literal tenant-name string (`Unknown`, same bug as above) as the subtitle,
     structurally in the same slot. **DATA-GAP** — no live-refresh timestamp or
     aggregate service-health field is wired into `DashboardService.stats()` per
     `console-redesign-dashboard` (INDEX); the subtitle slot itself is real, but the
     "todos los servicios operativos" aggregate needs a new client-side derivation or
     backend field — flag as **NEW-CAPABILITY** for the health rollup specifically
     (no per-service status feed exists), FIX for swapping in the real tenant/updated
     text once T08's tenant-chip bug is fixed.
   - KPI 4-card row, `API usage · 7 days` panel, and `Actividad`/Activity panel
     layout otherwise match the mock's composition (card row → two-panel row).
     Activity dots are uniformly blue in the live capture vs. mock's mixed
     green/red — this is dev-seed-data variance in `activityTone`, not a layout bug
     (mapping already exists per `console-redesign-dashboard`, INDEX) — no action.
   - Recent-workflows table is off-screen below the fold in this capture (viewport
     screenshot, not full-page) — its Name/Executions-only column set is
     already a signed amendment (INDEX, `console-redesign-dashboard`); no new
     finding.

2. **`/analytics` vs `18-analytics.png` + `19-analytics-tables.png`**
   - Entire KPI set, chart, and breakdown tables differ from the mock by design —
     this is the **signed amendment** in INDEX (`console-redesign-users-analytics-
     settings`, "Analytics rebuilt from real data, not restyled mocks"): the mock's
     metric set (Conversaciones / Resueltas sin humano % / 1ª respuesta / Tokens LLM
     · 30d, plus the "Por canal" / "Por agente" / "Por workflow" breakdown panels in
     `19`) has zero backing data source anywhere in the platform. **DATA-GAP** — cite
     INDEX `console-redesign-users-analytics-settings` follow-up ("Analytics' design
     metric set... has no backing field or endpoint anywhere"). Not in scope for T04
     to build; T04 should not re-litigate this.
   - Time-range selector (`7d`/`30d`/`90d`) and `Export CSV` button in the mock have
     no equivalent live control (Analytics has no range picker; Dashboard has an
     unrelated `Export Report` button). **FIX-candidate (T04)** if
     `DashboardService`/`ChannelAdminService`/`WorkflowApiService` calls already
     accept a day-count param (verify before building) — otherwise **NEW-CAPABILITY**.
   - Subtitle text differs (`Conversaciones y consumo · todo el tenant` vs live's
     `Real usage and performance metrics`) — cosmetic wording only, **FIX (T04)**,
     trivial.

3. **`/channels/telegram` vs `02-channels-fleet.png`**
   - Sidebar: mock's channel filter list starts with an aggregate `Todas` (All) row
     showing the total count across every channel type; live's sidebar
     (WhatsApp/Telegram/HTTP) has no "All" aggregate entry. **FIX (T05)** — add an
     "All channels" filter row mirroring Connections' equivalent gap (finding 5
     below).
   - KPI row: mock shows 4 cards (Flota·Messages 24h, Flota·Delivery rate,
     Flota·Conversaciones, Flota·1ª Respuesta); live shows the already-signed
     3-card row (Messages·24h / Active accounts / Inactive accounts) from the
     `console-redesign-channels` loop. **DATA-GAP** — cite INDEX
     `console-redesign-channels` follow-up ("No per-account health/degradation or
     time-bucketed series... blocks the design's warn state and the fleet table's
     sparkline/msgs-24h/delivery/first-response columns"). Not a T05 target.
   - Table columns: mock is `CUENTA/IDENTIDAD/ESTADO/MSGS·24H` (with a per-row
     sparkline); live is `ACCOUNT/CHANNEL/IDENTITY/STATUS/CREATED` (no sparkline,
     no msgs-24h column, extra Channel/Created columns not in the mock).
     **DATA-GAP** for the sparkline/msgs-24h cells (same INDEX citation as above).
     **FIX (T05)** for the column set itself — reorder/rename the real columns
     (Account/Identity/Status) closer to the mock's order and drop
     Channel/Created if they add no value on a single-channel fleet view (channel
     is implied by the page context; created date has no mock slot) — human call,
     low priority.
   - Header subtitle: mock is `8/9 conectadas · 1 necesita reauth`; live is a
     static `Manage channel accounts` string. **DATA-GAP** — cite INDEX
     `console-redesign-channels` ("`connectedCount` set to `accounts.length`... never
     filters by `isActive`" — the "N need reauth" sub-label can never fire today).

4. **`/channels/telegram/accounts/:id` vs `03-channel-account-detail.png`**
   - Header: mock is one clean row (back arrow + name + type badge + phone identity
     + status chip) then a second row of time-range tabs (6h/24h/7d/30d) + Refresh.
     Live crams name + type/manifest badges + status + **Edit/Delete buttons** +
     time-range tabs onto one row, plus an extra description subtitle line. The
     Edit/Delete-in-header placement is an intentional signed decision from the
     Channels loop (INDEX, "Edit/Delete relocated to the account-detail header") —
     not a T05 target to remove. **FIX (T05)** — split into the mock's two-row
     rhythm (identity row, then a separate action/time-range row) for breathing
     room; low priority, cosmetic.
   - Metrics: mock shows 5 business-message KPIs in one row (Received / Sent /
     Delivered % / Failed / 1ª Respuesta). Live shows 3 JetStream-infra KPIs
     (Ingress / Egress / DLQ) — a different data axis entirely (stream throughput,
     not message delivery outcomes). **DATA-GAP** — same INDEX citation as finding
     3 (no per-account delivery/failed/first-response data exists); the JetStream
     view is what the account-detail route has instead.
   - Chart: mock is one `Actividad · 24h` in/out area chart directly under the
     KPIs; live is an Ingress/Egress/DLQ stream chart that renders "No usage data
     for the selected range" in this capture. Same DATA-GAP category as above.
   - Live has an extra `Streams (this account)` section (3 Inspect cards) with no
     equivalent slot in the mock at all. **FIX-candidate (T05)**, low priority —
     decide whether to keep this JetStream-ops tooling below the fold or drop it;
     it is not itself a data gap, just absent from the visual contract.

5. **`/connections` vs `04-connections-fleet.png`**
   - Sidebar: same "no aggregate `Todas`/All row" gap as Channels (finding 3).
     **FIX (T05)**.
   - KPI row: mock shows 4 cards (Calls·24h, Error rate, Avg p95, Secrets por
     rotar); live shows the already-signed 3-card row (HTTP/MCP/Hosted services
     counts) from `console-redesign-connections`. **DATA-GAP** — cite INDEX
     `console-redesign-connections` follow-up ("No call-aggregation or error-rate
     fields exist anywhere in the inventoried services... would require new backend
     aggregation").
   - Table columns: mock is `NOMBRE/ENDPOINT/AUTH/CALLS·24H` (+ sparkline); live is
     `NAME/TYPE/STATUS/DETAIL`. The Calls·24h/sparkline cells are **DATA-GAP** (same
     citation). Endpoint URL and auth type/method ARE real fields on
     `IAdapterDto`/`IMcpServer` today — swapping `TYPE`/`DETAIL` for
     `ENDPOINT`/`AUTH` is a **FIX (T05)** candidate using existing data.
   - Header subtitle: mock `7 conexiones · 1 degradada · el resto operativa` vs
     live's static `Tenant integration catalog`. **DATA-GAP** — no degraded-count
     aggregate exists (same class as Channels' `connectedCount` gap, finding 3).

6. **`/connections/http/:id` and `/connections/mcp/:id` vs `05-connection-mcp-detail.png`**
   - Per the T01 note carried over from routing instructions: mock `05` is actually
     the **MCP fleet list view** (`/connections/mcp` filtered from the unified
     Connections landing), not a single-connector detail screen — there is no
     dedicated detail mock for either HTTP connectors or MCP servers anywhere in
     `01`–`19`. This is a **documentation gap in the visual contract itself**, not a
     code bug; T05 should use `03-channel-account-detail.png`'s detail-page rhythm
     (identity row → KPI overview strip → config table) as the closest analog when
     polishing `connector-detail`/`mcp-detail`, and flag to the human that no
     pixel-exact detail mock exists for these two routes.
   - Comparing the live HTTP detail (`connections-http-f27086e2-....png`, connector
     `pokeapi`) against that closest analog: header (back-link, name, subtitle,
     status/scope badges, Edit button) and a KPI-style Overview strip
     (Status/Auth/Scope/Endpoints) followed by a Configuration table and an
     Endpoints list are reasonably consistent with the detail-page rhythm used
     elsewhere. No FIX finding beyond "no target mock" above.
   - **Genuine chrome mismatch found**: clicking `MCP` in the Connections sidebar
     does NOT filter the unified fleet table (the pattern the INDEX describes for
     `console-redesign-connections` — "a unified fleet landing... merging the three
     connector kinds into one rows array"); it navigates to a wholly separate route
     `/connections/mcp` with its own page title (`MCP Servers`), its own subtitle,
     its own transport/status filter-chip row (`All transports`/`HTTP`/`SSE`,
     `All statuses`/`Enabled`/`Disabled` — none of which exist in the mock at all),
     its own `Add MCP Server` CTA, and NO KPI row and NO shared inventory table.
     **FIX (T05), higher priority** — align `/connections/mcp` chrome with the
     unified-landing composition (KPI strip + `NOMBRE/ENDPOINT/AUTH/CALLS·24H`
     table) per mock `05`, or — if the separate-route architecture is intentional —
     restyle it to reuse the same KPI-row/table primitives instead of its own
     filter-chip UI. The filter-chip row itself (`All transports`/`HTTP`/`SSE`/
     `All statuses`/`Enabled`/`Disabled`) is a **NEW-CAPABILITY**-flavored
     structural difference from the mock and needs human confirmation on which
     direction to take before T05 touches this route.
   - Live session had 0 MCP servers configured, so the empty state is what was
     captured (`No MCP servers yet`) — no per-row layout could be audited; T05
     needs a live MCP server to compare row rendering against mock `05`'s rows.

7. **`/ai/agents` vs `06-ai-agents.png`**
   - Sidebar: mock shows count badges on nav items (`Agents 5`); live's AI sidebar
     (Agents/Playground/Memories/Skills/Knowledge Bases/System Variables) has no
     count badges at all, unlike Channels/Connections/Users/Roles which do show
     counts. **FIX (T06)** — add count badges for parity with the rest of the
     shell's sidebars (Agents/Memories counts are real fields per
     `AgentAdminService`/`MemoriesService`).
   - Header: mock subtitle is a real summary (`3 agentes · 2 published · 1 draft`)
     plus a `Sync from seed` + `New agent` button pair; live subtitle is the static
     `Manage your AI agents` plus a single `New agent` button. The subtitle text is
     a **FIX (T06)** (agent counts already exist per INDEX's KPI-row substitute,
     see below). `Sync from seed` has no evidence of a matching backend action in
     `AgentAdminService` — **NEW-CAPABILITY**, flag for sign-off; do not build
     unless confirmed to already exist.
   - KPI row: mock's top strip is invocation-based (Invocations·24h / Avg p95 /
     Tokens·24h / Handoff rate) — this is **DATA-GAP**, already documented (INDEX
     `console-redesign-ai` follow-up: "No per-agent stats/usage endpoint exists...
     blocks... the list's top-of-page MetricCard row"). Live substitutes a
     count-based row (Agents/Published/Draft/Skills configured) instead, which is a
     reasonable stand-in but a different chrome than the mock's row — not a T06
     target to "fix" since the real metric set is unavailable; no action beyond
     documenting the substitution.
   - **Composition mismatch, largest T06 item**: the mock renders agents as a
     vertical stack of rich CARDS (name + status pill + model/temp line +
     description paragraph + inline sparkline + footer stat line
     `2,841 inv/24h · p95 620ms · 3 skills · synced`). Live renders a flat
     `NAME/MODEL/STATUS/SKILLS` data table (`app-inventory-table` primitive) — a
     structurally different list paradigm (table rows vs. content cards), and this
     was itself a **signed decision** in the `console-redesign-ai` loop (INDEX:
     "the agents list... with an `app-inventory-table`"). **FIX-candidate (T06)**
     but flagged HIGH-EFFORT/scope-risk: converting table rows to the mock's card
     list is a deeper primitive change than the other polish tasks, not a simple
     spacing/chrome tweak — recommend human confirmation before T06 attempts a full
     card-list rebuild vs. a lighter table-density pass.
   - Live session had 0 agents configured, captured as the documented empty state
     (`No agents found`) — row-level rendering (card content, sparkline, status
     colors) could not be audited live; needs a seeded agent before T06's visual
     check.

8. **`/ai/agents/new` vs `07-ai-editor.png` + `08-ai-editor-prompt.png` + `09-ai-editor-test-panel.png`**
   - **Composition mismatch, single largest T06 item in the whole audit**: the mock
     is ONE scrolling single-column page — left nav (Agents/Playground/.../System
     Variables) stays, then in the main column: header (name, model/temp chips,
     version banner `v14 · draft sobre v13 published` + `unsaved` badge, `Diff vs
     v13`/`Reset`/`Update agent` buttons) → a Configuration nav list (General,
     Instructions > System Prompt/Rules/Soul/Detected References, Capabilities:
     Skills/Tools/Built-in Tools/MCP Servers/Knowledge Bases, Advanced:
     Variables/Versions) → the System Prompt code editor rendered INLINE below that
     nav → a `Detected References` chip section further down → a `Test run` chat
     panel further down still, all in the SAME vertical scroll (no fixed right
     panel). Live is a FIXED THREE-PANE workstation: a far-left icon rail
     (AG/PL/ME/SK/KB/SV), a middle collapsible config-tree sidebar, a large center
     System Prompt editor panel, and a permanently DOCKED right-hand `Test run`
     panel that does not scroll with the page. **FIX (T06), flagged HIGH-EFFORT/
     scope-risk** — this is a full information-architecture rebuild (fixed 3-pane
     workstation → single scrolling column with inline sections), not a chrome
     tweak; recommend explicit human sign-off on whether T06 attempts the full mock
     layout or keeps the current 3-pane arrangement with mock-matched internals
     (nav tree labels, chip styling) only.
   - Mock's version-management UI (`v14 · draft sobre v13 published`, `unsaved`
     badge, `Diff vs v13`, `Reset`, `Versions` nav entry, `autosave on` indicator)
     has no evidence of a backing versioning system in `AgentAdminService` or
     elsewhere in the codebase reviewed so far. **NEW-CAPABILITY** — flag for human
     sign-off; default not built. (Live's `/ai/agents/new` header instead shows
     `Back to List`/`Reset Template`/`Create Agent`, appropriate for a brand-new,
     unsaved agent with no version history — some of the mismatch here is simply
     "new agent" vs. mock's "editing an existing published agent v14"; re-audit
     against an EXISTING agent's `/ai/agents/:id/configure` route once one is
     seeded, since the SPEC's audit list also calls for that route.)
   - `Detected References` chip section (`@skill:lead-scoring`, `@tool:crm-create-
     opportunity`, `... · sin usar`) sits below the System Prompt editor in the
     mock; live's editor for a blank new agent has no mentions to detect yet, so
     this section could not be compared — needs a seeded agent with prompt content.
   - Live's fixed right-hand Test run panel already matches the mock's "Save the
     agent first to start testing" empty-state messaging almost verbatim
     (`Save the agent first to start testing` / `Save the agent to enable
     testing`) — content-level parity is good even though the container placement
     differs (see composition finding above).

9. **`/workflows` vs `10-workflows.png`** — note: `/workflows` (the list) is
   **not explicitly owned by any task in T02–T08** (T02/T03 only cover the builder
   route `:id/builder`). Flagging this queue gap for the human/T09 rather than
   silently assigning it.
   - KPI row: live shows a 4-card strip (Workflows/Active/Completed(7d)/Failed(7d))
     that the mock does NOT have at all — mock goes straight from the header
     subtitle to the table. **FIX-candidate**, needs a task owner — this extra row
     is not itself a data gap (all 4 numbers are real), just extra chrome vs. the
     mock; a human call on whether to keep it (useful signal) or drop it for mock
     parity.
   - Table columns match closely (`NOMBRE/TRIGGER/ACCIONES/EJECUCIONES/CREADO/
     ESTADO` vs. live's `NAME/TRIGGER/ACTIONS/EXECUTIONS (7D)/CREATED/STATUS`) with
     matching health-dot semantics (active→ok, draft→idle, disabled→warn per
     signed INDEX mapping). Missing: the mock's per-row `>` chevron click
     affordance. **FIX-candidate**, needs a task owner, low priority/cosmetic.

10. **`/workflows/:id/builder` vs `11-builder.png`** — this is exactly the
    problem the SPEC's Goal section and decision 2 describe; confirms both T02 and
    T03's premises with live evidence:
    - **Double chrome, T02's exact target**: live stacks the legacy detail-view
      wrapper (breadcrumb `Workflows / http-fanout-telegram`, title + Active badge,
      `Run now`/`Pause`/`Edit` buttons, sub-tabs row `Overview/Builder/Executions/
      Settings`) directly on top of the builder's OWN floating chrome
      (`workflows / http-fanout-telegram` breadcrumb, `Saved` badge, `Run Test`/
      `Save` buttons) — two full navigation/action rows before the canvas even
      starts. **FIX (T02)**.
    - Mock's floating segmented control (`Editor / Runs 1,842 / Settings`)
      replacing the sub-tabs row, and the `valid · N nodes` pill + `Run test`/
      `Publish` button pair in the top-left of the canvas chrome — **FIX (T03)**
      for the segmented control and the `valid · N nodes` pill (from existing
      validation state); `Publish` is explicitly called out as
      **NEW-CAPABILITY** in decision 3's own example — confirmed no publish action
      exists in the live capture (only `Run Test`/`Save`) — do not build, findings
      only.
    - **Palette, T03's exact target**: live still shows the full-height LEFT
      sidebar palette (Channels/Logic/Integrations/AI/Flow control category
      groups, one node type per row) instead of the mock's floating bottom-center
      horizontal icon dock (`CHAN/JS/HTTP/MCP/SVC/EVT/AGENT/PAR/IF`). **FIX (T03)**.
    - **Node cards, T03's exact target**: live cards show only icon + name + type
      subtitle (e.g. `getPokemon` / `HTTP Connector`) with no type badge chip, no
      one-line config summary, no stats line. Mock cards add a `TRIGGER`/`IF`-style
      type badge, a one-line mono config summary (e.g. `accounts: ventas-ar ·
      patterns: ...`), and a stats line (`1,842 runs · p95 620ms · ok`). The
      config-summary line is **FIX (T03)** (derivable from existing node config
      fields per T03's own spec); the stats line is **DATA-GAP** — already
      documented (INDEX `console-redesign-processes-builder` follow-up: "Per-node
      run-count/error-rate mini-stats have no backing aggregate anywhere in the
      platform... ships hidden rather than showing invented numbers") and T03's own
      task text already says to keep it hidden — consistent, no new finding.
    - Zoom control (`-`/`100%`/`+`/fit) visible bottom-left in the mock could not
      be confirmed present/absent in the live capture (different scroll/crop) —
      per INDEX this already exists (`FCanvas`/`fZoom`) — no new finding, just
      re-verify visually once T02/T03 land.

11. **`/processes/trace/:correlationId` vs `12-trace-waterfall.png`** — **only the
    Waterfall tab was captured live**; Causal graph/Legacy/Run view (mocks
    `13`–`16`) have no recorded findings and must be re-shot for T07.
    - Sidebar: mock's Processes sub-nav includes a `Trace` entry (Workflows/
      Schedules/Trace); live's sidebar only has Workflows/Schedules — Trace is
      reachable only by direct URL, not from the sidebar. **FIX (T07)** — add
      `Trace` to the Processes sub-nav.
    - Summary strip: mock is a 5-cell KPI-style row (`VERDICT` chip, `TOTAL`
      duration, `EVENTOS` count + span-complete ratio, `CANAL` identity, `
      BOTTLENECK`); live is a 3-field block (correlation id, total duration,
      bottleneck text) — no `VERDICT` chip, no `EVENTOS` count, no `CANAL` field.
      **FIX (T07)** for `TOTAL`/`BOTTLENECK` (already real, just needs the mock's
      card-strip styling) and for `EVENTOS` (derivable as a count of the rendered
      waterfall rows). `VERDICT` and `CANAL` need verification of a real source
      field before building — likely derivable from the root/terminal event's
      `ActionStatus` and the triggering channel account, respectively (both exist
      elsewhere per `console-redesign-trace`, INDEX) — **FIX-candidate (T07)**,
      verify before building rather than inventing.
    - Time-axis ruler: mock renders an explicit ms-tick header row (`0/309ms/
      618ms/927ms/1,236ms`) above the waterfall bars; live has no time-axis ruler
      at all (only the summary strip serves as a legend). **FIX (T07)**.
    - Service color-coding: mock colors bars/diamonds by originating service
      (blue=workflow-service, purple=agent-runtime, green=channel-service); live
      colors are uniform blue with green/blue diamonds only for start/end markers,
      not per-service. **FIX-candidate (T07)**, lower priority — this is an
      information-encoding change (adds a legend), not pure colorimetry, but not
      as load-bearing as the ruler/summary-strip gaps above.
    - Right-side inspector panel (`TraceSelectionService`-backed, "Select an
      event..." empty state) already matches the shared docked-inspector pattern
      described in INDEX — no delta found in this capture.
    - Tab strip itself (Waterfall/Causal graph/Legacy/Run view) matches the
      INDEX-documented tab set; mock's tab-strip styling was not visible in this
      crop (scrolled below it) — re-verify once summary-strip changes land.

12. **`/users` vs `17-settings-users.png`** — confirms the already-signed finding
    in INDEX (`console-redesign-users-analytics-settings`) that mock `17` is
    actually the Users list, not a dedicated Settings screen.
    - Missing `+ Add User` action: mock shows an `Add user` button top-right; the
      live capture (Tenant Admin session, `users:create`-eligible per INDEX) shows
      NO add-user button at all. **FIX (T08)** — this looks like a real regression/
      gap, not a design choice; INDEX explicitly says "the existing '+ Add User'
      dialog unchanged" was kept — verify the button's permission gate/visibility
      logic.
    - Role column: mock renders role as a colored chip (`admin`/`editor`/`viewer`);
      live renders plain text (`Tenant Admin`). **FIX (T08)** — style as a badge/
      chip using the existing `status-badge`-family primitive.
    - Header subtitle repeats the site-wide `Unknown` tenant-name bug (`1 members
      in Unknown` vs. mock's `8 members in acme-latam`) — same root cause as
      finding 1's topbar tenant chip; **FIX (T08)**, one fix likely resolves both.
    - Trailing row action icon: mock shows a per-row icon (deactivate affordance);
      live's single row shows none. **FIX-candidate (T08)** — verify whether the
      existing deactivate action is reachable another way (row click →
      `UserDetailDialogComponent` per INDEX) before adding a duplicate icon.

13. **`/settings` vs `17-settings-users.png`** — per the INDEX-signed amendment,
    the mock has NO dedicated Settings screen (the "Settings" tab in the design
    tool renders the Users table underneath it); live's `settings-hub.component.ts`
    card/chip grid (`Identity` card with Users/Roles & permissions/API keys chips,
    `Tenant` card with Billing chip) has no 1:1 mock target. No new findings beyond
    the already-recorded amendment; confirms it holds.

14. **Cross-cutting NEW-CAPABILITY list for human sign-off** (consolidated from
    findings above, none of these are built without explicit approval):
    - Topbar `Search… ⌘K` box (finding 1).
    - Dashboard "todos los servicios operativos" aggregate service-health rollup
      (finding 1).
    - Analytics `7d/30d/90d` time-range selector + `Export CSV`, if the underlying
      services do not already accept a day-range param (finding 2).
    - `/connections/mcp`'s transport/status filter-chip row, if the human chooses
      to keep the separate-route architecture rather than folding MCP into the
      unified fleet table (finding 6).
    - AI agents list `Sync from seed` button (finding 7).
    - AI editor version-management UI: version banner, `Diff vs v13`, `Reset`,
      `Versions` nav entry, `autosave on` indicator, `Publish` (agents) (finding 8).
    - Workflow builder `Publish` action (finding 10, decision 3's own named
      example).

### T02 — Builder: real full-bleed on the nested route (decision 2)

- `features/automation/workflows/detail/workflow-detail.component.ts`: when
  the active child route is `builder`, suppress the wrapper chrome
  (breadcrumb row, page title, sub-tabs row, Run now/Pause/Edit buttons) so
  the canvas is edge-to-edge under the global header, per mock `11-builder.png`.
- The wrapper's navigation moves into the builder's floating chrome as the
  mock's segmented control (Editor / Runs / Settings → routes to
  `:id/builder`, `:id/executions`, `:id/settings`; "Runs N" count only if a
  real count is already loaded — no new fetches). Back arrow returns to
  `/workflows`. Run now/Pause stay reachable: relocate into the floating
  chrome row (existing actions, same wiring — verify what the wrapper wires
  today and preserve it).
- Fix the stale `subNavCollapsed` doc comment in `workflow-detail.component.ts`
  (L5 follow-up).
- Unit tests: wrapper hidden on builder child route, visible on
  overview/executions/settings; segmented control navigates; existing
  actions still fire with identical wiring. Existing detail specs stay
  green.
- VISUAL CHECK: screenshot `/workflows/:id/builder` — no double chrome.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Builder: palette dock + node cards per mock

- Palette: replace the full-height left sidebar with the mock's floating
  horizontal dock (bottom-center): icon chips CHAN/JS/HTTP/MCP/SVC/EVT/AGENT/
  PAR/IF (same node types as today's palette — same create wiring, no new
  node types). Keyboard/drag behavior preserved if it exists today.
- Node cards per mock: leading icon chip, type badge (TRIGGER/IF/etc. from
  `EWorkflowNodeType` — reuse the T04 color mapping), one-line mono config
  summary derived from EXISTING node configuration fields (pure function,
  per-type, tested; empty when nothing meaningful), the existing stats line
  stays hidden (NO-DATA). Ports/selection/edge behavior unchanged.
- `valid · N nodes` pill from the EXISTING validation state (verify what the
  builder validation exposes today; if validation only runs on save, show
  node count only — no new validation runs). `Publish` only if a real
  publish action exists today — otherwise FINDING (decision 3).
- Unit tests: dock renders all types + creates nodes identically; config
  summary pure function per type incl. empty case; round-trip save test
  STAYS GREEN (byte-compat frozen).
- VISUAL CHECK: screenshot builder with a loaded workflow vs `11-builder.png`.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Dashboard + Analytics parity

- Apply every FIX-class delta recorded in T01 for `/dashboard`
  (vs `01-dashboard.png`) and `/analytics` (vs `18`/`19`): typical suspects —
  panel proportions, header rows, table density, missing recent-workflows
  columns layout, chart panel composition. DATA-GAP items stay excluded.
- Unit tests updated only where presentation assertions change; every
  behavior assertion survives.
- VISUAL CHECK: both screens.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T05 — Channels + Connections parity

- Same treatment for `/channels/:channel`, the account detail, `/connections`
  and both detail views vs mocks `02`–`05` per T01 findings.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T06 — AI parity

- Same treatment for `/ai/agents` and the editor + test panel vs mocks
  `06`–`09` per T01 findings (editor layout proportions, test-panel
  composition, mention-chip styling refinements).

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T07 — Trace parity

- Same treatment for the four trace tabs + inspector vs mocks `12`–`16` per
  T01 findings.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T08 — Shell/topbar + Users/Settings parity

- Global chrome deltas from T01 (topbar composition vs the mock: tenant
  chip placement, breadcrumb style; the `Search… ⌘K` box is NEW-CAPABILITY —
  finding only, do not build) + `/users` and `/settings` vs `17`.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T09 — Docs + after-audit + index

- Re-run the full visual audit → `manual-loops/admin-console/audit/after/`;
  update `services/admin-console/README.md` (polish notes) and
  `cowork/INDEX.md` (`## Change: console redesign polish
  (console-redesign-polish)` with the before/after audit pointers, findings
  resolved vs deferred, NEW-CAPABILITY items awaiting sign-off). Log to
  Engram topic 'admin-console/redesign-polish'.

**Accept**
```
grep -n "console-redesign-polish" cowork/INDEX.md && ls manual-loops/admin-console/audit/after
```

---

- [x] T01 visual audit + harness
- [x] T02 builder full-bleed (nested route)
- [ ] T03 builder palette dock + node cards
- [ ] T04 dashboard + analytics parity
- [ ] T05 channels + connections parity
- [ ] T06 ai parity
- [ ] T07 trace parity
- [ ] T08 shell + users/settings parity
- [ ] T09 docs + after-audit

## Out of scope (explicit)

- Anything catalogued as DATA-GAP in the L0–L7 INDEX entries (analytics
  conversaciones/tokens LLM, per-node stats, builder id-bridge, warn
  signals, subscriber shapes, etc.).
- New capabilities: topbar search, publish flow (unless it already exists),
  new endpoints, new metrics — findings only.
- Behavior/routes/save formats — frozen.
- The AI sub-pages, roles/api-keys/billing screens (their own future loops).

## Human boundaries for this change

- Human approves this SPEC before the first run.
- NEW-CAPABILITY findings from T01 need human sign-off before any task
  builds them (default: not built).
- Deviating from the binding visual contract requires human sign-off.
