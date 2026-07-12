# SPEC — Workflow run view (instance execution view in the admin console)

> Task queue for the `/manual-loop` command.
> DEPENDS ON: `manual-loops/workflow-step-events.md` (archived/committed) and the
> trace-console chain endpoint (shipped). Payload bodies in the popup depend on
> `manual-loops/payload-capture.md` (degrade gracefully if not shipped yet).
> Origin: user decisions 2026-07-11. Engram topic: `tracking/run-view`.
> **BINDING VISUAL CONTRACT: `cowork/DESIGN-run-view.md` + `cowork/DESIGN-run-view.html`**
> — reviewers judge every UI task against it.

## Goal

A per-run instance view (Temporal-UI-like, platform vocabulary) in the admin
console: header chips, cast strip, vertical equally-spaced flow (linear segments
with full req/resp arrows; branched segments with collapsed `↔` chips), anchored
popup on step click with peek sub-views and deep links to the real feature pages.

## User decisions (human boundary — do not reinterpret)

1. Layout: equally-spaced steps (NOT time-scaled); time lives in labels +
   critical path. Popup anchored to the clicked step — the page never scrolls
   to show detail.
2. Entries: BOTH — (a) Workflows → detail → Executions → run row click,
   (b) "Run view" tab in `processes/trace/:correlationId` when the chain
   contains a workflow run.
3. Popup buttons: peek sub-views INSIDE the popup (connector profile, recent
   calls, agent profile/runs, channel account, definition) + "Open in <feature>"
   deep-links that navigate to the existing console pages (Connectors shows
   cache config/hit-rate, Agents, Channels, Workflow builder). Peeks QUOTE
   existing feature data; they never duplicate screens.
4. Plan-vs-executed from day one: definition join shows not-executed branches
   dashed with case labels.
5. Console UI strings in English. Colors per contract: gray platform, amber
   decisions, purple agent, teal channel.

## Constraints (apply to every task)

- Binding styles: ingester = pure functions/`Bun.serve` (as trace-console);
  console = standalone/signals/OnPush/inline-SVG (sparkline pattern), NO chart
  libs; gateway = explicit proxy modules.
- The flow renderer is PURE: `(chain, spans, definition) → layout model` in
  domain functions with exhaustive unit tests; components only bind the model.
  All branch/fork/if geometry decisions live there, testable without DOM.
- Graceful degradation is a FEATURE, tested: runs older than step-events deploy
  render the artifact-only spine with a banner ("step detail unavailable for
  this run"); payload sections show the payload-capture states (locked /
  unavailable) when that queue hasn't shipped.
- Deep links use the console's existing routes (implementer verifies exact
  paths from `app.routes.ts`); popup peeks call existing feature services —
  no new backend surface for peeks.
- Verbose logging; tests with behavior; never weaken existing tests.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
G1  cd services/tracking-ingester-service && bun test
G2  cd services/tracking-ingester-service && bunx tsc -p tsconfig.json --noEmit
G3  cd services/api-gateway && bun test
G4  cd services/admin-console && pnpm test
G5a ITERATION — as in manual-loops/trace-console.md.
G5b COMMIT GATE — as in manual-loops/trace-console.md.
```

Gate rules: identical to `manual-loops/trace-console.md` (validator green,
full suites, built-image commits).

---

## Task queue

### T01 — Run chain endpoint in the ingester

- `GET /runs/:workflowId/:runId` (tenant header): events filtered by
  `workflow_id`/`run_id` columns + their spans + summary
  `{ status, started_at, completed_at, total_ms, steps_ok, steps_failed }` +
  `cast`: distinct instances `{ kind: connector|agent|channel|tool, name, id,
  count }` aggregated from `connector_id`, `transport.agent_id`, channel fields.
- Pure functions in `src/lib/` (query builders + shaping), same pattern as the
  chains endpoint. 404 when run unknown.
- Unit tests: shaping, cast aggregation, runs with zero step events (pre-deploy
  runs) return `step_detail: false`.

**Accept**
```
cd services/tracking-ingester-service && bun test
```

### T02 — Gateway proxy + console data service

- Gateway: `GET tracking/runs/:workflowId/:runId` in the existing tracking
  module. Controller tests.
- Console: `core/services/run-view.service.ts` — `getRun(workflowId, runId)`
  typed to T01's shape + `getDefinition(workflowId, version)` via the existing
  `WorkflowApiService`. Unit tests.

**Accept**
```
cd services/api-gateway && bun test
cd services/admin-console && pnpm test
```

### T03 — Domain: run layout model (the hard pure core)

`features/processes/run-view/domain/` pure functions:

- `merge-run.ts`: (events, spans, definition) → step tree: executed steps with
  timing/status/instance, definition-only steps marked `not_executed` with
  branch labels, condition steps with `{expression, evaluated_value,
  branch_taken}` from condition_evaluated events.
- `layout-run.ts`: step tree → geometry model per the visual contract: linear
  segments (spine + artifact lane), fork segments (2-3 lanes, collapse to
  summary beyond), join nodes with waited-branch + critical path (max branch
  span), bypass edges for false-if-without-else, nesting indentation.
- Exhaustive vitest specs: every pattern in `cowork/DESIGN-run-view.md`
  §Flow semantics gets a fixture and asserted geometry/semantics — linear,
  3-case condition, taken/not-taken, nested if, parallel fork, critical path
  selection, bypass, degraded (no step events).

**Accept**
```
cd services/admin-console && pnpm test
```

### T04 — Flow component (SVG) + header + cast strip

- `run-view.component.ts` (standalone, OnPush): renders the layout model as
  inline SVG (sparkline pattern: geometry in `computed()`, `[attr.*]`
  bindings). Header chips + cast strip per contract; cast chip click toggles
  highlight of that instance's steps.
- Colors/edges/labels per contract (solid/dashed/thick semantics, amber
  decisions, `↔` chips in branched segments).
- Component tests over the T03 fixtures: rendered node/edge counts, highlight
  toggle, degraded banner.

**Accept**
```
cd services/admin-console && pnpm test
```

### T05 — Anchored popup with peek sub-views + deep links

- Popup anchored to clicked step (side by position, clamped, overlay click /
  Escape closes; never scrolls the page). Internal navigation stack with back
  arrow.
- Step detail per contract (identity, rows, events pair, req/resp with
  payload-capture states). Peek sub-views: connector profile + recent calls,
  agent profile + recent runs, channel account, workflow definition — data via
  EXISTING console feature services; each peek footer has "Open in <feature>"
  deep-link (routerLink to the real page, e.g. connector detail where cache
  status lives).
- Accessibility: focus trap in popup, `aria` roles, keyboard close.
- Component tests: open/anchor-side/close, sub-view navigation + back, deep
  link hrefs, payload states.

**Accept**
```
cd services/admin-console && pnpm test
```

### T06 — Entries wiring

- Workflows → detail → Executions list: row click navigates to
  `processes/runs/:workflowId/:runId` (new lazy route hosting run-view).
- Trace detail: "Run view" tab appears when the chain contains workflow run
  ids; tab embeds the same component with the run resolved from the chain.
- Nav/back behavior + breadcrumbs consistent with console patterns.
- Component/router tests for both entries.

**Accept**
```
cd services/admin-console && pnpm test
```

### T07 — Cluster e2e

Extend `scripts/e2e-http-workflow.sh`: after the chain stage, call
`GET /tracking/runs/<wfId>/<runId>` via the gateway — assert 200, summary
status `completed`, `steps_ok >= 1`, cast contains the http channel account,
and at least one step span `duration_ms > 0` (guaranteed by workflow-step-events).

**Accept**
```
./rebuild-redeploy.sh tracking-ingester-service dev
./rebuild-redeploy.sh api-gateway dev
./rebuild-redeploy.sh admin-console dev
./scripts/e2e-http-workflow.sh
```

### T08 — Docs + index

- `DOCS/guides/trace-console.md`: run view section (what it answers vs causal
  graph/waterfall), entries, degraded modes.
- `services/tracking-ingester-service/README.md`: runs endpoint.
- `cowork/INDEX.md` entry + decision cuádruple (engram topic `tracking/run-view`).

**Accept**
```
grep -n "runs/:workflowId" services/tracking-ingester-service/README.md
grep -n "run-view\|Run view" DOCS/guides/trace-console.md cowork/INDEX.md
```

---

## Progress

- [x] T01 run chain endpoint
- [x] T02 gateway proxy + console service
- [x] T03 domain layout model (pure core)
- [ ] T04 flow component + header + cast
- [ ] T05 anchored popup + peeks + deep links
- [ ] T06 entries wiring
- [ ] T07 cluster e2e
- [ ] T08 docs + index

## Out of scope (explicit)

- Live/streaming updates while a run executes (view is read-after-the-fact;
  live mode is a future queue).
- Editing anything from this view (read-only; actions live in their features).
- Gantt/time-scaled layout (decision 1).
- Payload capture/viewer internals (own queue; this view only consumes its
  states).

## Human boundaries for this change

- Approving this SPEC before the first run.
- Any deviation from the visual contract (`cowork/DESIGN-run-view.md`) — the
  loop escalates instead of improvising.
- The lane cap for forks (>3 branches collapse) if real definitions exceed it.
