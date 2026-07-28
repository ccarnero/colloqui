# SPEC — Connection call inspector: per-call request/response on every connection (admin console + runtimes)

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/connectors/`.
> Depends on: `manual-loops/payload-capture.md` (shipped 7/7) and
> `manual-loops/connector-trace-linking.md` (shipped 9/9).
> Origin: user decisions 2026-07-28 (Cowork session).
> Engram topic: 'connectors/call-inspector'.
> Design provenance (human-facing): https://claude.ai/design/p/82503d54-5655-41d0-b206-c7bdd8094afa
> — the binding, agent-readable contract is the local export
> `manual-loops/admin-console/design/Rediseño Terminal.dc.html`.

## Goal

1. On every connection detail screen (HTTP connector, MCP server, agent, hosted
   service), each "Recent calls" row opens an in-place call inspector showing
   THAT invocation's full request and response: payloads, headers/metadata,
   status, duration.
2. Every connector invocation type durably captures per-call request/response —
   `serviceCall` (platform/hosted services), `mcpCall` (tool args + result),
   raw no-adapter HTTP, and standalone LLM calls join the already-captured
   `endpointCall` and agent executions.
3. The trace remains available as secondary navigation ("View in trace") — it is
   no longer the only path to a call's payloads.

## User decisions (human boundary — do not reinterpret)

1. (2026-07-28) SUPERSEDES `connector-trace-linking.md` decision 2 of
   2026-07-13 ("Payloads are viewed in the trace only — entity screens never
   render payloads"): connection screens now render per-call payloads, fetched
   on demand through the guarded payload endpoint. History stands; the old
   decision is not deleted, it is dated and superseded here.
2. Emission parity covers ALL four missing paths in this loop: `serviceCall`,
   `mcpCall` (tool arguments + result content), the raw no-adapter HTTP branch,
   and standalone LLM calls made outside chat executions.
3. MCP "Recent calls" migrates to `tracked_events` via the ingester read API
   (single source of truth, 30-day payload retention, trace link for free).
   `mcp_call_events` in agent-admin-service stays ONLY as the source for the
   aggregate usage summary — do not extend it, do not delete it.
4. Hosted services get a full detail page (new route) following the design
   contract's Connection detail section — the old "list only" decision is
   superseded for hosted services.
5. The call detail UI is a docked side inspector (pattern: the trace event
   inspector), not a dialog and not an expandable row.
6. Access control unchanged: viewing any payload requires the
   `tracking:payload:read` permission and produces an audit event per view —
   same guard and audit path as the trace payload viewer.
7. Event-kind mapping (approved with this SPEC): `serviceCall` and raw HTTP
   reuse `connector.endpoint_call.completed.v1` with resource prefixes
   `service/<name>` and `raw/<host>`; MCP calls get
   `connector.mcp_call.completed.v1`; standalone LLM calls get
   `ai.llm_call.completed.v1`. No other new kinds.

## Prior art (validated 2026-07-28 — REUSE, do not duplicate)

The engine does not forward this section — it is the author-facing registry.
Repeat each citation inside the body of the task that uses it.

- **Emission pattern to copy:** `services/connector-runtime/src/activities/_shared/event-publisher.ts:69-181`
  (publishes `endpoint_call_completed` with causal threading), with
  `redact-headers.ts:12-38` (redaction list) and `truncate-body.ts:15-24`
  (8KB truncation).
- **The serviceCall gap (documented in code):**
  `services/connector-runtime/src/activities/service-call.activity.ts:53-61` —
  "serviceCall emits no endpoint_call_completed event".
- **The raw-branch gap (documented in code):**
  `services/connector-runtime/src/lib/endpoint-call-core/execute-raw.ts:25-27`.
- **MCP today:** `services/connector-runtime/src/activities/mcp-call.activity.ts:196-295`
  reports scalars to agent-admin-service (`mcp_call_events`) — keep that path
  for aggregates; the new bus event is additive.
- **Agent executions are already captured:**
  `services/agent-ai-service/src/nats-handlers/execution.handler.ts:245-292`
  (`execution_completed` payload: message, reply text, toolCalls/toolResults,
  usage, cost). This loop only builds their UI surface.
- **Standalone LLM path:** `services/agent-ai-service/src/modules/llm/llm-executor.service.ts:129-183`
  + `llm-action.service.ts` (job-executor action) — today only cost is recorded
  (`cost-tracker.service.ts:39-41`).
- **Ingester machinery:** classification `src/lib/classify.ts` (rule 11
  connector-invocation :327-330, rule 6 agent-execution :220-229), scalar list
  projection `build-events-query.ts:104-166` (never selects the envelope),
  payload endpoint `handle-payload-request.ts:47-132`, payload lifecycle
  `payload_status` machinery (`tracked-events.sql:126-138`).
- **Console payload plumbing:** `TrackingChainService.getEventPayload`
  (`core/services/tracking-chain.service.ts:107-114`), HTTP payload projection
  `features/processes/run-view/domain/project-http-payload.ts:80-122`, existing
  request/response viewer `run-view-popup.component.ts:257-291,1016-1022`,
  Recent calls feed `core/services/connector-call.service.ts:81-98`.
- **Docked inspector pattern:** trace event inspector
  `features/processes/trace/trace-detail.component.ts:242-521`.
- **Design contract:** `manual-loops/admin-console/design/Rediseño Terminal.dc.html:1191-1252`
  ("Connection detail" section; health mapping notes in
  `manual-loops/admin-console/console-redesign-connections.md` T01 findings).
- **Routes:** `app.routes.ts` — `/connections/http/:id`, `/connections/mcp/:id`,
  `/connections/hosted-services` (list only today), `/ai/agents/:id`,
  `/processes/trace/:correlationId`.

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- UI tasks follow the binding design contract
  (`manual-loops/admin-console/design/Rediseño Terminal.dc.html`): each UI task
  cites the mock section/lines it implements; visual deviations require human
  sign-off.
- Capture is fire-and-forget: emitting a call event must NEVER fail or delay
  the call itself. On `DepthExceededError` fall back to emitting without causal
  fields (warn log) — an orphan event beats a lost event.
- Redaction/truncation parity on every new emission path: headers through
  `redact-headers.ts`, bodies/args/results/prompts through `truncate-body.ts`
  (8192 chars). Never persist un-redacted auth material.
- List endpoints keep EXCLUDING payload bodies (`/events` and `/chains` stay
  scalar-only); the inspector fetches payloads per event via
  `GET /tracking/chains/:correlationId/events/:eventId/payload` with its guard
  and audit. No new payload read endpoints.
- New event kinds update TAXONOMY.md and the ingester classification rules in
  the SAME task that introduces the kind; goldens extended, never weakened.
- New kinds ride the existing `payload_status` lifecycle unchanged (30-day
  scrub applies automatically). No retention changes.
- Touched services only: connector-runtime, agent-ai-service,
  tracking-ingester-service, api-gateway, admin-console. agent-admin-service is
  read-only in this loop (its usage endpoint keeps serving the MCP summary).
- Binding styles: ingester = pure functions in `src/lib/*`, one per file, I/O
  only in `main.ts`, plain Bun; console = standalone components, signals,
  OnPush; gateway = explicit proxy modules, global guards, no `@Public()`;
  connector-runtime/agent-ai = follow the file you are editing.
- Console UI strings in English.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G1 — connector-runtime tests + typecheck
cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit
# G2 — tracking-ingester-service tests + typecheck (from T05 onward)
cd services/tracking-ingester-service && bun test && bunx tsc -p tsconfig.json --noEmit
# G3 — agent-ai-service tests (from T04 onward)
cd services/agent-ai-service && bun test
# G4 — api-gateway tests (from T06 onward)
cd services/api-gateway && bun test
# G5 — admin-console tests (from T07 onward)
cd services/admin-console && pnpm test
# G6a — ITERATION (per attempt, source-mounted dev mode; admin-console tasks skip G6a)
./dev-mode.sh deps && ./dev-mode.sh <touched-svc> on && ./scripts/e2e-http-workflow.sh
# G6b — COMMIT GATE (once per task, built image)
./dev-mode.sh <touched-svc> off && ./rebuild-redeploy.sh <touched-svc> dev && ./scripts/e2e-http-workflow.sh
```

Gate ids follow the shared convention: G1-G5 = per-service suites (a gate only
runs once its first task exists), G6a/G6b = cluster e2e.

Gate rules (self-contained — the engine runs THIS file verbatim):

- ALL existing unit AND integration tests must pass in every touched service,
  every task. Weakening, skipping, or deleting an existing test is an automatic
  reviewer rejection.
- G6b runs for every task; a diff touching `packages/shared` redeploys every
  dependent service. The cluster must never drift from the branch.
- Commits only happen with dev-mode OFF and the built image live.
- G6a/G6b failures count as failed attempts like any other gate.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` must be green once
before T01; if it fails, skip G6a and rely solely on G6b.

E2E CLEANUP: every e2e script tears down what it creates — trap-guarded,
account-scoped, idempotent teardown (conventions from
`connector-trace-linking.md` T08 stand).

---

## Task queue

### T01 — serviceCall emits per-call request/response events

- In `services/connector-runtime/src/activities/service-call.activity.ts`
  (the documented gap is at lines 53-61: "serviceCall emits no
  endpoint_call_completed event"), publish a
  `connector.endpoint_call.completed.v1` event after every completed platform
  service call, reusing `_shared/event-publisher.ts:69-181` — do NOT write a
  new publisher.
- Payload shape mirrors `IEndpointCallEventPayload`
  (`lib/endpoint-call-core/types.ts:25-59`): method, resolved URL, status,
  durationMs, requestHeaders/responseHeaders through `redact-headers.ts:12-38`,
  requestBody/responseBody through `truncate-body.ts:15-24`.
- Resource: `service/<serviceName>` (decision 7). Thread the causal context
  from the activity args — the `_causal` param already arrives (line 53), it
  is just unused today; follow the pattern of
  `mcp-call.activity.ts:291` (`outcome.causal`).
- Emit on completion regardless of HTTP status (4xx/5xx are completed calls);
  transport-level failures follow the same semantics as
  `execute-with-adapter-endpoint.ts:109-126`.
- Fire-and-forget: emission failure logs a warn, never fails the call.
- Unit tests: event published with causal, without causal (root), redaction
  applied, truncation applied, emission failure does not throw, non-2xx still
  emits.

**Accept**
```
cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit
grep -n "publish" services/connector-runtime/src/activities/service-call.activity.ts
```

### T02 — Raw no-adapter HTTP branch emits the same event

- `services/connector-runtime/src/lib/endpoint-call-core/execute-raw.ts`
  (lines 25-27 document that this branch skips the audit publish): publish
  `connector.endpoint_call.completed.v1` with resource `raw/<host>`
  (decision 7), same redaction/truncation/causal/fire-and-forget rules as T01.
- DO NOT change the branch's call semantics — capture only.
- Unit tests: emission on success and on non-2xx, redaction, no-throw on
  publish failure.

**Accept**
```
cd services/connector-runtime && bun test
grep -n "publish" services/connector-runtime/src/lib/endpoint-call-core/execute-raw.ts
```

### T03 — mcpCall emits tool args + result content to the bus

- `services/connector-runtime/src/activities/mcp-call.activity.ts` (usage
  reporting today at lines 196-295): additionally publish
  `connector.mcp_call.completed.v1` via `_shared/event-publisher.ts` with
  payload: serverName, mcpServerId, toolName, success, durationMs, error,
  `arguments` (tool call args) and `result` (tool result content), both
  through `truncate-body.ts` (8KB). Resource: `mcp/<mcpServerId>`.
- Causal: the activity already carries causal context for its usage event —
  reuse it (`mcp-call.activity.ts:291` pattern).
- KEEP `reportMcpUsageEvent` → agent-admin-service exactly as-is (decision 3:
  aggregates stay there). The bus event is additive.
- Fire-and-forget; emit on success AND failure (failed tool calls are the
  interesting ones).
- Unit tests: args/result captured and truncated, failure path emits with
  error, usage reporting untouched (existing tests must still pass unmodified).

**Accept**
```
cd services/connector-runtime && bun test
grep -n "mcp_call" services/connector-runtime/src/activities/mcp-call.activity.ts
```

### T04 — Standalone LLM calls emit ai.llm_call.completed.v1

- In agent-ai-service, LLM calls made OUTSIDE chat executions (the
  job-executor path `llm-action.service.ts`, calling
  `llm-executor.service.ts:129-183`) publish `ai.llm_call.completed.v1` with:
  model, provider, prompt (truncated 8KB), completion text (truncated 8KB),
  inputTokens/outputTokens/cachedInputTokens, costUsd, durationMs, and causal
  context when the caller has one.
- Chat executions are NOT double-captured: `execution_completed`
  (`execution.handler.ts:245-292`) already carries their payload — this task
  explicitly excludes the execution path.
- Publish via the same NATS/JetStream envelope conventions the service already
  uses (`publishStatus`, `execution.handler.ts:366-397` is the local
  precedent). Fire-and-forget; cost tracking (`recordCost`) untouched.
- Unit tests: event on standalone call, no event on execution-path calls,
  truncation, publish failure does not fail the LLM call.

**Accept**
```
cd services/agent-ai-service && bun test
grep -rn "llm_call" services/agent-ai-service/src | head -5
```

### T05 — Ingester: classify the new kinds + resource filters

- `services/tracking-ingester-service`: add classification rules for
  `mcp_call_completed` and `llm_call_completed` in `src/lib/classify.ts`
  (precedent: rule 11 connector-invocation :327-330, rule 6 agent-execution
  :220-229) and the matching TAXONOMY.md entries — same task, same commit.
- Verify `serviceCall`/`raw` events (same kind as endpoint_call) classify
  under rule 11 unchanged; extend the rule's tests with the new resource
  prefixes.
- Ensure `/events` resource filtering works for the new resources
  (`service/<name>`, `raw/<host>`, `mcp/<id>`) AND for agent executions by
  agent (`agent/<agentId>` — needed by T10; verify rule 6 extracts a
  filterable resource, add extraction if it does not).
- Goldens: extend, never weaken. Click-through columns
  (`tracked-events.sql:86-93`) gain nothing unless the query plan needs it —
  if an index is required: idempotent SQL, new index, never repurposed.
- Unit tests: classification per new kind, resource filter per new prefix,
  payload_status lifecycle applies (`inline` when payload present).

**Accept**
```
cd services/tracking-ingester-service && bun test && bunx tsc -p tsconfig.json --noEmit
grep -n "mcp_call\|llm_call" services/tracking-ingester-service/src/lib/classify.ts
```

### T06 — Ingester /events projection: type-aware scalar summaries

- `build-events-query.ts:104-166` projects HTTP scalars today (method,
  resolvedUrl, status, durationMs, cacheResult). Add per-kind scalar
  projections — bodies stay EXCLUDED (constraint):
  - `mcp_call_completed`: toolName, success, durationMs, error (message only).
  - `llm_call_completed`: model, provider, durationMs, inputTokens,
    outputTokens, costUsd.
  - agent `execution_completed`: state, model, durationMs (if present), costUsd.
- Gateway: `GET /tracking/events` (`modules/tracking`,
  `tracking.controller.ts:108-119`) is a pass-through — verify no gateway
  change is needed; if DTO validation exists, extend it. Global guards apply.
- Unit tests: projection per kind, envelope/bodies never selected, limit cap
  and tenant scoping unchanged.

**Accept**
```
cd services/tracking-ingester-service && bun test
cd services/api-gateway && bun test
```

### T07 — Console: shared docked call inspector

- New standalone component `CallInspectorComponent` under the connections
  feature area: a docked right-side panel (pattern: the trace event inspector,
  `features/processes/trace/trace-detail.component.ts:242-521`; design
  contract: `manual-loops/admin-console/design/Rediseño Terminal.dc.html:1191-1252`
  Connection detail section — cite exact mock lines for spacing/chips in the
  implementation).
- Input: a call row (event_id + correlation_id + kind + scalars). On open it
  fetches the payload on demand via `TrackingChainService.getEventPayload`
  (`core/services/tracking-chain.service.ts:107-114`) — never pre-fetched with
  the list.
- Type-aware sections:
  - HTTP (`endpoint_call_completed`, any resource prefix): request
    (method/URL/headers/body) and response (status/duration/cache/headers/body)
    via `project-http-payload.ts:80-122` — REUSE, do not duplicate.
  - MCP (`mcp_call_completed`): tool, arguments (pretty JSON), result, error.
  - Agent execution (`execution_completed`): message in, reply text, tool
    calls/results, usage + cost.
  - LLM (`llm_call_completed`): model/provider, prompt, completion, usage/cost.
  - Unknown kinds: raw pretty-printed payload (forward-compatible default).
- Visibility gated by `tracking:payload:read` (precedent:
  `run-view-popup.component.ts:60,760-762`); rows render for everyone, the
  payload sections show the permission hint when not granted.
- Payload lifecycle states: `scrubbed` → "Payload expired (30-day retention)";
  `unresolved` → "Payload was not captured"; copy in English.
- Component tests: one per kind section, permission gating, scrubbed and
  unresolved states, on-demand fetch (no fetch before open).

**Accept**
```
cd services/admin-console && pnpm test
```

### T08 — HTTP connector detail: rows open the inspector

- `features/data-integrations/connectors/detail/connector-detail.component.ts`
  (Recent calls rows at lines 199-227): clicking a row opens the T07 inspector
  for that call. The "View trace" link (lines 217-225) STAYS as secondary
  navigation inside the inspector and/or the row.
- Remove the dead payload comment/decision reference at lines 193-198 (the
  superseded decision) — the feed itself stays scalar-only.
- Component tests: row click opens inspector with the row's event, trace link
  still navigates.

**Accept**
```
cd services/admin-console && pnpm test
```

### T09 — MCP detail: Recent calls migrates to tracked_events + inspector

- `features/connections/mcp-detail/mcp-detail.component.ts`: the Recent calls
  list (lines 184-206) switches source from
  `AgentAdminService.getMcpServerUsage` rows to the tracking feed —
  `ConnectorCallService` (or a sibling method) querying
  `type=connector.mcp_call.completed.v1&resource=mcp/<id>` via
  `GET /tracking/events` (precedent: `connector-call.service.ts:81-98`;
  7-day default window, limit 20).
- The aggregate summary cards KEEP reading `getMcpServerUsage`
  (`agent-admin.service.ts:411`) — decision 3.
- Each row opens the T07 inspector; add the "View trace" link per row
  (`/processes/trace/<correlation_id>` — MCP events now carry the run's
  correlation).
- Empty state names the window ("No calls in the last 7 days").
- Component tests: feed source, inspector open, trace link, summary cards
  unchanged.

**Accept**
```
cd services/admin-console && pnpm test
grep -n "mcp_call" services/admin-console/src/app/features/connections/mcp-detail/mcp-detail.component.ts
```

### T10 — Agent detail: Recent executions + inspector

- `/ai/agents/:id` detail screen: add a "Recent executions" section fed by
  `GET /tracking/events` with `type=<execution_completed type>` and
  `resource=agent/<agentId>` (T05 guarantees the filter), 7-day window,
  limit 20 — scalars: state, model, duration, cost, occurred_at.
- Each row opens the T07 inspector (agent section: message, reply, tool
  calls/results, usage/cost) + "View trace" link per row.
- Follow the existing detail-screen section conventions of the agents feature;
  design contract lines cited in the task implementation.
- Component tests: feed, inspector open, empty state.

**Accept**
```
cd services/admin-console && pnpm test
```

### T11 — Hosted services detail page

- New route `/connections/hosted-services/:id` (today only the list exists —
  `app.routes.ts`; the old "list only" decision is superseded, decision 4).
- Page per the design contract's Connection detail section
  (`Rediseño Terminal.dc.html:1191-1252`): config summary (name, base URL,
  auth chip — masked style per mock line 1218), plus Recent calls fed by
  `type=connector.endpoint_call.completed.v1&resource=service/<name>`, each
  row opening the T07 inspector, with "View trace" secondary links.
- Update the deep-link mapping from
  `connector-trace-linking.md` T05 (the pure route-mapping function in the
  console's `domain/`): hosted `serviceCall` events now resolve to the new
  detail route instead of the list.
- Component tests: route, sections render, mapping function updated cases.

**Accept**
```
cd services/admin-console && pnpm test
grep -n "hosted-services/:id\|hosted-services/" services/admin-console/src/app/app.routes.ts
```

### T12 — Cluster e2e: serviceCall capture round-trip

- Extend `scripts/e2e-http-workflow.sh` (keep its stage-per-function pattern,
  exit-code contract, and the T08 isolation conventions — account-scoped
  triggers, trap-guarded cleanup): add a `serviceCall` action to an e2e
  workflow, then assert:
  1. the `endpoint_call_completed` row with resource `service/...` lands in
     `tracked_events` sharing the run's `correlation_id`;
  2. `GET /tracking/events?type=...&resource=service/...` returns it through
     the gateway;
  3. the payload fetch (`GET /tracking/chains/:cid/events/:eid/payload`)
     returns 200 as the admin user and the payload contains the run's nonce.
- MCP and standalone-LLM paths are covered by service-level tests only (no MCP
  server or LLM job fixture exists in the dev e2e today) — RECORD this
  limitation in the task report; adding those fixtures is out of scope.
- Exit 0 only if all assertions hold.

**Accept**
```
./rebuild-redeploy.sh connector-runtime dev
./rebuild-redeploy.sh tracking-ingester-service dev
./scripts/e2e-http-workflow.sh
```

### T13 — Docs + index

- `services/connector-runtime/README.md`: per-call capture contract for
  serviceCall/raw/mcp (kinds, resources, redaction/truncation, fire-and-forget
  semantics).
- `services/agent-ai-service/README.md`: `ai.llm_call.completed.v1` contract
  and the execution-path exclusion.
- `services/tracking-ingester-service/README.md`: new kinds + type-aware
  `/events` projections.
- `SCHEMAS.md` + TAXONOMY note for the new kinds.
- `cowork/INDEX.md` entry; log the decision (rule, why, evidence, engram topic
  `connectors/call-inspector`), including the dated supersede of the
  2026-07-13 "payloads only in trace" decision.

**Accept**
```
grep -n "connection-call-inspector" cowork/INDEX.md
grep -n "mcp_call\|llm_call" SCHEMAS.md
```

---

## Progress

- [x] T01 serviceCall emission
- [x] T02 raw no-adapter emission
- [x] T03 mcpCall args+result emission
- [x] T04 standalone LLM emission
- [x] T05 ingester classification + resource filters
- [x] T06 type-aware /events projections
- [ ] T07 shared docked call inspector
- [ ] T08 HTTP connector detail wiring
- [ ] T09 MCP detail migration + inspector
- [ ] T10 agent detail recent executions
- [ ] T11 hosted services detail page
- [ ] T12 cluster e2e serviceCall round-trip
- [ ] T13 docs + index

## Out of scope (explicit)

- Analytics over payloads (standing future queue from `payload-capture.md`).
- Backfilling historical calls — types that did not emit have no history;
  the UI must not fake one.
- PII redaction inside bodies/args/prompts (the guard remains role + audit,
  not content transformation — standing decision).
- Retention changes (30-day scrub stands; `mcp_call_events` retention is
  agent-admin's concern, untouched here).
- Wire-level capture of the LLM provider hop (HTTP headers to
  OpenAI/Anthropic) — capture is at the semantic level (prompt/completion).
- Capturing per-call events for chat-execution LLM calls (already carried by
  `execution_completed`; per-turn granularity is a future decision).
- Extending audit-service or `mcp_call_events` in any way.
- Trace console redesign — this loop only adds "View in trace" secondary links.

## Human boundaries for this change

- Human approves this SPEC before the first run (including decision 7's
  event-kind mapping).
- Visual deviations from the design contract require human sign-off before the
  task commits.
- Any change to who may view payloads (`tracking:payload:read`) or to the
  30-day retention window.
- Human runs the first `--apply` of any destructive/administrative script.
- If T05's goldens reveal a taxonomy conflict for the new kinds, naming is
  approved by the human BEFORE code lands.
