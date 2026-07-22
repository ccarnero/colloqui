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
# G5a — COMMIT GATE (once per task): dev-mode smoke — ng serve boots and serves the shell
cd services/admin-console && node scripts/dev-smoke.mjs
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

**T01 findings (recorded 2026-07-22):**

1. **Routes** (`services/admin-console/src/app/app.routes.ts:128-244`, block "── AI ──"):
   - `ai` (:128) → landing (`ai-landing.component.ts`) — OUT OF SCOPE (not listed in Goal; not touched).
   - `ai/agents` (:140-146) → `AiAgentsPageComponent` — IN SCOPE (list, T02).
   - `ai/agents/new` (:147-154) → `AiAgentEditorPageComponent` — IN SCOPE (editor, T03/T04).
   - `ai/agents/:id` (:155-186) with nested `overview` (:163-169), `configure` (:170-177 → `AiAgentEditorPageComponent`, same editor as `new`), `settings` (:178-184 → `AiAgentSettingsComponent`) — `configure` IN SCOPE (editor); `overview` and `settings` are separate components NOT touched by this loop (no task references them) and are OUT OF SCOPE.
   - `ai/playground` (:187-193), `ai/memories` (:194-200), `ai/skills` (:201-207), `ai/system-variables` (:208-214), `ai/knowledge-bases[/:id]` (:215-228), `ai/structured-kb[/:id]` (:229-242) — all OUT OF SCOPE per SPEC "Out of scope" list, confirmed matching the SPEC's named exclusions.

2. **Components** — `services/admin-console/src/app/features/automation/ai/`:
   - `ai-agents-page.component.ts:1-13` — thin wrapper, renders `<app-ai navigationMode="route" defaultMode="list" />`. All real list logic lives in `ai.component.ts` (1645 lines), not in this file.
   - `detail/ai-agent-editor-page.component.ts:1-34` — thin wrapper, renders `<app-ai navigationMode="route" defaultMode="editor" [forcedAgentId]="agentId()" />` (`agentId` resolved from own or parent route param, :26-32). Same underlying host component as the list.
   - **`ai.component.ts` is the real host for both list and editor modes** (selector `app-ai`, decorator :94-115; `defaultMode` input `"list" | "editor"` :513; view switches via `viewMode.set(this.defaultMode())` :679). List rendering delegates to `AiExistingAgentsPanelComponent` (imported :84-87, used with `[runtimeHealth]="runtimeHealth()"` :143 and `(checkRuntime)="checkRuntimeSync($event)"` :149). Editor rendering is an inline `@switch` template with cases `instruction-prompt` (:231-249, Monaco bound to `systemPrompt`), `instruction-rules` (:251-267, Monaco bound to `rules`), `instruction-soul` (:269-286, Monaco bound to `soul`), `instruction-mentions` (:288-…, renders `extractedMentions()`), plus other cases for model/tools/skills/etc. not relevant to T03/T04. Editor options set `language: "ai-prompt"` (:620).
   - `existing-agents-panel.component.ts` (522 lines, selector `app-ai-existing-agents`) — the ACTUAL agents-list rendering used inside `ai.component.ts`. Per row (:56-160): name (:62), `formatProvider`/`formatModel` (:64-65, :444-452, reads `agent.model_config.llm.provider/model`), status badge via `agentStatusLabel`/`agentStatusClass` (:68-70, :472-484, adds "(changed)" suffix when `hasDraftChanges`), description (:73-75), `getSkillsCount(agent)` (:79, :454-456 → `agent.model_config?.subagents?.length ?? 0`), runtime-health badge (:81-83, :497-517, driven by `runtimeHealth()` input, states `unknown|checking|synced|unsynced|draft|misconfigured`), `created_at` (:85). Actions: Publish/Unpublish/Revert/Edit/Check Runtime/Delete (:89-159). `hasDraftChanges` (:458-470) diffs `agent.published_config` against current `name`/`description`/`system_prompt`/`model_config` (JSON.stringify compare) — this IS a real, derivable field, not new data.
   - `agent-config.component.ts` (1068 lines) — subagent/tool/skill/model-config sub-forms used inside the editor `@switch`; it does NOT reference Monaco, `ai-monaco-hover`, or mentions (`rg` for those terms returns no matches in this file). Only touches `subagent.systemPrompt` via plain `ngModel` (:210) and a default template value (:918).
   - **`chat-panel.component.ts` (251 lines, `AiChatPanelComponent`) is UNUSED / dead code** — `rg -rl "AiChatPanelComponent"` under the `ai/` folder returns only `chat-panel.component.ts` itself and `chat-panel.component.spec.ts`; it is not imported by `ai.component.ts`, `agent-config.component.ts`, or any route. Its template (:25-104) duplicates the System Prompt/Rules/Soul Monaco editors already inline in `ai.component.ts` (:231-286) and adds quick-insert chips for `@skill:`/`@tool:` (:38-58) plus a client-side "Detected References" chip list (:67-83, driven by an `extractedMentions` **input**, not computed internally). **It contains zero invoke/HTTP wiring** — no `AgentRuntimeService`, no `createExecution`/`getExecution` call anywhere in the file. See item 7 (Prior-art correction) — the SPEC's description of this file as "the EXISTING test panel — its invoke wiring is reused verbatim" is factually wrong on both counts (it is not a test/chat panel, and it has no invoke wiring).
   - `agent-editor-bridge.service.ts:1-99` — signal-based bridge between the `/agents/:id` detail wrapper and whichever inner editor is mounted (`editingAgentId`, `saving`, `loading`, `canSave`, `isDirty`, `savedAgent`, `deletedAgentId` signals, :26-32; `registerHandlers`/`requestSave`/`requestReset`/`requestCancel`, :40-97). Provided at `AiAgentDetailComponent` level (per its own doc comment, :18-19), not global. Not directly relevant to mention highlighting or test-panel wiring; only relevant if T03/T04 need to coordinate save state with the detail shell.
   - `ai-monaco-hover.ts:1-227` — registers three Monaco integrations against the `"ai-prompt"` language id: a hover provider (`registerAiMonacoHoverProvider`, :8-62, shows a popup on `@skill:<id>`/`@tool:<id>` tokens), a completion provider (`registerAiMonacoCompletionProvider`, :78-193, autocompletes `@skill:`/`@tool:` and matching ids), and a keyup handler that force-triggers suggest on `@` (:200-227). **No decoration API (`deltaDecorations`, `createDecorationsCollection`) is used anywhere in this file** — mention highlighting (background/inline styling) does not exist yet; only hover + autocomplete. This confirms T03 is genuinely new work, and that "extending the `ai-monaco-hover.ts` integration patterns" (T03 task text) means adding a decorations call alongside these existing providers, not modifying them. Both providers are invoked from `ai.component.ts:644-648`.
   - `ai.helpers.ts:1-168` — `extractMentionsFromPrompt(text)` (:19-34) is the mention PARSER: regex `/@(skill|tool):([a-zA-Z0-9_ -]+?)(?:\s+(?:skill|tool|and|or|the|for|when|while|using|with|to)\s|[,.!?;:\n]|\s*$)/gi` (:21-22). Names may contain spaces/hyphens (multi-word mentions), terminated by punctuation, a stop-word, or end-of-string — Monaco decoration ranges for T03 must reproduce this exact boundary logic, not a naive `\w+` match. Called from `ai.component.ts:585` (`extractMentionsFromPrompt(this.systemPrompt)`).

3. **Agent model** — `services/admin-console/src/app/core/models/agent.model.ts`, `interface IAgent` (:217-245): `id`, `name`, `description`, `system_prompt`, `model_config` (`IAgentModelConfig`, :205-215, has optional `llm: IAgentModelConfigLlm` with `provider`/`model`/`connectorId`/`temperature`/`maxTokens`, plus flat back-compat `provider`/`model`/`connectorId` at root, plus `rules`, `soul`, `subagents: ISubagentConfig[]`), `tools: unknown[]`, `enabled_tools`, `enabled_mcp_servers`, `enabled_mcp_tools`, `tool_description_overrides`, `channels: unknown[]`, `status: AgentStatus` (`draft|published|archived`, :181-187), `is_active`, `published_at`, `created_at`, `updated_at`, `published_config: Record<string, unknown> | null`, `input_variables?`, `output_variables?`, `knowledge_base_ids?`, `published_by?`. **There is no health/usage/invocation/latency/token/error-rate field anywhere on `IAgent`.** `IMcpUsage`/`IMcpUsageSummary` (:135-146, `totalCalls`/`successCalls`/`errorCalls`/`avgDurationMs`) exist but belong to MCP servers (`AgentAdminService.getMcpServerUsage`, `agent-admin.service.ts:410-413`), not agents — there is no agent-equivalent endpoint (confirmed by `rg` over `agent-admin.service.ts`: no `stats`/`usage`/`metrics`/`invocation`/`error_rate` method for agents).

4. **Exact mention syntax (decision 2)** — confirmed literal syntax is **`@skill:<id>`** and **`@tool:<id>`**, where `<id>` may include letters, digits, `_`, spaces, and hyphens. Evidence: parser regex `ai.helpers.ts:21-22` (see item 2); producer/UI hints in `chat-panel.component.ts:31-32` (hint text `@skill:name` / `@tool:name`) and `:43,:53` (`insertMention('@skill:' + skill.id)` / `insertMention('@tool:' + tool.id)`); `ai.component.ts:236-238` (identical hint text in the live editor pane); Monaco hover/completion matching `word.startsWith("skill:")`/`"tool:"` after a literal `@` (`ai-monaco-hover.ts:33-53`, `:124-167`). Design contract confirms the same syntax rendered as colored chips: `@skill:lead-scoring`, `@tool:crm-create-opportunity`, `@tool:handoff-queue` (screenshot `09-ai-editor-test-panel.png`; source `Rediseño Terminal.dc.html:610,619`). This is stored inline in `system_prompt`/`rules`/`soul` plain text — no delimiter change needed for T03, which only needs to run the same regex over the Monaco model text and turn each match into a decoration range.

5. **Test/invoke contract (decision 4)** — `agent-runtime.service.ts:1-63`. `createExecution(request: IChatRequest & { agentId })` → `POST /runtime/executions`, returns `{ executionId, status }` (:37-44) — **not streaming**; the caller must poll `getExecution(executionId)` → `GET /runtime/executions/:id` (:46-50), returning `IExecutionResult` (:7-30): `executionId`, `tenantId`, `type: "chat"`, `state: "pending"|"running"|"completed"|"failed"`, `requestedAt`, `startedAt?`, `completedAt?`, `agentId`, and `result?` with `reply?`/`response?`, `toolCalls?`, `toolResults?`, **`usage?: { inputTokens?, outputTokens?, totalTokens?, cachedInputTokens? }`** (tokens DO exist, directly, :21), `costUsd?`, `model?`, `provider?`, `skills?`, `mcpTools?`, `errorCode?`, `errorMessage?`. **`chat-panel.component.ts` never calls this service** (item 2) — the only real reference implementation of this contract inside the `ai/` folder is `playground.component.ts` (OUT OF SCOPE as a route, but its pattern is the one to imitate for T04): `createExecution` (:442-451) then `waitForExecution` (:558-572) polls `getExecution` every 1000ms up to a 300s timeout. **Latency is NOT a field returned by the backend** — it is computed client-side as `completedAt - startedAt` from the two timestamp fields (`playground.component.ts:456-461,526`: `latencyMs: startedAt ? completedAt - startedAt : undefined`). So for T04: tokens = direct field (`usage.totalTokens` etc.), latency = derived, not raw — must be computed the same way, and is `undefined` whenever `startedAt` is missing (per decision 4, this is a finding to surface, not invent).

6. **Health/usage ground truth vs. design** — design mock agents array, `Rediseño Terminal.dc.html:1576-1589`, and rendered in `06-ai-agents.png` / `09-ai-editor-test-panel.png`:
   - `name`, `meta` (provider·model·temp) → REAL: `IAgent.name`, `getAgentLlmConfig(agent.model_config)` (`agent.model.ts:421-442`).
   - `status` (`published`/`published*`/`draft`) → REAL: `IAgent.status` + `hasDraftChanges` (`existing-agents-panel.component.ts:458-470`) for the `*`/"(changed)" suffix.
   - `skills` (count) → REAL: `agent.model_config.subagents.length` (`existing-agents-panel.component.ts:454-456`).
   - `runtime`/`rt` (`synced`/`issue`/`draft`) → REAL: `runtimeHealth` signal, states `synced|unsynced|draft|misconfigured|checking|unknown` (`ai.component.ts:1561-1644`), derived from `AgentRuntimeService.checkRuntimeHealth()` (gateway NATS/Redis check) + per-agent published/provider/model checks — auto-run for ALL agents on list load (`ai.component.ts:1502`, `checkRuntimeSync()` called with no `agentId`), re-runnable per agent via the "Check Runtime" button. Design's `issue` state maps to code's `unsynced`; design has no example of `misconfigured` but the state exists in code.
   - `description`, `created` → REAL: `IAgent.description`, `IAgent.created_at`.
   - **`inv` (invocations, e.g. "2,841"), `p95` (e.g. "620ms"), `spark` (sparkline points)** → **FLAG NO-DATA.** No field on `IAgent`, no per-agent stats/usage/metrics endpoint on `AgentAdminService` or elsewhere in the `ai/` or `core/services` folders (confirmed by `rg` — only `AgentRuntimeService.checkRuntimeHealth()` for gateway health, and `getMcpServerUsage` for MCP servers, item 3). T02's InventoryTable/sparkline cells for these three columns have **no backing data source** under "no new API endpoints" (decision 5) — must render an explicit empty/dash state, not invented numbers.
   - Top-of-list `MetricCard` row in the design (`06-ai-agents.png`): "INVOCATIONS · 24H", "AVG P95", "TOKENS · 24H", "HANDOFF RATE" — **all FLAG NO-DATA**, same reason (no aggregate endpoint exists; "handoff rate" additionally has no concept anywhere in `agent.model.ts` or the services).
   - "Sync from seed" button visible in `06-ai-agents.png` — **no corresponding action found** in `AgentAdminService` or `ai.component.ts`; FLAG NO-DATA / no evidence, likely a design-only affordance not covered by any task in this SPEC.
   - Test-panel metrics row in the design (`Rediseño Terminal.dc.html:637,646`, `09-ai-editor-test-panel.png`): `"620ms · 214 tokens · ver en Trace →"` / `"1,184ms · 402 tokens · 2 tool calls"` → latency = derived (item 5), tokens = REAL (`usage.totalTokens`), tool-call count = REAL (`result.toolCalls.length`), **"ver en Trace →" deep link → FLAG NO-DATA/unclear**: `IExecutionResult` has no `correlationId` field, only `executionId`; no confirmed route wires an execution id into `/processes/trace/:correlationId`. Do not build this link in T04 unless a human confirms the id mapping — decision 5 (no new endpoints) and out-of-scope (backend changes) both block inventing one.

7. **Prior-art corrections** (SPEC lines 31-36):
   - **WRONG**: `chat-panel.component.ts` is described as "the EXISTING test panel — its invoke wiring is reused verbatim, no parallel harness." It is neither a test panel (its template is a System Prompt/Rules/Soul prompt-editing UI, `chat-panel.component.ts:25-104`) nor does it contain any invoke wiring (no `AgentRuntimeService` reference in the file). It is also currently unused/orphaned — not rendered from any route or parent component (item 2). **T04 has no existing test panel to restyle "in place"**; the only real reference for the invoke request/response contract is `playground.component.ts` (out of scope as a page). This needs a human decision before T04: either (a) wire `chat-panel.component.ts` up for the first time with `AgentRuntimeService` calls modeled on `playground.component.ts`'s pattern, treating it as new (not "restyled existing") wiring, or (b) pick a different existing component. The SPEC's T04 instruction "Restyle the EXISTING `chat-panel.component.ts`... invoke wiring unchanged" is not executable as literally written, because there is no existing invoke wiring in that file to leave unchanged.
   - Everything else in the Prior-art block is accurate: `ai-agents-page.component.ts`/`ai-agent-editor-page.component.ts`/`agent-config.component.ts` exist at the stated paths and roles (item 2); `agent-editor-bridge.service.ts` exists and matches its stated role; `ai-monaco-hover.ts` is a real, working precedent for Monaco language-scoped providers (item 2); `ai.helpers.ts` exists and contains the mention parser; `agent-admin.service.ts`/`agent-runtime.service.ts`/`agent.model.ts` exist at the stated paths.
   - Minor terminology note (relevant to T02, not a correction of this SPEC's Prior-art block): the Goal/T02 text says "MetricCard row"; the actual shipped foundation primitive is named `kpi-card` (`shared/components/kpi-card/kpi-card.component.ts`), not `metric-card`. `InventoryTable` and `NeedsAttentionPanel` do exist at `shared/components/inventory-table/` and `shared/components/needs-attention-panel/` as named.

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
- **AMENDED 2026-07-22 (human sign-off, post-T01 finding 7):** `chat-panel`
  is an orphaned prompt-editing component with NO invoke wiring — the prior
  art was wrong. The test panel is a NEW standalone component beside the
  editor that reuses `AgentRuntimeService` (`createExecution` → poll
  `getExecution`, the proven playground pattern): tokens from
  `result.usage.*`, latency client-computed (`completedAt - startedAt`),
  error state on failed/timed-out executions. No new endpoints. The orphaned
  `chat-panel.component.ts` stays untouched; its removal is a follow-up.
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

- [x] T01 inventory report
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
