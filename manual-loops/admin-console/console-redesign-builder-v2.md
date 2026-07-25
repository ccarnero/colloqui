# SPEC — Console redesign: workflow builder v2 (visual rebuild)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-polish.md` (shipped)
> and the L0–L7 redesign program (`console-redesign-foundation.md` through
> `console-redesign-users-analytics-settings.md`).
> Origin: human rejection 2026-07-25 of the v1 builder redesign attempt
> (commits `f20508e0`, `0a91f13d`) — "horrible, nothing like the mock". Those
> commits shipped technically green (tests, typecheck, build) and were
> rejected on sight. This SPEC exists to prevent a repeat.
> Engram topic: 'admin-console/redesign-builder-v2'.

## Goal

`/workflows/:id/builder` looks like `manual-loops/admin-console/design/11-builder.png`.
Not "uses the same tokens as", not "is inspired by" — a human comparing a live
authenticated screenshot side-by-side with the mock finds no structural or
proportional difference that is not a signed data-gap exclusion.

Concretely, that means: the dark canvas field with its dot grid, node cards
with the mock's exact proportions/typography/paddings (icon chip, title, type
badge, mono config summary line, and a footer stats row reading real
`N runs · p95 · ● ok`), the mock's edge rendering with inline edge labels, the
node palette, and the floating chrome (back/name/save-state pill, validity
pill, Run test / Publish, segmented Editor/Runs/Settings, zoom control).

---

## Binding contract (read before any task)

The contract for this loop is, in precedence order:

1. **`manual-loops/admin-console/design/11-builder.png`** — the visual ground
   truth. If the implementation and this PNG disagree, the PNG wins.
2. **`manual-loops/admin-console/design/builder-v2-reference/`** — the
   machine-readable porting source, extracted verbatim from the builder screen
   of `design/Rediseño Terminal.dc.html`: `tokens.css`, `node-card.html`,
   `node-card.css`, `canvas-layout.html`, `canvas-layout.css`, `NOTES.md`.
   This folder is the SOURCE you port FROM. Values are copied, never invented,
   never "adapted for our stack" without recording why.
3. `design/Rediseño Terminal.dc.html` — the original canvas, consulted only
   when the reference folder is ambiguous or incomplete.

**A change that diverges from (1) and (2) is a rejection regardless of tests
passing.** Green gates are NECESSARY but NOT SUFFICIENT. The acceptance bar is
visual parity, judged from a screenshot of the running authenticated app.

If `builder-v2-reference/` is missing or incomplete when a task starts, that is
a BLOCKER: stop and report it. Do not substitute guesses for the reference.

---

## Lessons from v1 (post-mortem — do not repeat)

The v1 attempt (`f20508e0` agent editor chrome/layout, `0a91f13d` vertical
builder + left palette) passed every gate in the SPEC it ran under and was
rejected by the human on first look. Root causes, both process failures:

1. **The implementing agents iterated visually BLIND.** They never ran
   `services/admin-console/scripts/visual-audit.mjs`, never got past the login
   wall, and therefore never saw a single pixel of what they were shipping.
   Every visual judgement in v1 was inference from code. Inference from code
   cannot detect "the card is too tall, the type ramp is wrong, the canvas
   reads flat".
   → Countermeasure: **T01 exists solely to prove the screenshot loop works
   before one line of styling changes**, and every subsequent visual task
   carries the HARD GATE below.
2. **They applied incremental CSS deltas to the existing Foblex node styles.**
   Nudging paddings/colors on the legacy node component cannot reach the
   mock's holistic look — card proportions, type ramp, chip geometry, canvas
   depth, and edge weight are a *system*, not a set of independent tweaks.
   → Countermeasure: **the strategy below mandates a fresh component ported
   outward from the reference, not a patch inward from the current styles.**

Secondary lessons: "technically green" was reported as done; the report never
included a screenshot, so the human had no way to catch it earlier than merge.
Every task in this loop reports a screenshot path.

---

## Strategy (human boundary — do not reinterpret)

- **Fresh skin, ported outward.** Build a NEW node-card component and a NEW
  canvas skin by porting `builder-v2-reference/` markup + CSS + tokens into the
  builder scope, then mounting them into Foblex as the custom node template and
  canvas/connection styling. Start from the reference's markup structure and
  delete what does not apply — do NOT start from the existing node component
  and edit toward the reference.
- **Foblex stays for graph mechanics.** `@foblex/flow` continues to own
  dragging, connecting, reassigning, zoom/pan, and hit-testing. Only the visual
  skin is replaced wholesale. Rewriting the graph engine is automatic rejection
  (standing L5 decision).
- **Behavior contracts stay frozen.** Routes, node/edge domain model,
  `flow-serializer.ts` / `flow-deserializer.ts`, validation, and the
  byte-compatible save payload do not change. The existing round-trip tests
  must stay green untouched.
- **The old node/canvas styles are deleted, not left dead.** When the new skin
  lands, the superseded styles go with it in the same task.

## PRESERVE list (accepted v1 directions — must survive every task)

These four were reviewed and ACCEPTED by the human. Any task that regresses one
of them is rejected even if it improves parity elsewhere:

1. **Vertical flow orientation** — the graph reads top → bottom, not left →
   right (ports on the top/bottom edges of the card).
2. **Node palette on a left rail** — the palette is a vertical rail on the left
   of the canvas, not the bottom-center dock.
3. **Agent-configure floating chrome** — the floating chrome treatment on the
   agent configure screen stays as shipped.
4. **Agent editor two-column layout** — stays as shipped.

Items 3 and 4 are outside the builder route; they appear here only so that no
task in this loop "cleans them up" while touching shared chrome primitives.

Where the mock (`11-builder.png`, a left→right graph with a bottom dock)
conflicts with PRESERVE items 1 and 2, **PRESERVE wins on orientation and
palette placement; the mock wins on everything else** (card anatomy,
typography, spacing scale, colors, chip/badge geometry, edge weight and
labeling, canvas field, chrome composition). Port the mock's *visual language*
onto the vertical/left-rail *layout*.

## Prior art (REUSE, do not duplicate)

- `services/admin-console/scripts/visual-audit.mjs` — the authenticated
  Playwright screenshot harness promoted in `console-redesign-polish.md` T01.
  It logs itself in and screenshots a list of routes. USE IT. Do not write a
  new screenshot script.
- `manual-loops/admin-console/audit/before/` and `audit/after/` — the existing
  audit layout convention. This loop writes to
  `audit/builder-v2/before/` and `audit/builder-v2/after/`.
- `features/automation/workflows/builder/` — `workflow-builder.component.ts`,
  `builder/components/`, `domain/flow-serializer.ts`, `flow-deserializer.ts`,
  `workflow-node.types.ts`, `workflow-node-defaults.ts`, `validation/`,
  `services/workflow-api.service.ts`. Engine, save path and validation REUSED.
- `EWorkflowNodeType` → color mapping shipped in L5 T04 (KIND_STRIPE-equivalent)
  — reuse the mapping; only its rendering changes.
- L5 T01 finding 6 and the polish loop's DATA-GAP catalogue: per-node execution
  stats were recorded as NO-DATA in 2026-07-22. **T06 of this loop re-opens
  that finding on purpose** — the mock shows real per-node stats, so this loop
  is where the data source gets found or the gap gets formally signed off.
- Cluster dev credentials for this loop (human-provided, dev cluster only):
  tenant `acme`, user `yclawd@demo.io`, password `admin123`, host
  `admin-console.platform-services-dev.dev.local`.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex or named colors in component SCSS. Values
  ported from `builder-v2-reference/tokens.css` land as tokens first.
- No behavior changes: presentation-layer only, except T07 which adds a
  read-only stats fetch.
- Only `features/automation/workflows/` (+ the builder-scoped token file) is
  touched, plus `services/workflow-api.service.ts` in T07.
- Saved workflow JSON stays byte-compatible: open → save without edits produces
  an identical payload. The existing round-trip spec must stay green.
- No literal backticks inside template/styles template literals (repo lint hook
  corrupts the file); prefer targeted Edits over full-file rewrites.
- Angular gotchas (empirically proven in L2–L7): `TestBed.overrideProvider` for
  MatDialog; view encapsulation blocks cross-component CSS reuse — the new node
  card owns its styles, do not try to reach into it from the canvas component.

---

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

Gate rules: identical to `console-redesign-foundation.md`. G5a/G5b are COMMIT
GATES (once per task, after the iteration gates are green).

### G6 — VISUAL GATE (HARD GATE, every visual task: T01, T02, T03, T04, T05, T07, T08, T09)

G6 runs AFTER G5b and BEFORE the task is marked done. It is not optional, not
deferrable to the end of the loop, and not satisfiable by reasoning about CSS.

1. Serve the app. Either target works; prefer the local serve for iteration:

```
# Option A — local dev server (default, port 4298)
cd services/admin-console && pnpm exec ng serve --port 4298 --no-open
```

```
# Option B — the deployed dev-cluster console
# BASE_URL=http://admin-console.platform-services-dev.dev.local
```

2. Capture the REAL authenticated builder screen. Replace `<WORKFLOW_ID>` with
   a workflow that has at least 4 nodes including a branch/conditional (list
   one from `/workflows` in the same session):

```
cd services/admin-console && \
  BASE_URL=http://localhost:4298 \
  ADMIN_EMAIL=yclawd@demo.io \
  ADMIN_PASSWORD=admin123 \
  ADMIN_TENANT=acme \
  TARGET_PATHS=/workflows,/workflows/<WORKFLOW_ID>/builder \
  OUT_DIR=manual-loops/admin-console/audit/builder-v2/<taskid> \
  node scripts/visual-audit.mjs
```

Against the cluster, swap `BASE_URL=http://admin-console.platform-services-dev.dev.local`.

The harness (`scripts/visual-audit.mjs`) navigates to `${BASE_URL}/login`,
fills `input[type=email]` / `input[type=password]`, clicks
`button[mat-flat-button]`, waits for the `/dashboard|/overview` redirect, then
for each path in `TARGET_PATHS` navigates, waits 3s, records DOM markers and
writes `<sanitized-path>.png` plus `audit.json` into `OUT_DIR`. It exits
non-zero if login or any path fails.

3. **The implementing agent must OPEN the captured PNG with the Read tool,
   open `design/11-builder.png` with the Read tool, and compare them
   explicitly** — writing, in the task report, what is now closer to the mock
   and what still differs. A task report without both image reads is an
   incomplete task.
4. **A screenshot that does not move toward the mock is a rejection.** Iterate
   inside the task until it does. "The CSS is correct, the screenshot must be
   stale" is not an accepted conclusion — re-serve and re-capture.
5. The captured PNG path(s) go into the task report and to the reviewers.

**Escalation:** if the harness cannot log in or cannot reach the builder route
after two honest attempts, STOP the task and report the blocker. Continuing to
style blind is the exact v1 failure and is an automatic rejection.

### Review

Dual review per house convention: two independent reviewers see the task diff
AND the G6 screenshot path(s), and each returns APPROVED or REJECTED with
concrete objections. Reviewer instructions for this loop:

- Green gates are NECESSARY but NOT SUFFICIENT. Judge the screenshot against
  `design/11-builder.png` first; read the diff second.
- REJECT if the task report contains no screenshot path, or if the screenshot
  shows the legacy look.
- REJECT if the change is an incremental patch on the legacy node/canvas styles
  where the SPEC required a fresh port from `builder-v2-reference/`.
- REJECT if any PRESERVE item regressed.
- REJECT if a value appears as a hard-coded hex/px that exists as a token in
  `builder-v2-reference/tokens.css`.
- REJECT if an existing test was weakened, skipped, or deleted, or if the
  round-trip save spec was modified.

---

## Task queue

### T01 — Screenshot-loop bootstrap + "before" baseline (tooling, no styling)

- Prove the loop works BEFORE any visual change. Bring up the app (local
  `ng serve` on 4298, or the dev-cluster host), and run
  `scripts/visual-audit.mjs` with the credentials above against
  `/workflows` and `/workflows/<WORKFLOW_ID>/builder`.
- If the harness cannot complete login as-is (e.g. the login form requires a
  tenant input for `acme` that the current selector chain does not fill, or the
  post-login redirect pattern differs), extend `visual-audit.mjs` minimally to
  handle it — an optional `ADMIN_TENANT` env var filled into the tenant field
  when present, and nothing else. Keep it backward-compatible with the polish
  loop's invocations. Log every step.
- Pick and RECORD the reference workflow id used for all G6 captures in this
  loop (must have ≥4 nodes including a branch/conditional), so every task
  screenshots the same graph and screenshots are comparable across tasks.
- Commit the baseline captures to
  `manual-loops/admin-console/audit/builder-v2/before/`.
- Record "**T01 findings (recorded <date>):**" in this SPEC: the exact working
  command line, the chosen workflow id, any harness change made, and a numbered
  list of the LAYOUT-level deltas between the "before" screenshot and
  `11-builder.png` (card anatomy, type ramp, spacing, canvas field, edges,
  palette, chrome), each marked FIX (in scope for a named task) /
  DATA-GAP (cite the INDEX entry) / NEW-CAPABILITY (human sign-off needed).
- Also record whether `design/builder-v2-reference/` exists and what files it
  contains; if it is missing, that is a BLOCKER finding and the loop stops here.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-builder-v2.md && ls manual-loops/admin-console/audit/builder-v2/before
```

**T01 findings (recorded 2026-07-25):**

`design/builder-v2-reference/` exists and is complete: `tokens.css`,
`node-card.html`, `node-card.css`, `canvas-layout.html`, `canvas-layout.css`,
`NOTES.md` (all six files present, confirmed via `ls`). Not a blocker.

App served locally via:

```
cd services/admin-console && pnpm exec ng serve --port 4298 --no-open
```

(sandbox note: binding to port 4298 required running outside the default
command sandbox — `EPERM` on `listen ::1:4298` inside the sandbox; ran with
the sandbox override, no other effect on the app or repo).

Exact working G6 command line used for the baseline capture:

```
cd services/admin-console && \
  BASE_URL=http://localhost:4298 \
  ADMIN_EMAIL=yclawd@demo.io \
  ADMIN_PASSWORD=admin123 \
  ADMIN_TENANT=acme \
  TARGET_PATHS=/workflows,/workflows/7DXJQ18-pcbk56XCMtdRt/builder \
  OUT_DIR=manual-loops/admin-console/audit/builder-v2/before \
  node scripts/visual-audit.mjs
```

Login succeeded on the first attempt with `yclawd@demo.io` / `admin123`
without the tenant field ever appearing (`showTenantId` stayed `false` —
the backend resolved the tenant from the credentials alone). **No harness
change was needed or made.** `visual-audit.mjs` is unmodified from the
polish-loop version; `ADMIN_TENANT` was exported per the SPEC's example
invocation but the current harness does not read it and did not need to —
recorded here in case a future login flow starts requiring
`Please provide tenant_id`, at which point the optional-tenant-field
extension described in the task text should be added then, not
speculatively now.

Chosen reference workflow for every G6 capture in this loop:
**`crm-support-telegram`, id `7DXJQ18-pcbk56XCMtdRt`**
(`/workflows/7DXJQ18-pcbk56XCMtdRt/builder`). 11 nodes, confirmed via the
"11 nodes" counter pill and a fit-to-view capture: `Channel` (trigger) →
`searchContact` (HTTP) → `normalizeContact` (JS) → `scoreContact` (SVC) →
`buildAgentContext` (JS) → `supportAgent` (AGENT) → `vipRoute` (IF,
condition `results.buildAgentContext.tier eq vip`) → branches to
`buildEscalationReply` (JS, labelled edge `results.buildAgentContext.tier
eq "vip"`) → `createTicket` (SVC) → `replyEscalated` (CHAN), and the
`default` branch to `replyStandard` (CHAN). Satisfies "≥4 nodes including a
branch/conditional."

Captured files (baseline):
- `manual-loops/admin-console/audit/builder-v2/before/workflows.png`
- `manual-loops/admin-console/audit/builder-v2/before/workflows-7DXJQ18-pcbk56XCMtdRt-builder.png`
- `manual-loops/admin-console/audit/builder-v2/before/audit.json`

Both `workflows-7DXJQ18-pcbk56XCMtdRt-builder.png` (before) and
`design/11-builder.png` (mock) were opened with the Read tool and compared
directly. Numbered layout-level deltas:

1. **Node card anatomy — no footer stats row.** The mock's card has a
   fourth row: `<n> runs`, a secondary metric (`p95:` / `24h:`), and an
   `● ok` status dot. The live card stops after the mono config-summary
   line; there is no footer row at all today. **FIX (T03)** for the row
   structure/markup; the real numbers behind it are **DATA-GAP** — per L5
   T01 finding 6 / polish-loop follow-up, "per-node run-count/error-rate
   mini-stats have no backing aggregate anywhere in the platform
   (`ITopDefinitionRow` is per-definition, not per-node)" (`cowork/INDEX.md`
   line 745). T06 re-opens this; T07 wires it once T06 settles the source.
2. **Icon chip is unfilled.** The mock's leading icon is a solid,
   type-tinted square chip (filled background + icon glyph). The live icon
   is a bare glyph in a thin-border square with no fill/tint. **FIX (T03)**
   — port the reference's chip fill/tint per `node-card.css`.
3. **Type ramp / weight.** Mock title and mono line read denser/crisper
   (tighter letter-spacing on the mono line, heavier title weight) than the
   live card's default Angular Material type stack. **FIX (T02)** — port
   the reference's font stacks, sizes, and weights as tokens before T03
   consumes them.
4. **Card padding/proportions.** Live cards are visually taller/looser than
   the mock's tighter card box, most evident once the (missing) footer row
   is accounted for. **FIX (T03)** — port `node-card.css` spacing values as
   tokens, not eyeballed.
5. **Canvas field has no dot grid.** The mock's canvas background shows a
   visible dot-grid texture; the live canvas is flat solid dark with no
   texture. **FIX (T04)**.
6. **Edge waypoint markers are denser than the mock.** Both mock and live
   already share the same structural approach — dashed curved connector
   with small circular waypoint dots and a dark mono label chip
   (`results.buildAgentContext.tier eq "vip"` / `default` render correctly
   today, sourced from the branch condition, confirming
   `IWorkflowConnection`-adjacent label plumbing already works for IF
   branches) — but the live capture renders more, larger dots along each
   edge than the mock's sparser markers. **FIX (T04)** — tune marker
   count/size/opacity to the reference's `canvas-layout.css`.
7. **Palette already matches PRESERVE item 2** (left rail, not the mock's
   bottom-center dock) — correctly NOT changing orientation per the
   binding-contract override. Icon-only rail today vs. the reference's
   labelled chip/section treatment. **FIX (T05)**.
8. **Floating chrome is a solid toolbar, not floating pills.** The mock
   renders back/breadcrumb+name, `saved · Ns`, `valid · N nodes`, `Run
   test`/`Publish`, the segmented control, and the zoom control as
   translucent floating panels over the canvas. The live header is one
   solid full-width bar; the zoom control is a solid bar docked
   bottom-left rather than a floating pill. **FIX (T08)**.
9. **`Publish` action does not exist live** (live shows `Run now` / `Pause`
   / `Run Test`; the mock shows `Run test` / `Publish`). **NEW-CAPABILITY**
   — no publish API exists per the polish-loop's standing decision 3;
   needs human sign-off before any task builds it (default: not built,
   per this SPEC's Human boundaries section).
10. **"Variables Reference" affordance bar has no equivalent in the mock
    crop.** It sits directly under the header in the live capture and is
    not shown in `11-builder.png`. Not called out by the Goal section's
    explicit element list (canvas field, node cards, edges, palette,
    chrome) and not itself styled in legacy/mock terms — no action item
    raised for this loop; flagged here only so a later task does not
    silently drop it while touching the header region.

### T02 — Port design tokens + type ramp into the builder scope

- Port `builder-v2-reference/tokens.css` into a builder-scoped token layer
  (colors, surfaces, borders, radii, spacing scale, shadows, and the mono/sans
  font stacks and size/weight/letter-spacing ramp the reference uses). Map onto
  the existing `--rd-*` foundation tokens where an exact equivalent already
  exists; introduce new builder-scoped tokens only where the reference has no
  foundation equivalent, and list those in the task report.
- The mono font used by the node summary/stat lines and edge labels must be
  loaded/available in the builder scope — verify it renders, do not assume.
- No component markup changes in this task; this is the substrate T03–T05 port
  onto.
- Unit tests: none required beyond keeping the suite green (this is a token
  layer), but the task must not introduce lint/typecheck regressions.
- G6 VISUAL GATE: capture the builder. Expect little or no visible change —
  the purpose of this capture is to prove the token layer landed without
  breaking the screen, and to keep the screenshot series continuous.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Fresh node card component (all variants, placeholder stats)

- Build a NEW node card component ported from `builder-v2-reference/`
  `node-card.html` + `node-card.css`. Start from the reference markup; do not
  edit the existing node component toward it.
- Anatomy per the mock: leading square icon chip tinted by node type; title
  (truncating); right-aligned type badge (`TRIGGER` / `IF` / `AGENT` / none);
  a one-line mono config summary derived from EXISTING node configuration
  fields (reuse the pure summary function shipped in the polish loop —
  extend per-type only if a type has no summary yet); a footer row with
  `<n> runs`, a secondary metric slot (`p95: …` / `24h: …`) and an `● ok`
  status dot. In this task the footer values are STATIC PLACEHOLDERS behind a
  clearly-named input — T07 replaces them with real data.
- Ports on the top/bottom edges of the card (PRESERVE item 1: vertical flow),
  rendered as the mock's small ringed dots tinted by node type.
- Mount it as the Foblex node template: `fNode`, `fDragHandle`,
  `[fNodePosition]`, `fNodeInput` / `fNodeOutput` (including `fOutputMultiple`
  for BRANCH/CONDITIONAL) keep their current bindings and ids — connecting,
  dragging and reassigning must behave identically.
- Cover every variant: each `EWorkflowNodeType`, selected state, hover state,
  invalid/error state (if one exists today), long-name truncation, empty
  summary.
- DELETE the superseded node styles in the same task — no dead legacy skin.
- Unit tests: variant rendering table (type → icon/badge/accent), summary
  function per type including the empty case, selection state class, ports
  emit the same connector ids as before. Round-trip save spec stays green,
  untouched.
- G6 VISUAL GATE: the node cards in the screenshot must read like the mock's
  cards — proportions, chip, badge, mono line, footer row. Compare
  card-for-card against `11-builder.png`.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Canvas field, edges, and edge labels

- Port the canvas skin from `builder-v2-reference/canvas-layout.html` +
  `canvas-layout.css`: background field color and the dot-grid pattern
  (spacing, dot size, opacity as specified in the reference), the canvas
  vignette/depth treatment if the reference has one, and the scroll/overflow
  behavior at the canvas edges.
- Edge/connection styling: stroke color, width, opacity, the dashed treatment
  for the mock's active/highlighted edge, endpoint caps, and the selected/hover
  edge state. Keep `f-connection` mechanics (`fType`, `fBehavior`, reassignable
  ends) exactly as they are — style only.
- Edge labels: render the mock's small mono chip on the edge. Source the text
  from the existing `IWorkflowConnection.label` field where populated and from
  branch/conditional path names where the domain model provides them; where
  neither exists, render nothing (never a fabricated label). Record in the task
  report which edges get labels today and which are structurally empty.
- Unit tests: label resolution function (labelled edge, branch path edge,
  unlabelled edge → empty), and that edge styling classes bind off the existing
  connection state without changing connection ids.
- G6 VISUAL GATE: the canvas field and edge weight must read like the mock, not
  like the default Foblex background.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T05 — Left palette rail restyled per the reference

- Restyle the left palette rail (PRESERVE item 2 — it stays a left rail) using
  the reference's chip/label/section styling: icon tiles, uppercase mono
  labels, grouping per `DEFAULT_NODE_MAP`'s `group` field, rail width, item
  spacing, hover/active states, and the collapsed/expanded affordance if one
  exists today.
- Same node types, same create wiring, same drag-to-canvas behavior. No new
  node types. Keyboard affordances preserved if they exist today.
- Unit tests: rail renders every node type in its group; clicking/dragging an
  item creates the identical node as before (assert against
  `createNodeFromDefault` output, not against markup).
- G6 VISUAL GATE: rail styling vs the mock's palette treatment.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T06 — Per-node execution stats: data-source investigation (no code)

The mock's node cards show real numbers (`1,842 runs`, `24h: 312`,
`p95: 620ms`, `● ok`). L5 T01 finding 6 recorded per-node aggregates as
NO-DATA in 2026-07-22. This task re-opens that finding and settles it.

- Investigate, end to end, the cheapest CORRECT source for per-node
  `runs` / `p95` / `ok` on a workflow definition:
  - workflow-service: `WorkflowsService` execution queries, the executions
    Postgres repository, `getWorkflowsSummary` / `/workflows/summary`, and
    whether any per-activity/per-node dimension is already persisted;
  - the trace/analytics infrastructure (the loop that produced
    `console-redesign-trace.md`): spans/steps per correlation id, whether they
    carry a workflow node identity, and whether an aggregate query over them is
    feasible without an N+1 fan-out;
  - api-gateway proxying and what admin-console's `WorkflowApiService` already
    reaches.
- For each candidate source, record: what it can answer, its cost/shape, what
  it CANNOT answer, and whether the node identity in the data (node name vs
  node key vs activity name) can be joined to the builder's node model — this
  join is the crux; the builder regenerates node keys on every deserialize.
- Output a RECOMMENDATION with exactly one of:
  (a) wire an EXISTING endpoint (name it, with file:line);
  (b) a small read-only aggregate on an existing endpoint (specify the query
      and where it belongs) — requires human sign-off before T07 builds it;
  (c) NO-DATA for one or more of the three metrics — specify which, and the
      degraded rendering (metric slot hidden, never faked).
- Record "**T06 findings (recorded <date>):**" in this SPEC with file:line
  citations throughout. No code changes in this task.

**Accept**
```
grep -n "T06 findings" manual-loops/admin-console/console-redesign-builder-v2.md
```

### T07 — Wire real per-node stats into the node cards

- Implement the T06 recommendation (option (b) only after human sign-off).
  Replace T03's placeholder inputs with real, read-only data: one fetch per
  builder load, cached, never per-node N+1, never blocking the canvas render.
- Loading state: the footer row renders its skeleton/neutral state, never zeros
  presented as facts. Error state: the row degrades to hidden with a logged
  warning; the canvas keeps working.
- Metrics that T06 classified NO-DATA stay hidden, and the exclusion is
  catalogued in `cowork/INDEX.md` in T09 — do not fabricate, do not hard-code,
  do not compute a fake success rate.
- Unit tests: mapping from the stats response to per-node view models
  (including the node-identity join), loading state, error state, hidden-metric
  state, and a node with no matching stats row.
- G6 VISUAL GATE: the footer rows in the screenshot show real numbers for a
  workflow that has run, and degrade cleanly for one that has not.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T08 — Floating chrome + inspector polish

- Bring the floating chrome to the mock: the back arrow + `workflows /` +
  workflow name + status badge group, the `saved · Ns` pill, the
  `valid · N nodes` pill, `Run test` and `Publish` actions, the segmented
  `Editor / Runs N / Settings` control, and the zoom control (`−  100%  +  fit`)
  at the bottom-left — all as floating overlays on the canvas, matching the
  reference's panel surface, blur/shadow, radius and typography.
- The floating inspector panel: same surface treatment, tabbed header, the
  EXISTING config form fields and wiring inside it, footer with node id and
  Remove. Opens on node select, closes on canvas click / Esc — preserve the
  behavior shipped in L5 T05; only the container styling changes.
- Anything requiring a capability that does not exist today (e.g. `Publish`
  with no publish API) stays a FINDING for human sign-off, not built
  (standing precedent, polish loop decision 3).
- PRESERVE item 3 (agent-configure floating chrome) must not regress if this
  task touches a shared chrome primitive — screenshot
  `/ai/agents/<id>/configure` too if it does.
- Unit tests: chrome renders the existing state (name, save state, validity,
  node count) from existing sources; segmented control navigates; inspector
  open/close/Esc behavior unchanged.
- G6 VISUAL GATE: full-screen comparison of chrome placement and density vs the
  mock.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T09 — Final side-by-side audit + docs + index

- Re-run the full capture into
  `manual-loops/admin-console/audit/builder-v2/after/` (same workflow id as
  T01, plus one workflow with no run history, plus
  `/ai/agents/<id>/configure` to evidence PRESERVE items 3 and 4).
- Produce an explicit side-by-side comparison in this SPEC under
  "**T09 audit (recorded <date>):**": for each region of the screen (canvas
  field, node card, ports, edges + labels, palette rail, floating chrome,
  inspector, stats footer), state MATCH / PARTIAL (what remains) / EXCLUDED
  (cite the data-gap or NEW-CAPABILITY finding). Both images must be opened
  with the Read tool to write this section.
- Confirm each PRESERVE item survived, with the screenshot that proves it.
- Update `services/admin-console/README.md` (builder v2 composition notes: the
  new node card, the token layer, the stats source) and add
  `## Change: console redesign builder v2 (console-redesign-builder-v2)` to
  `cowork/INDEX.md` with before/after audit pointers, resolved vs deferred
  findings, and any NEW-CAPABILITY items awaiting sign-off. Log to Engram topic
  'admin-console/redesign-builder-v2'.

**Accept**
```
grep -n "console-redesign-builder-v2" cowork/INDEX.md && ls manual-loops/admin-console/audit/builder-v2/after
```

---

- [x] T01 screenshot-loop bootstrap + before baseline
- [x] T02 design tokens + type ramp
- [x] T03 fresh node card component
- [x] T04 canvas field, edges, edge labels
- [x] T05 left palette rail
- [ ] T06 per-node stats investigation (no code)
- [ ] T07 wire real per-node stats
- [ ] T08 floating chrome + inspector
- [ ] T09 final audit + docs + index

## Out of scope (explicit)

- Replacing `@foblex/flow` or rewriting graph mechanics — visual skin only.
- Workflow schema, serializer/deserializer, validation, save format, routes —
  all frozen.
- New capabilities: a publish flow that does not exist, new node types, new
  metrics endpoints beyond the T06-signed minimum — findings only.
- The workflows LIST view (`/workflows`, mock `10`) — shipped in the polish
  loop; captured here only as navigation context.
- Trace views, analytics, and every non-builder screen — their own loops. The
  agent editor and agent-configure screens appear only in the PRESERVE list as
  regression targets.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- The PRESERVE list is human-signed; it cannot be traded away for parity.
- T06 option (b) (a new read-only aggregate) requires human sign-off before
  T07 builds it. Default is (c): hide the metric.
- NEW-CAPABILITY findings need human sign-off before any task builds them
  (default: not built).
- Deviating from the binding contract (`11-builder.png` +
  `builder-v2-reference/`) requires human sign-off.
