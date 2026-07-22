# SPEC — Console redesign: Processes + workflow builder (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-foundation.md` (must be shipped).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-processes-builder'.

## Goal

1. The Processes section lists workflows as an operational view (fleet
   metrics, inventory table with run sparklines and health, needs-attention
   panel).
2. The workflow builder becomes the full-bleed, Figma-style canvas of the
   design contract: floating chrome, colored ports by type, edge labels,
   per-node mini-stats, floating inspector — on top of the EXISTING graph
   model and persistence.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: "Processes" + "Builder" sections of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (+ screenshots).
2. The builder's data model, save format, and validation rules do NOT change —
   this is a re-skin + chrome/UX rework of the existing builder, not a new
   engine. The canvas stays on `@foblex/flow` (18.6.0).
3. Full-bleed means the builder route hides the console sidebar/topbar and
   shows floating chrome (back button, workflow name, save state, zoom).
   **AMENDED 2026-07-22 (human sign-off, post-T01 finding 5):** follow the
   design — the app header/tabs STAY VISIBLE in the builder; only the
   sub-nav hides (extend the existing `subNavCollapsed` mechanism). Floating
   chrome (back, name, save state, zoom) overlays the canvas.
4. Port colors map by port data type; the exact type→color mapping is
   confirmed with the human after T01.
   **AMENDED 2026-07-22 (human sign-off, post-T01 finding 2):** ports have
   no data type in the domain model, and the design itself colors by NODE
   type (KIND_STRIPE). Ports/accents are colored by `EWorkflowNodeType`
   mapped to existing `--rd-*` tokens, with a neutral fallback for unknown
   types. No model changes.
5. Per-node mini-stats (runs, error rate) come from existing run data; if the
   builder view has no access to it, it's a finding, not a new endpoint.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `features/automation/workflows/` — `workflows.component.ts` (list),
  `builder/workflow-builder.component.ts` (+ `builder/components/`) on
  `@foblex/flow`; `domain/flow-serializer.ts`, `flow-deserializer.ts`,
  `workflow-node.types.ts`, `workflow-node-defaults.ts`, `validation/`;
  `services/workflow-api.service.ts`. Engine and persistence REUSED —
  rewriting the canvas is automatic rejection.
- `features/processes/processes-landing.component.ts` — section landing.
- `app.routes.ts` `data: { subNavCollapsed: true }` (builder route) — the
  existing chrome-collapse mechanism; extend it for full-bleed instead of
  inventing a new one.
- `src/app/shared/components/` — foundation primitives for the list view.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex.
- Only the processes feature folder (+ the layout tweak for full-bleed route)
  is touched.
- Saved workflow JSON must be byte-compatible: a workflow opened and saved
  without edits produces an identical payload (unit-tested in T03).

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

- Map `features/automation/workflows/` + `features/processes/`: builder
  architecture (@foblex/flow usage, node/edge models, port typing, save
  path via `flow-serializer.ts`, validation), run-data
  availability for mini-stats, how the layout shell wraps routes (for
  full-bleed). Record "**T01 findings (recorded <date>):**" in this SPEC.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-processes-builder.md
```

**T01 findings (recorded 2026-07-22):**

1. **Workflows list — `features/automation/workflows/workflows.component.ts`**
   - Renders one `.wf-card` per workflow from `WorkflowApiService.list()` +
     `WorkflowApiService.getExecutionCounts()` run in parallel via `forkJoin`
     (`workflows.component.ts:232-245`). No pagination.
   - Per-card fields actually available: `wf.name`, `triggerLabel(wf)`
     (`workflows.component.ts:261-267`, derived from `wf.trigger.type`),
     `wf.application`, enabled/disabled + active/draft status badge
     (`isEnabled`, `workflows.component.ts:279-281`), `actionCount(wf)`
     (`wf.actions.length`, `:269-271`), `wf.createdAt` (via `UtcDatePipe`,
     template line `85`), and `executionCount(wf)` — an O(1) lookup into the
     `executionCounts` map built from `getExecutionCounts()`
     (`workflows.component.ts:220`, `:274-276`).
   - **No "last run" timestamp, no run series/sparkline data, no
     success/error rate** on `IWorkflowDefinitionDto` or anywhere in this
     component — `getExecutionCounts()` returns only a tenant-wide
     `definitionId -> count` map (`workflow-api.service.ts:192-196`), backed
     by `WorkflowsService.getExecutionCountsByTenant`
     (`services/workflow-service/src/modules/workflows/workflows.service.ts:631-642`),
     which is an **all-time count**, not a 7-day window, and carries no
     status breakdown (ok/error) at all.
   - The dashboard-loop claim is **partially confirmed — the label is
     wrong, but the underlying data gap is a wiring gap, not a missing
     backend feature.** `features/processes/processes-landing.component.ts`
     (NOT the list view — it's the section landing) renders `topWorkflows()`
     from `ProcessesMetricsService.loadTopWorkflows()`
     (`core/services/metrics/processes-metrics.service.ts:50-78`), which
     hard-codes **`successRate: 1`** for every entry
     (`processes-metrics.service.ts:68`) and labels the same all-time
     `executions/counts` value as **`runs7d`** (`:14`, `:67`) — today this
     label is misleading and the success rate is fake, because
     `ProcessesMetricsService` calls `getExecutionCounts()`
     (all-time, no window), not the 7-day-windowed endpoint.
     **Correction: a real 7-day-windowed per-workflow run count DOES
     exist server-side.**
     `WorkflowsService.getWorkflowsSummary`
     (`services/workflow-service/src/modules/workflows/workflows.service.ts:668-719`)
     computes `since7d`/`since24h` windows (`:669-671`) and returns
     `topByExecutionCountLast7d` — a real per-workflow, 7-day-windowed run
     count via `topDefinitionsByExecutionCount(tenantId, since7d, 5)`
     (`:706`, backed by the Postgres repo's `GROUP BY e.definition_id`
     query, `executions.postgres.repository.ts:186-191`) — plus
     tenant-wide `executionsCompletedLast7d`/`executionsFailedLast7d`
     (`:677-695`). This is wired to `GET /workflows/summary`
     (`workflows.controller.ts:82-85`) and proxied through api-gateway
     (`services/api-gateway/src/modules/workflows/workflows.controller.ts:120-127`).
     **The actual gap is in admin-console: `WorkflowApiService` has no
     method that calls `/workflows/summary` at all** (only
     `getExecutionCounts()` at `workflow-api.service.ts:192-196`, wired to
     the unwindowed `executions/counts` endpoint) — `ProcessesMetricsService.
     loadTopWorkflows()` was never updated to consume the summary
     endpoint. T02's inventory table can get real 7d-windowed run counts
     by adding a `WorkflowApiService` wrapper for the existing
     `/workflows/summary` endpoint — **no new backend endpoint is
     needed for this part.** What genuinely has **no data source**:
     per-workflow **success/error rate** — `ITopDefinitionRow`
     (`executions.repository.interface.ts:40-45`) carries only
     `definition_id`/`name`/`application`/`count`, no status breakdown — so
     a real (non-hardcoded) `successRate` per workflow is still **NO-DATA**
     and would require a new query/endpoint (see finding 6 for the
     separate per-node aggregate gap, which remains unchanged/valid).

2. **Builder architecture — `builder/workflow-builder.component.ts` +
   `builder/components/`**
   - Canvas: `@foblex/flow` via `FFlowModule`; the template uses
     `<f-flow fDraggable (fLoaded) (fCreateNode) (fCreateConnection)
     (fReassignConnection)>`, `<f-background/>`, `<f-canvas fZoom>`,
     `<f-connection-for-create/>`, and per-edge `<f-connection
     [fConnectionId] [fOutputId] [fInputId] [fReassignableStart]
     fType="bezier" fBehavior="floating">` (`workflow-builder.component.ts:168-201`).
     Nodes use `fNode fDragHandle [fNodePosition]` on
     `<app-workflow-node>` (`:191-199`), and ports inside
     `workflow-node.component.ts` use `fNodeInput
     [fInputId]="node().key+'-in'" fInputConnectableSide="left"` and
     `fNodeOutput [fOutputId]="node().key+'-out'" fOutputConnectableSide="right"
     [fOutputMultiple]="node().type===branch||conditional"`
     (`builder/components/workflow-node/workflow-node.component.ts:26-49`).
   - Node/edge domain model — `domain/workflow-node.types.ts`:
     `EWorkflowNodeType` enum (`:1-11`): `CHANNEL, JS_FUNCTION,
     ENDPOINT_CALL, MCP_CALL, SERVICE_CALL, SERVICE_BUS_CALL, AGENT_CALL,
     BRANCH, CONDITIONAL`. `EWorkflowConnectionType` (`:13-15`) has a single
     value, `DEFAULT` — connections carry only an optional free-text
     `label?: string` (`:53`), which is **never populated** anywhere in
     `flow-serializer.ts`/`flow-deserializer.ts`/the builder component (only
     read, never written) — so "edge labels from existing edge metadata"
     (T04) has no source data today; the design mock's edge labels
     (`"text contains \"precio\""`, `"default"`) are static mock strings, not
     derived from a real field.
   - **CRITICAL — port data types do not exist.** `IWorkflowNode` has
     exactly one input port (`{key}-in`) and one output port (`{key}-out`)
     per node (`workflow-node.component.ts:28-31`, `:44-49`); there is no
     per-port `dataType`/`kind` field anywhere in `workflow-node.types.ts`.
     The only "multi-port" behavior is `fOutputMultiple` on
     BRANCH/CONDITIONAL nodes, which lets several edges originate from the
     *same* single output connector — still not distinct typed ports.
     Coloring today is keyed by **node type**, not port type: `.is-channel`
     → `var(--green)`, `.is-branch` → `var(--purple)`, `.is-conditional` →
     `var(--orange)` (`workflow-node.component.ts:70-78`, CSS classes bound
     at `:21-24`). The design mock (`Rediseño Terminal.dc.html:1548-1549`)
     matches this exact pattern: `KIND_STRIPE = { channel: "var(--green)",
     conditional: "var(--yellow)", agent: "var(--purple)" }`, applied to the
     node border/icon tint **and** to the small port-dot's stroke color
     (`bn.stripe` used for both, `:379-390`) — i.e. the mock also colors by
     node kind, with **no dedicated "other" node kinds** (`jsFunction`,
     `endpointCall`, `mcpCall`, `serviceCall`, `serviceBusCall`) getting a
     distinct color; they fall through to `KIND_STRIPE[n.kind] ||
     "var(--line3)"` (grey). **Decision 4 as worded ("port colors map by
     port data type") does not match either the current domain model or the
     visual contract — there is no port-level type to map. The human
     decision to confirm after T01 should be: color by `EWorkflowNodeType`
     (7 real values + BRANCH/CONDITIONAL), following the existing
     `KIND_STRIPE`-style mapping, not a new port-type system.**
   - `domain/workflow-node-defaults.ts` — `DEFAULT_NODE_MAP` gives each
     `EWorkflowNodeType` a `name`, `icon` (Material icon name), `group`
     (palette grouping: "Channels", "Logic", "Integrations", "AI", "Flow
     Control"), and default `configuration` (`:23-111`). `createNodeFromDefault`
     (`:115-128`) is the factory used both by the palette (new node) and by
     `flow-deserializer.ts` (reconstructing nodes from saved actions).

3. **Save path — `domain/flow-serializer.ts` + `flow-deserializer.ts` +
   `services/workflow-api.service.ts`**
   - `serializeFlow(flow)` (`flow-serializer.ts:33-73`) walks the graph from
     the inbound Channel node (or first root node) and emits `{ name,
     application, actions, trigger }`; `actions` is a linear array with
     nested branch/conditional actions holding named path arrays
     (`branchToAction`/`conditionalToAction`, `:293-448`).
     `WorkflowBuilderComponent.performSave()` sends exactly `{ name,
     application, actions, trigger }` to `WorkflowApiService.create/update`
     (`workflow-builder.component.ts:748-758`) — canvas `position` and
     internal `key`s are **not persisted**; the backend payload has no
     visual layout information at all.
   - `deserializeFlow(dto)` (`flow-deserializer.ts:24-76`) rebuilds nodes
     from `actions`/`trigger`, assigning **fresh, deterministic X/Y grid
     positions** (`X_START/X_GAP/Y_BASE/Y_BRANCH_GAP`, `:9-12`) and
     **fresh node keys** (`createNodeFromDefault` uses
     `` `node-${Date.now()}-${nextId++}` ``, `workflow-node-defaults.ts:121`)
     — node keys and connection keys are **never stable across a
     deserialize cycle** (they embed `Date.now()`).
   - **"Byte-compatible round-trip" (open → serialize without edits ==
     identical payload) is NOT guaranteed to be literally byte-identical
     today, for two independent reasons that any T03 round-trip test must
     account for:**
     1. `nodeToAction` (`flow-serializer.ts:450-551`) and
        `deserializeFlow`'s `args` merge onto `defaults.configuration`
        (`flow-deserializer.ts:263-268`) build the `configuration`/`args`
        object key-by-key in **fixed source-code order**, not by preserving
        the original payload's key order. If the original saved JSON had a
        different key order for a node's `args` (e.g. hand-crafted or from
        an older payload shape), a strict `JSON.stringify` string-equality
        check will fail even though the two objects are deep-equal. A
        round-trip test must compare **parsed/deep-equal** objects, not raw
        strings, unless the existing spec suite already normalizes key
        order (no evidence found that it does —
        `domain/__tests__/flow-serializer.spec.ts` and
        `flow-deserializer.spec.ts` were not inspected key-by-key here but
        should be re-checked in T03).
     2. Fields set to `undefined` in the serializer (e.g. `text:
        node.configuration["text"] ?? undefined`,
        `flow-serializer.ts:462`) are dropped by `JSON.stringify` but may
        differ from a persisted payload that has the key explicitly
        present with `null`, producing a shape difference on fields the
        UI never touched. `branch.emptyBranchFlags`/positions are
        similarly reconstructed heuristically
        (`flow-serializer.ts:302-345` comment block) from graph topology
        and are **not guaranteed to reproduce the exact original array
        order** if the original payload's branch order doesn't match the
        edge-creation order assumed by the walk.
   - **Conclusion: round-trip identity holds at the deep-equal/semantic
     level by construction (same input state -> same deterministic walk),
     but is not proven byte-identical against arbitrary saved-JSON
     ordering; T03's round-trip test should assert deep equality on the
     parsed `{name, application, actions, trigger}` object, and any
     T03 work must not touch `flow-serializer.ts`/`flow-deserializer.ts`
     per the out-of-scope constraint — if a real ordering mismatch is
     found, that is a finding to report, not a fix to attempt in T03.**

4. **Validation — `domain/validation/`**
   - `workflow.validator.ts` (`validateWorkflow`, `:41-91`) orchestrates:
     top-level name/application length rules (`validateTopLevel`,
     `:236-270`), graph structure via `graph.validator.ts`
     (`validateGraph`), trigger presence/connectivity
     (`validateTriggerPresence`, `:101-137`), trigger field validation via
     `trigger.validator.ts` (`validateTrigger`) plus
     `validateInboundDirectExtras` (mode required, `:144-157`), per-node
     validation via `action-validators.ts` (`validateAction`) for every
     non-inbound node, channel-direction requiredness
     (`validateChannelDirection`, `:220-234`), a **warning** (never
     blocking) when an outbound channel's account isn't among the
     trigger's `accountIds` (`validateOutboundAccountAgainstTrigger`,
     `:181-213`), branch/conditional-specific rules (`BRANCH_EMPTY`,
     `CONDITIONAL_NO_BRANCHES`, per-branch label/condition/comparator/value
     checks against `VALID_COMPARATORS`/`VALID_VARIABLE_PREFIXES`,
     `:346-464`), and a final `EMPTY_ACTIONS` check after serialization
     (`:81-88`). None of these rules are to be changed per the SPEC's
     constraints — confirmed no code path here needs touching for T02-T05.

5. **Full-bleed mechanism — `app.routes.ts` `data.subNavCollapsed` +
   shell/sub-nav**
   - `app.routes.ts` sets `data: { subNavCollapsed: true }` on three routes
     (`:149`, `:172`, `:327` — the workflow builder routes, old and new
     nesting). `layout/shell/shell.component.ts` walks the activated route
     tree for the deepest `data.subNavCollapsed` boolean
     (`readCollapsedFlag`, `:27-38`) and feeds it to `<app-sub-nav
     [collapsed]="subNavCollapsed()">` (`:60-64`, computed at `:135-139`).
   - **`ShellComponent`'s template always renders `<app-header
     (toggleSidebar)…/>` unconditionally** (`shell.component.ts:48`) — the
     existing mechanism collapses/hides the **sub-nav only**; it has no
     effect on the top header bar. **This is a genuine gap against decision
     3's literal wording** ("hides the console sidebar/topbar"): today
     nothing hides the topbar for full-bleed.
   - **However, the design ground truth (screenshot `11-builder.png` and
     the mock's `showRail: !isBuilder`, `Rediseño Terminal.dc.html:1801`)
     contradicts decision 3's own wording**: the Builder screenshot clearly
     still shows the full app header (workspace breadcrumb "Y / acme-latam
     / Processes" + the `Overview / Channels / Connections / AI / Processes
     / Settings` tab row) at the top — only the **left sub-rail**
     (Workflows / Schedules / Trace) is hidden, with the floating toolbar
     (back, name, save-state, view-segmented, run-test, publish) rendered
     *inside* the canvas area below the real header. **This is a
     human-boundary conflict to flag, not silently resolve: decision 3's
     text says "hides console sidebar/topbar" but the binding visual
     contract (decision 1, which takes precedence per the SPEC's own
     ordering) only hides the sub-nav, not the topbar.** T03 should hide
     only the sub-nav (extending the existing `subNavCollapsed` mechanism,
     as the prior-art note already directs) and add the floating chrome
     inside the canvas — not add new topbar-hiding logic — unless the human
     explicitly overrides the screenshot after reading this finding.

6. **Run-data availability for per-node mini-stats (decision 5) —
   FLAG: NO-DATA at the per-NODE level; per-WORKFLOW 7d run counts EXIST
   but are unwired in admin-console.**
   - **Per-workflow (not per-node), corrected**: a real 7-day-windowed
     per-workflow run count exists server-side —
     `WorkflowsService.getWorkflowsSummary` →
     `topByExecutionCountLast7d`
     (`services/workflow-service/src/modules/workflows/workflows.service.ts:668-719`),
     exposed at `GET /workflows/summary`
     (`workflows.controller.ts:82-85`, proxied at
     `services/api-gateway/src/modules/workflows/workflows.controller.ts:120-127`).
     Admin-console's `WorkflowApiService` does not call this endpoint yet
     (only `getExecutionCounts()`, `workflow-api.service.ts:192-196`, which
     is the older tenant-wide, all-time, unwindowed
     `definitionId -> count` map backed by
     `getExecutionCountsByTenant`/`countExecutionsGroupedByDefinition`,
     `workflow-service/.../workflows.service.ts:631-642`). This is a
     wiring gap, not a missing backend feature — see finding 1's
     correction.
   - **Per-node aggregate (decision 5's actual ask): still NO-DATA,
     conclusion unchanged.** Nothing in `getWorkflowsSummary` or
     elsewhere breaks execution counts down by node — `ITopDefinitionRow`
     (`executions.repository.interface.ts:40-45`) is per-definition only,
     with no node-level dimension.
   - Per-execution (single run) detail: `getExecutionDetail(definitionId,
     executionId)` (`workflow-api.service.ts:204-211`) returns
     `IWorkflowExecutionDetail` with `result.results: Record<string,
     unknown>` keyed by **node name** (not node key) and an optional
     top-level `failure.activityName` (`:70-88`) — this is per-single-run
     step data, consumed today by `workflow-run-detail.component.ts`'s step
     list (kind: ok/fail/skip/run, `:19-26`), not an aggregate.
   - **There is no endpoint or service that aggregates run-count/error-rate
     per node across many executions.** Building it client-side would
     require paging through `listExecutions` (`workflow-api.service.ts:174-186`)
     and calling `getExecutionDetail` for every execution of every
     workflow — an N+1 pattern explicitly called out as expensive in the
     service's own doc comment (`:198-203`, "Triggers a Temporal `describe +
     result` round-trip… callers should cache the response per
     `executionId`"). **Per decision 5's own instruction, this is recorded
     here as a finding: per-node mini-stats (runs, error rate) have no
     backing data source today; T04 must ship the stats badge in a
     "hidden when no run data" state (already anticipated in T04's
     acceptance criteria) rather than inventing a new endpoint.**

7. **Design ground truth — `Rediseño Terminal.dc.html` (Builder +
   Workflows/Processes sections) + screenshots 10-11**
   - Workflows list markup (`:334-358`): columns `Nombre / Trigger /
     Acciones / Ejecuciones / Creado / Estado`, one flat table, no
     sparkline column and no "needs attention" panel in this specific
     block — the sparkline + needs-attention-panel pattern used for the
     goal's "inventory table with run sparklines and health" instead
     appears in the **Channels** fleet table a few hundred lines earlier
     (`:280-300`, `spark`/`sparkColor` SVG polyline per row) and the
     **Necesita atención** panel (`:301-319`) — i.e. the Workflows section
     in this particular mock revision is the plainer table, while the
     *Channels* section shows the fuller "inventory + sparkline + attention
     panel" pattern the SPEC goal describes. T02 should mirror the
     Channels-style inventory pattern (sparkline + needs-attention), not
     literally copy the plainer Workflows table block, per the SPEC goal's
     explicit ask for "run sparklines and health" + "needs-attention
     panel" — this is a T02 implementation note, not a blocker.
   - Screenshot `10-workflows.png` confirms the plain-table list (no
     sparkline visible) — consistent with the html above; screenshot
     `11-builder.png` confirms the full-bleed canvas with the app header
     still visible (see finding 5) and the floating toolbar/dock/zoom/
     minimap/inspector as described.
   - Builder node structure (`:378-392`, `BUILDER_NODES` mock array at
     `:1434-1455`): each node has `id, name, tag (TRIGGER/IF/AGENT/null),
     icon, x, y, kind (channel/conditional/agent), summary (one-line config
     recap), stat1, stat2, ok` — `stat1`/`stat2`/`ok` are the per-node
     mini-stats slots (e.g. `"1,842 runs"`, `"24h: 312"`, `"● ok"`) rendered
     in a footer row inside the node card (`:387-389`); this is the mini-stats
     UI slot T04 must fill, gated by finding 6's NO-DATA conclusion.
   - Edge labels are static strings positioned by absolute `left/top`
     pixel coordinates next to hand-drawn SVG bezier paths (`:369-376`), not
     derived from a `conn.label` field (see finding 2 — no such data
     exists to derive from).
   - Port dot color = `bn.stripe` = `KIND_STRIPE[n.kind]` (finding 2),
     confirmed at both port ends (`:380`, `:390`) and the node's left
     border/icon tint.
   - Floating inspector (`:461-491`): tabbed panel with `Config / Output /
     Runs` tabs (only `Config` implemented in the mock's static fields);
     `Config` shows a `Name` input plus `bSelFields` (label/value/select
     rows) and a hint line; footer shows node id + a `Remove` button. This
     maps directly onto the **existing** `WorkflowNodeConfigComponent`'s
     field set — T05 replaces its container/positioning only.

8. **Prior-art corrections:**
   - The prior-art note in this SPEC does not name
     `core/services/metrics/processes-metrics.service.ts` (the actual
     `topWorkflows`/`successRate` fake-data source) — worth an explicit
     mention if T02 touches fleet metrics, since it's a `core/` service
     shared across the section landing, not inside
     `features/processes/` or `features/automation/workflows/`.
   - No other prior-art claims in this SPEC were found to be factually
     wrong; the `app.routes.ts` / `subNavCollapsed` claim is accurate as a
     *mechanism* description but the SPEC's own decision 3 wording
     ("hides console sidebar/topbar") overstates what that mechanism does
     and conflicts with the binding screenshot — see finding 5.

### T02 — Workflow list view

- Rebuild the list: fleet MetricCard row, InventoryTable (health dot, run
  sparkline, last run, status), NeedsAttentionPanel of failing workflows.
- Unit tests: row mapping, empty state, row click → builder route.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Full-bleed builder shell + re-skin

- Full-bleed route treatment per decision 3; restyle canvas surface, nodes,
  edges with tokens; floating chrome (back, name, save state, zoom).
- DO NOT touch graph logic, save path, or validation.
- Unit tests: shell hides on builder route and restores on exit; open→save
  round-trip payload identity (constraint above).

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Ports, edge labels, mini-stats

- Colored ports per the T01-confirmed mapping (decision 4), edge labels from
  existing edge metadata, per-node mini-stats badges (decision 5).
- Unit tests: type→color mapping table, unknown type fallback, stats badge
  hidden when no run data.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T05 — Floating inspector

- Replace the current node-edit surface with the floating inspector panel of
  the contract: opens on node select, edits the same fields via the EXISTING
  form logic, closes on canvas click/Esc.
- Unit tests: open/close behavior, field edits reach the model identically to
  the old surface, keyboard dismissal.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T06 — Docs + index

- Update `services/admin-console/README.md` (builder architecture notes), add entry to
  `cowork/INDEX.md`, log the port-color mapping and full-bleed decision to
  Engram topic 'admin-console/redesign-processes-builder'.

**Accept**
```
grep -n "console-redesign-processes-builder" cowork/INDEX.md
```

---

- [x] T01 inventory report
- [x] T02 workflow list view
- [x] T03 full-bleed shell + re-skin
- [x] T04 ports, labels, mini-stats
- [x] T05 floating inspector
- [ ] T06 docs + index

## Out of scope (explicit)

- Replacing the graph/canvas engine — re-skin only (decision 2).
- Workflow schema, validation, or execution changes.
- Trace views — that's `console-redesign-trace.md` (L6).
- Multiplayer/collaboration features.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Port type→color mapping confirmed by the human after T01.
- Deviating from the binding visual contract requires human sign-off.
