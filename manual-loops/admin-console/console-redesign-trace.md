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

- [ ] T01 inventory report
- [ ] T02 shell + selection service
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
