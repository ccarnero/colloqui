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

- [ ] T01 visual audit + harness
- [ ] T02 builder full-bleed (nested route)
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
