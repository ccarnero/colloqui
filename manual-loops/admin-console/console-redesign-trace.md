# SPEC — Console redesign: Trace views (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-processes-builder.md` (done N/N —
> trace lives inside the Processes section; degrade gracefully only for T01).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-trace'.

## Goal

Workflow traces render in four synchronized views — waterfall, causal graph,
run-view canvas, and step log — with a shared event inspector: selecting an
event in any view opens the inspector (payload, timing, subscribers, deep
links to Temporal and the builder) and highlights that event in the other
three views, per the design contract.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: "Trace" sections (all four views + inspector) of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (+ screenshots).
2. The four views are tabs/modes of ONE trace screen sharing one selection
   state — a single `TraceSelectionService` (signal-based), not per-view state.
3. Inspector content is context-aware: base payload/timing/subscribers
   everywhere, plus timing % in waterfall, step result in run view, causal
   chain in causal graph.
4. Deep links: Temporal link uses the existing run/workflow identifiers;
   builder link opens the builder route focused on the corresponding node.
   Existing identifiers only — no new backend fields.
5. Trace data comes from the existing trace/run endpoints; gaps are findings.
   **ORCHESTRATOR RULING 2026-07-22 (applying the human "design wins" +
   "real data only" precedents signed in earlier loops, post-T01):**
   (a) Tab set follows the design mock: waterfall / causal / legacy / run —
   "step log" is a sub-panel INSIDE the run view, not a fifth tab. The
   legacy tab stays (old screens keep working).
   (b) Inspector renders only fields that exist: payload stays fetch-on-demand
   (existing getEventPayload); subscribers on the new pipeline render the
   consumed_by durable names only (the rich shape is legacy-only — backend
   follow-up); Temporal links render where workflow_id/run_id exist; the
   builder deep link is HIDDEN until a trace-event→builder-node id bridge
   exists (backend/builder follow-up — never synthesized), per the SPEC's
   own "hidden otherwise, never a broken link" rule in T06.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `features/processes/trace/` — `message-trace.component.ts`,
  `trace-detail.component.ts`, `waterfall/trace-waterfall.component.ts` +
  `waterfall-geometry.ts`, `causal-graph/causal-graph.component.ts` +
  geometry + deep-link, `domain/assemble-trace.ts`,
  `message-trace.model.ts`, `find-workflow-runs.ts`, `trace/README.md`.
  REUSE fetching/models; this loop replaces presentation and adds selection
  sync.
- `features/processes/run-view/` — `run-view.component.ts` + page + popup +
  `domain/` (`merge-run.ts`, `layout-run.ts`, `resolve-step-events.ts`,
  `resolve-step-deep-link.ts`, `run-view.model.ts`).
- Services: `core/services/message-trace.service.ts`,
  `tracking-chain.service.ts`, `run-view.service.ts`;
  `features/processes/domain/resolve-entity-deep-link.ts` (deep links).
- `run-view/run-view-render.ts` + `run-view-popup-render.ts` — the run view
  has its OWN renderer (not the builder's); restyle it, do NOT port it to
  @foblex/flow.
- `src/app/shared/components/` — foundation primitives (DetailModal is NOT the
  inspector; the inspector is a docked panel per the contract).

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex.
- Only the processes/trace feature area is touched. No backend changes.
- Selection state lives ONLY in `TraceSelectionService` — a view holding its
  own selected-event state is automatic rejection (decision 2).

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

- Map existing trace/run UI and data: endpoints, event model fields
  (payload, timing, subscribers, causal links, Temporal ids, node ids),
  and the current state of each of the four views (all exist in some form —
  see Prior art). Record "**T01 findings
  (recorded <date>):**" in this SPEC; flag missing fields per view.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-trace.md
```

**T01 findings (recorded 2026-07-22):**

1. **Routes** (`services/admin-console/src/app/app.routes.ts`):
   - `processes/trace` → `MessageTraceComponent` (lines 254-260).
   - `processes/trace/:correlationId` → `TraceDetailComponent` (lines 261-267).
   - `processes/runs/:workflowId/:runId` → `RunViewPageComponent` (lines 278-284);
     `:workflowId` is the **Temporal** workflow id (`{tenantId}:{name}:{nanoid}`),
     not the workflow definition id (route comment, lines 268-277).

2. **Existing views state** (`services/processes/trace/` +
   `features/processes/run-view/`):
   - `TraceDetailComponent` (`trace/trace-detail.component.ts`) is the real
     container for the four-tab UX today: it owns a local `activeTab` signal
     (`TraceViewTab = "waterfall" | "causal" | "legacy" | "run"`, lines 23-34),
     fetches ONE `ITrackingChainResponse` via `TrackingChainService.getChain`
     (lines 139, 174-191) and feeds the SAME `chain` object to
     `TraceWaterfallComponent`/`CausalGraphComponent` (lines 94-100). `"legacy"`
     renders the pre-existing `MessageTraceComponent` unmodified (its OWN
     fetch, a different service/model — see below). `"run"` only appears when
     `findWorkflowRuns(chain.events)` finds a Temporal run in the chain
     (lines 148-163) and renders `RunViewComponent` with no `definitionId`
     (lines 78-86, degrades gracefully per that component's own comment,
     `run-view.component.ts` lines 620-635).
   - **Waterfall** (`trace/waterfall/trace-waterfall.component.ts`): pure
     presentational, `chain` input (line 248), rows/bottleneck computed via
     `waterfall-geometry.ts`. Explicitly documented as having **no
     row-selection/click affordance** — "no `(click)` handler, no
     selected-event state" (component header comment, lines 44-51). Rows are
     positioned by `computeWaterfallRows` (`waterfall-geometry.ts` lines
     125-154), matching each event to a span by `kind_prefix`/`entity_id`
     heuristic (`matchEventSpans`, lines 67-97) — spans carry no `event_id`,
     so the match is best-effort/greedy, not an exact join.
   - **Causal graph** (`trace/causal-graph/causal-graph.component.ts`): `chain`
     input (line 420); OWNS a local `selected` signal (lines 425-426) that
     drives node highlight (`cg-node-selected`, line 150) and an inline detail
     card (`selectedEvent`/`cg-detail`, lines 171-245, 515-521) — this is
     exactly the per-view selection state decision 2 replaces. `select()`
     (lines 531-539) also resets an on-demand payload-fetch state machine
     (`PayloadViewState`, lines 37-43) gated by `tracking:payload:read`
     (`canViewPayload`, lines 428-432) — payload is fetched via
     `TrackingChainService.getEventPayload` (lines 547-575), NEVER pre-loaded
     with the chain. A `deepLink` computed (lines 526-529) resolves an "Open
     connector"/"Open agent" button via `resolveTrackedEventDeepLink`
     (see item 4).
   - **Run-view canvas** (`features/processes/run-view/run-view.component.ts`):
     fetches its OWN `IRunResponse` via `RunViewService.getRun` (constructor
     effect, lines 678-769) — independent of `TrackingChainService`/the
     chain's events. Renders an SVG spine (`positionedNodes`/`renderedEdges`,
     lines 787-826) plus a right-hand "artifacts" column
     (`artifactBoxes`/`artifactEdges`, lines 828-859). OWNS local selection
     state: `selected`/`selectedInstanceId` (cast-chip highlight, lines
     651-652, 892-897) AND `selectedNodeSignal`/`anchorRectSignal` (node-click
     → anchored popup, lines 668-676, 899-936) — two more per-view selection
     signals decision 2 must collapse into `TraceSelectionService`. Node click
     emits `nodeSelected` (output, line 640) and opens
     `RunViewPopupComponent` (T05's existing per-node detail popup, template
     lines 317-325) — this popup is presentation-layer state to migrate into
     the shared inspector, not reused as-is (constraint: selection state lives
     ONLY in `TraceSelectionService`).
   - **Step log**: NO dedicated component/file exists. See item 5.

3. **Event model fields** (`core/services/tracking-chain.service.ts`
   `ITrackedEvent`, lines 11-38, and `core/services/run-view.service.ts`
   `IRunEvent extends ITrackedEvent`, lines 33-58):
   - **Base payload**: **MISSING on the chain/waterfall/causal-graph event
     row.** `ITrackedEvent` carries no payload field at all (lines 11-38).
     The causal graph fetches it separately, on demand, per selected event,
     via `TrackingChainService.getEventPayload`
     (`tracking-chain.service.ts` lines 107-114; wired in
     `causal-graph.component.ts` lines 547-575) — gated by
     `tracking:payload:read` and can 404 (not captured)/410 (scrubbed). This
     is a real, working data source for the inspector's payload
     content, but it is a SEPARATE fetch, not a field on the event —the
     inspector will need to trigger it per-selection, same as the causal
     graph does today, and must handle the same not-captured/expired states.
     `IRunEvent`/run-view carries no payload access at all today (no
     `getEventPayload`-equivalent wired into `RunViewService`) — **FLAG:
     run-view has no payload-fetch path; T06 needs to either add one or
     route run-view selections through the same
     `TrackingChainService.getEventPayload` by `correlation_id`/`event_id`
     (both available on `IRunEvent` via inherited fields).**
   - **Timing (start/end/duration)**: present, but INDIRECT. `ITrackedEvent`
     has `occurred_at` (a single instant, line 22) — no `duration`/`end` on
     the event row itself. Duration comes from `ITrackedEventSpan` (`kind_prefix`,
     `entity_id`, `started_at`, `completed_at`, `duration_ms` — lines 40-46),
     matched to an event by the best-effort heuristic in
     `waterfall-geometry.ts` (item 2). This is workable for the waterfall's
     existing timing-% chip (`computeBottleneck`, lines 156-179) but the
     match is not guaranteed 1:1 — FLAG for T03/inspector: reuse
     `matchEventSpans`, do not re-derive a second heuristic.
   - **Subscribers**: present as `consumed_by: string[]` (`ITrackedEvent` line
     26) — an array of durable names ONLY. **MISSING the richer
     `{service, durable, role, health}` shape** decision 3's "subscribers
     everywhere" implies — that richer shape (`ITraceSubscriber`,
     `trace/domain/message-trace.model.ts` lines 9-24, with optional
     `IConsumerHealth`) exists ONLY on the legacy tab's `ITraceNode`, built by
     a different pipeline (`message-trace.service.ts` / `assemble-trace.ts`)
     that is NOT wired to `ITrackingChainResponse`/`ITrackedEvent` at all.
     **This is a genuine gap**: the inspector's "subscribers everywhere"
     content, if it means service/durable/role/health, has no data source on
     the waterfall/causal/run-view chain today — only a bare consumer-name
     list (`consumed_by`). Human decision needed: ship `consumed_by` as-is
     (list of durable names) or escalate a backend addition (out of scope
     per decision 5/"no new backend fields" and the SPEC's "No backend
     changes" constraint).
   - **Causal links**: present — `causation_id`, `causation_depth`
     (`ITrackedEvent` lines 20-21), consumed by
     `causal-graph-geometry.ts`'s `resolveParentIds`/`buildForest` (lines
     79-204) for the causal-chain tree. Usable as-is for decision 3's "causal
     chain" inspector content in causal-graph mode.
   - **Temporal identifiers**: present but SPARSE — `workflow_id`/`run_id`
     (`ITrackedEvent` lines 29-30) are non-null ONLY on rule-19
     workflow-execution-lifecycle event kinds (`find-workflow-runs.ts`
     header comment, lines 9-26: in practice only `execution_started` carries
     both). Most chain/run events have both fields `null`. The run-view's own
     `IRunResponse` (`run-view.service.ts` lines 90-100) DOES carry
     `workflow_id`/`run_id` at the top level (not per-event), so the run-view
     tab always has them; the waterfall/causal tabs only have them on the
     rare qualifying event.
   - **Builder node ids**: **MISSING entirely.** No field on `ITrackedEvent`/
     `IRunEvent` identifies a builder-canvas node. `ILayoutNode.id`
     (`run-view/domain/run-view.model.ts` lines 227-291) is a SYNTHETIC id
     encoding `(branchPath, actionIndex)` within the RUN's own step tree
     (`resolve-step-events.ts` `parseNodeId`, lines 54-73) — it is not, and
     was never designed to be, a builder-canvas node id. The workflow builder
     (`features/automation/workflows/builder/workflow-builder.component.ts`)
     was not found to accept any node-focus route/query param (no
     `queryParam`/`focus` handling found in that file) — **FLAG for T06**:
     decision 4's "builder link opens the builder route focused on the
     corresponding node" needs either (a) a new client-side mapping from
     `ILayoutNode`'s `(branchPath, actionIndex)` to whatever id the builder's
     `@foblex/flow` canvas assigns its nodes (not currently threaded through
     anywhere), or (b) a human decision to scope the link to "open the
     workflow in the builder" without node focus. This is a real
     ground-truth gap, not a client-side omission — no existing identifier
     bridges the two node-id spaces.

   Content-piece → field mapping required by decision 3, per view:
   - **Base payload/timing/subscribers (everywhere)**: timing OK (via spans,
     item above); payload OK but on-demand-fetch only, and only wired for
     causal graph today (item above — run-view needs new wiring); subscribers
     degraded to a name list only (`consumed_by`) — FLAG above.
   - **Waterfall timing %**: OK — `computeBottleneck`
     (`waterfall-geometry.ts` lines 156-179) already derives `percentOfTotal`
     for the single bottleneck; per-row % is a trivial derivation from the
     same `durationMs`/`chain.summary.total_ms` already computed
     (`waterfall-geometry.ts` lines 125-154).
   - **Run-view step result**: OK — `ActionStatus` (`run-view.model.ts` line
     86: `"ok" | "failed" | "not_executed"`), `IActionStep`/`ILayoutNode`
     carry `status`/`durationMs`/`evaluatedValue`/`branchTaken`, and
     `resolve-step-events.ts` resolves the matched `started`/`completed`
     event refs (`IStepEventPair`, lines 36-39) already consumed by the
     existing T05 popup (`run-view-popup-render.ts`).
   - **Causal chain (causal-graph mode)**: OK — `causation_id`/
     `causation_depth` on every event, already walked into a tree by
     `causal-graph-geometry.ts` (item above).

4. **Deep-link ground truth** (decision 4):
   - **Temporal**: today wired ONLY on the legacy tab —
     `message-trace.component.ts`'s `temporalUrl()` (lines 390-394) builds
     `{temporalUiBaseUrl}/namespaces/{temporalNamespace}/workflows/{temporalWorkflowId}`
     from `ITraceView.temporalWorkflowId` (a field the legacy
     `message-trace.service.ts` pipeline resolves, NOT present on
     `ITrackedEvent`/`IRunResponse`). **The waterfall/causal/run-view tabs
     have NO Temporal link today** — `run-view.component.ts`'s header chips
     (lines 98-132) render `workflow`/`run`/`status`/`duration`/
     `entry-channel`/`correlation` (the last as an internal `routerLink` to
     `/processes/trace/:correlationId`, lines 123-131) but no "Open in
     Temporal" affordance, even though `IRunResponse.workflow_id`/`run_id`
     (the Temporal ids) are available on `run()` — this is buildable with
     existing identifiers (decision 4's constraint is satisfied — no new
     backend fields needed) but does not exist as code yet. Same for
     causal-graph/waterfall: `ITrackedEvent.workflow_id`/`run_id` exist on
     the rare qualifying event (item 3) and could build the same URL pattern
     as the legacy tab's `temporalUrl()`, reusing `environment.temporalUiBaseUrl`/
     `temporalNamespace` (`services/admin-console/src/environments/environment*.ts`,
     documented in `trace/README.md` lines 112-122).
   - **Builder**: `causal-graph/causal-graph-deep-link.ts`
     (`resolveTrackedEventDeepLink`) and
     `run-view/domain/resolve-step-deep-link.ts` (`resolveStepDeepLink`) both
     route through the shared `features/processes/domain/resolve-entity-deep-link.ts`
     (`resolveEntityDeepLink`, lines 74-100) — but that function ONLY maps
     `connector.endpoint_call.completed.v1` → `/connections/http/:id` and
     agent-execution events → `/ai/agents/:id`. **Neither existing deep-link
     path opens the BUILDER at all** — there is no "open workflow in
     builder, focused on node X" mapping anywhere in the codebase today (see
     item 3's builder-node-id gap). `causal-graph-deep-link.ts`'s own header
     comment (lines 6-16) additionally documents that the connector mapping
     is the ONLY one it can ever resolve (agent id is not extracted onto
     `ITrackedEvent` by the ingester for rule-6 agent-execution kinds), and
     `resolve-entity-deep-link.ts`'s header (lines 24-37) documents MCP calls
     and hosted `serviceCall` as verified-absent (no tracked-event exists to
     link from). **FLAG for T06**: the builder deep link decision 4 asks for
     is new work end-to-end (no existing "open builder + focus node" route,
     no existing node-id bridge), not a wiring task over existing pieces.

5. **Step log**: **does not exist as a component today.** No
   `step-log`/`step-log.component.ts` file exists under `trace/` or
   `run-view/` (confirmed via directory listing — only `waterfall/`,
   `causal-graph/`, `run-view/` subtrees exist). The DESIGN mock (item 6)
   renders a "Step log" panel, but it sits INSIDE the "Run view" tab, below
   the run canvas (`Rediseño Terminal.dc.html` lines 932-943), not as its own
   tab — see item 6's tab-count discrepancy. If built, its data source is the
   run's own `IRunEvent[]` (`run-view.service.ts` `IRunResponse.events`,
   already fetched by `RunViewComponent`) — ordered by `occurred_at`, the
   same event population `resolve-step-events.ts` already indexes by
   `(branchPath, actionIndex)`. No NEW fetch is needed; a step-log view can
   reuse the already-loaded `IRunResponse`/`IRunLayout` from
   `RunViewComponent` (or be built from `ITrackedEvent[]`/chain data if the
   product intent is a chain-wide log rather than a run-scoped one — the
   design mock's step names, e.g. `trigger.matched`/`router.evaluate`/
   `agent.invoke`/`channel.send`/`provider.confirmed`
   (`15-trace-step-log.png`), read as RUN-scoped, matching `IRunEvent` kinds,
   not raw chain event kinds).

6. **Design ground truth** (`manual-loops/admin-console/design/Rediseño Terminal.dc.html`,
   Trace section lines 683-1023; screenshots 12-16):
   - Tab bar is driven by `traceTabs = ["waterfall", "causal", "legacy",
     "run"]` (mock script, lines 1481-1483) — **FOUR tabs, but NOT the SPEC's
     four target views.** The mock's four are `waterfall`/`causal`/`legacy`/
     `run`; the SPEC's Goal section names `waterfall`/`causal graph`/
     `run-view`/`step log`. **"Step log" is not a tab in the binding visual
     contract** — it is a panel embedded in the `run` tab (lines 932-943,
     confirmed by screenshot `15-trace-step-log.png` showing the identical
     `Trace` sub-nav/`run` selection as `14-trace-run-view.png`, just scrolled
     down to the step-log panel). **"Legacy" IS a tab in the mock** but is
     not named anywhere in the SPEC's Goal/decisions. This is a real
     discrepancy between the SPEC text and its own cited visual contract —
     human sign-off needed on whether T02's tab set should be
     `waterfall/causal/run` (with step log as a run-view sub-panel, matching
     the mock exactly) or a literal fifth "step log" tab (deviating from the
     mock), and whether "legacy" survives as a fifth/fourth tab.
   - Waterfall mock (lines 730-773): grid with a time-axis header (0/25%/50%/
     75%/end offsets, lines 734-743), rows with `onClick` (line 747) — **the
     mock's waterfall IS clickable**, unlike the current
     `TraceWaterfallComponent` (item 2's "no click handler" finding) — T03
     must ADD the click affordance the mock has and the current component
     explicitly lacks.
   - Causal graph mock (lines 776-826): static SVG nodes with `onClick`
     handlers per node (`cgClick0..6`) and a `stroke` binding per node
     (`cgStroke0..6`, e.g. line 788) for selection highlight — matches the
     EXISTING `CausalGraphComponent`'s `cg-node-selected` pattern closely
     (item 2), a smaller lift than waterfall.
   - Run view mock (lines 886-931) + Step log panel (932-943): run header
     card includes `Open in Temporal ↗` and `Abrir en el builder →` links
     (line 895-896) NOT present in the current `RunViewComponent` (item 4's
     Temporal-link gap; item 4's builder-link gap).
   - Inspector mock (lines 949-1020): single shared docked `<aside>` sticky
     panel — event header (kind/service/time), contextual timing block
     (`selShowTiming`, lines 962-969, waterfall-only), contextual step-result
     block (`selShowRunStep`, lines 971-977, run-view-only), the base dl
     (event_id/causation/depth/tech/business_fn/claim_check/compliance/
     subject/stream/persisted, lines 978-989), subscribers list
     (`selSubs`, lines 990-1000, with per-subscriber `service`/`durable`/
     `role`/`health` — confirms item 3's finding that today's `consumed_by`
     string array is NOT sufficient for this mock section), a "View payload"
     toggle (lines 1001-1011, matches the causal graph's EXISTING on-demand
     payload fetch), and Temporal/builder deep-link buttons
     (`selTemporal`, lines 1012-1017). No explicit "causal chain" block is
     rendered in the inspector mock's dl/sections for causal-graph mode
     beyond the `causation`/`depth` dl rows already present for every
     context — decision 3's "causal chain" content may be satisfiable by
     those two existing dl fields alone, or may need a fuller ancestor/
     descendant list; human call, not a code gap.

7. **Selection state today**: NO shared selection exists across views.
   Three independent, view-local selection signals exist today:
   `CausalGraphComponent.selected` (`causal-graph.component.ts` lines
   425-426), `RunViewComponent.selected`/`selectedNodeSignal`
   (`run-view.component.ts` lines 651-652, 673-676), and
   `MessageTraceComponent.selectedId` (legacy tab, `message-trace.component.ts`
   line 265, event-mode search highlight only — not a click-to-select).
   `TraceWaterfallComponent` has NONE (item 2). None of the four
   communicate with each other or with `TraceDetailComponent` — selecting a
   node in the causal graph today has zero effect on the waterfall or
   run-view tabs. T02's `TraceSelectionService` replaces all of these; T03's
   waterfall must ADD selection (it has none to migrate).

8. **Prior-art corrections**:
   - The SPEC's Prior-art list cites `trace/README.md` as validated ground
     truth alongside the waterfall/causal-graph/run-view files. **This is
     inaccurate for those three views.** `trace/README.md` (verified in
     full) documents ONLY the legacy `MessageTraceComponent`/
     `message-trace.service.ts`/`assemble-trace.ts` pipeline — its "Code
     map" section (lines 162-176) lists `domain/message-trace.model.ts`,
     `assemble-trace.ts`, `transport-topology.ts`,
     `core/services/message-trace.service.ts`, and
     `message-trace.component.ts` ONLY. It contains ZERO mentions of
     `TrackingChainService`, `TraceDetailComponent`,
     `TraceWaterfallComponent`, `CausalGraphComponent`,
     `RunViewComponent`, or the `/tracking/chains`/`/tracking/runs` gateway
     endpoints those actually call. The README is accurate and current for
     the "legacy" tab only; it is STALE/silent on the other three views this
     SPEC's T02-T06 will touch. Do not treat it as documenting the
     waterfall/causal/run-view architecture — read the component/service
     files directly (as this report does), not the README, for those.
   - The Prior-art list's `causal-graph/deep-link` file reference should read
     `causal-graph/causal-graph-deep-link.ts` (actual filename;
     `causal-graph-deep-link.ts`, not a `deep-link/` subfolder).
   - Everything else in the Prior-art list (waterfall/causal-graph component
     + geometry files, `assemble-trace.ts`, `message-trace.model.ts`,
     `find-workflow-runs.ts`, run-view's `merge-run.ts`/`layout-run.ts`/
     `resolve-step-events.ts`/`resolve-step-deep-link.ts`, the three named
     services, `resolve-entity-deep-link.ts`, `run-view-render.ts`/
     `run-view-popup-render.ts`) was verified accurate against the actual
     files at the cited paths.

### T02 — Trace screen shell + selection service

- One trace screen with four view tabs; `TraceSelectionService` (selected
  event id + source view, signal-based); inspector panel shell (empty states).
- Unit tests: selection propagates to all views, clearing selection closes
  inspector, service is the single source (no view-local state).

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Waterfall view

- Waterfall per contract: bars by timing, click selects event, selected bar
  highlighted; inspector shows timing % of total (decision 3).
- Unit tests: bar layout math from event timings, timing % computation,
  click→selection wiring.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Step log + causal graph views

- Step log: ordered entries, click selects; inspector adds causal chain in
  causal-graph mode. Causal graph: nodes/edges from causal links, selection
  highlight.
- Unit tests: log ordering, causal chain derivation (linear, branched,
  orphan event), selection sync both ways.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T05 — Run-view canvas

- Read-only run canvas showing node results (status coloring, step badges);
  node click selects the corresponding event; inspector adds step result
  (decision 3). Restyles the existing run-view renderer (Prior art).
- Unit tests: node→event mapping, status coloring, read-only (no edits
  possible), selection sync.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T06 — Inspector deep links

- Temporal + builder deep links per decision 4, rendered for events that
  carry the ids; hidden otherwise (never a broken link).
- Unit tests: link URL construction, missing-id hiding, builder link focuses
  the right node.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T07 — Docs + index

- Update `services/admin-console/README.md` (trace architecture: selection service,
  view contract), add entry to `cowork/INDEX.md`, log decisions to Engram
  topic 'admin-console/redesign-trace'.

**Accept**
```
grep -n "console-redesign-trace" cowork/INDEX.md
```

---

- [x] T01 inventory report
- [x] T02 shell + selection service
- [ ] T03 waterfall
- [ ] T04 step log + causal graph
- [ ] T05 run-view canvas
- [ ] T06 inspector deep links
- [ ] T07 docs + index

## Out of scope (explicit)

- Live/streaming trace updates — loaded traces only, current refresh model.
- Trace retention, search, or comparison features.
- Backend/API changes — existing endpoints only.
- Builder editing from trace views — run canvas is read-only.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Missing event-model fields found at T01 (payload, subscribers, causal
  links) are a human decision — never synthesized client-side.
- Deviating from the binding visual contract requires human sign-off.
