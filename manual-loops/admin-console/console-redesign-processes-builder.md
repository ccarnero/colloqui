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
4. Port colors map by port data type; the exact type→color mapping is
   confirmed with the human after T01.
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

- [ ] T01 inventory report
- [ ] T02 workflow list view
- [ ] T03 full-bleed shell + re-skin
- [ ] T04 ports, labels, mini-stats
- [ ] T05 floating inspector
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
