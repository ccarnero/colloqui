# SPEC — Console redesign: AI agents (admin console)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues live in `manual-loops/`.
> Depends on: `manual-loops/admin-console/console-redesign-foundation.md` (must be shipped).
> Origin: user decisions 2026-07-21 (Cowork session "Rediseño consola admin").
> Engram topic: 'admin-console/redesign-ai'.

## Goal

The AI section becomes the IDE-like experience of the design contract: an
agents list with health/usage metrics, a prompt editor with inline mention
highlights, and a test panel with live chat output plus latency/token
tracking — reusing the existing agent CRUD and test/invoke plumbing.

## User decisions (human boundary — do not reinterpret)

1. Visual contract: "AI" sections (list, editor, test panel) of
   `manual-loops/admin-console/design/Rediseño Terminal.dc.html` (+ screenshots).
2. Mention highlighting is display-layer only: the stored prompt format does
   NOT change. Highlighting is derived by parsing the existing mention syntax
   (exact syntax confirmed at T01).
3. Editor and test panel live side by side in the agent editor view (list →
   editor is a route navigation).
4. Latency/token metrics come from whatever the existing test/invoke response
   already returns; missing fields = finding, not invention.
5. No new API endpoints.

## Prior art (validated 2026-07-21 — REUSE, do not duplicate)

- `features/automation/ai/` — `ai-agents-page.component.ts` (list),
  `detail/ai-agent-editor-page.component.ts` + `agent-config.component.ts`
  (editor), `chat-panel.component.ts` (EXISTING test panel — its invoke
  wiring is reused verbatim, no parallel harness),
  `agent-editor-bridge.service.ts`, `ai-monaco-hover.ts` (Monaco
  integration precedent), `ai.helpers.ts`.
- Services: `core/services/agent-admin.service.ts`,
  `agent-runtime.service.ts`; model `core/models/agent.model.ts`.
- `src/app/shared/components/` — foundation primitives; consume, never fork.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- Tokens only — no hard-coded hex.
- Only the AI feature folder is touched. Prompt data format is read-only
  (decision 2) — any write-path change is automatic rejection.
- The editor stays on Monaco (`ngx-monaco-editor-v2` is already a dependency;
  see `ai-monaco-hover.ts`) — mention highlighting is implemented as Monaco
  decorations, never a parallel editor.

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

- Map the AI feature: routes, components, agent model, exact mention syntax
  in stored prompts, test/invoke service contract (request/response fields,
  streaming or not, latency/token availability). Record "**T01 findings
  (recorded <date>):**" in this SPEC.

**Accept**
```
grep -n "T01 findings" manual-loops/admin-console/console-redesign-ai.md
```

### T02 — Agents list view

- Rebuild the list: MetricCard row (agents, invocations, error rate),
  InventoryTable (health dot, usage sparkline, model, status),
  NeedsAttentionPanel for failing agents.
- Unit tests: row mapping, empty state, row click navigates to editor.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T03 — Prompt editor with mention highlights

- Editor pane per the contract: Monaco with mention decorations (syntax per
  T01), extending the `ai-monaco-hover.ts` integration patterns. Saving uses
  the EXISTING editor-page save path unchanged.
- Unit tests: parser (mentions at start/middle/end, adjacent, malformed,
  none), decorations recompute on edit, saved payload is byte-identical to
  what the old editor would save.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T04 — Test panel with live output + metrics

- Restyle the EXISTING `chat-panel.component.ts` beside the editor: message
  input, chat-style output (invoke wiring unchanged), latency/token readout
  per response (fields per T01/decision 4), running-state indicator.
- Unit tests: request wiring, response rendering, error rendering (invoke
  failure shows an error state, never silent), metrics display.

**Accept**
```
cd services/admin-console && pnpm exec ng test --watch=false
```

### T05 — Docs + index

- Update `services/admin-console/README.md` (editor architecture: overlay highlighting,
  invoke reuse), add entry to `cowork/INDEX.md`, log decisions to Engram
  topic 'admin-console/redesign-ai'.

**Accept**
```
grep -n "console-redesign-ai" cowork/INDEX.md
```

---

- [ ] T01 inventory report
- [ ] T02 agents list view
- [ ] T03 prompt editor + highlights
- [ ] T04 test panel + metrics
- [ ] T05 docs + index

## Out of scope (explicit)

- Changing prompt storage format or agent schema — display-layer only.
- New model configuration options — existing fields only.
- Conversation history persistence in the test panel — session-only.
- AI sub-pages (playground, memories, skills, knowledge bases, structured
  KB, system variables) — separate follow-up loop.
- Backend/API changes.

## Human boundaries for this change

- Human approves this SPEC before the first run.
- Replacing or duplicating the Monaco editor requires human sign-off.
- Deviating from the binding visual contract requires human sign-off.
