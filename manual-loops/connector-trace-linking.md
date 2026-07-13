# SPEC — Connector causality fix, Recent calls on tracked_events & diagram deep links

> Task queue for the `/manual-loop` command. One task at a time, gated by tests and
> dual review. Queues live in `manual-loops/`.
> Origin: user decisions 2026-07-13 (Cowork session). Engram topic: `tracking/connector-trace-linking`.
> Depends on: `manual-loops/payload-capture.md` (done 7/7) and
> `manual-loops/workflow-step-events.md` (step events in run-view).

## Goal

Connector executions become first-class citizens of the trace, and the trace
becomes navigable:

1. **Causal fix** — `connector.endpoint_call.completed.v1` events join the
   workflow run's correlation instead of being emitted as causal orphans
   (today: `emit()` omits `correlationId`/`causationId` → `buildEventEnvelope`
   assigns `randomUUID()` — `envelope.utils.ts:333`).
2. **Recent calls on tracked_events** — the connector detail's "Recent calls"
   section reads from the durable causal store (30-day retention) instead of
   audit-service with a 60-minute window (why the user sees an empty list today).
3. **Bidirectional navigation** — trace/run-view detail cards link OUT to the
   entity screens (connector / mcp / hosted service / agent); "Recent calls"
   links INTO the real run trace (possible only after the causal fix).
   Payload viewing STAYS in the trace (payload-capture decision stands).

## User decisions (human boundary — do not reinterpret)

1. Recent calls migrates to `tracked_events` via the ingester read API. Single
   source of truth; audit-service stays as-is (payload-capture decision:
   "DO NOT extend audit-service").
2. Navigation is bidirectional: node → entity screen AND Recent calls → trace.
   Payloads are viewed in the trace only — entity screens never render payloads.
3. One queue for the whole change (causal fix first: without it, trace links
   from Recent calls point at orphan single-event correlations).

## Prior art (validated 2026-07-13 — REUSE, do not duplicate)

- **The pattern to copy:** `mcp-call.activity.ts:291` passes
  `correlationId: outcome.causal?.correlation_id`; `agent-call.activity.ts:283-292`
  passes `correlationId`/`causationId`/`depth + 1` from `EventCausalContext`.
  Agent executions already appear in the run's trace — this SPEC brings HTTP
  endpoint calls to parity.
- **The gap:** `services/connector-runtime/src/activities/_shared/event-publisher.ts`
  — `IEndpointCallEvent` (lines 45-60) has no causal fields; `emit()` (75-135)
  builds the envelope without them. Callers: `executeWithAdapterEndpoint`
  (`endpoint-call.activity.ts:113-173`) and `executeWithAdapterBase` (185-256).
- **Payload content is already right:** `requestBody`/`responseBody` truncated at
  8KB (`truncate-body.ts:20`), headers redacted. Do not change capture semantics.
- **Recent calls today:** `connector-call.service.ts` (console) queries
  `${AUDIT}/events?type=connector.endpoint_call.completed.v1` with
  `from = now - 60min`. Empty-list causes: window too small, audit consumption
  (`evt.*.*.platform.>`), or stale connector-runtime image — T02 diagnoses before
  T03 migrates.
- **Trace read API precedent:** trace-console endpoints live in
  tracking-ingester-service (owner of the table); gateway mirrors them as explicit
  proxy modules (`modules/tracking`). Chain list EXCLUDES payloads — that decision
  stands for any new read endpoint.
- **Destination routes exist** (`app.routes.ts`): `/connections/http/:id`,
  `/connections/mcp/:id`, `/connections/hosted-services` (list only — no detail
  page), `/ai/agents/:id`.

## Constraints (apply to every task)

- Binding styles: identical to `manual-loops/trace-console.md` (ingester = pure
  functions in `src/lib/*`, one per file, I/O only in `main.ts`, plain Bun;
  console = standalone/signals/OnPush; gateway = explicit proxy modules, global
  guards, no `@Public()`).
- `publishEndpointCallEvent` stays fire-and-forget: causal threading must NEVER
  make an endpoint call fail. On `DepthExceededError` from `buildEventEnvelope`,
  fall back to emitting WITHOUT causal fields (root event, warn log) — an orphan
  event beats a lost event.
- No new event kinds — same `connector.endpoint_call.completed.v1` type, now with
  causal fields populated. TAXONOMY.md untouched; no golden additions required,
  but existing goldens must not weaken.
- Backward compatible: events emitted before the fix (random correlation) remain
  valid rows; the console must not assume every endpoint_call has siblings.
- Schema changes (if an index is needed): idempotent SQL in `src/sql/*.sql` via
  `applySchema`. New indexes, never repurposed ones.
- Verbose logging; tests with the behavior; never weaken existing tests.

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
G1  cd services/connector-runtime && bun test            # T01
G2  cd services/connector-runtime && bunx tsc -p tsconfig.json --noEmit
G3  cd services/tracking-ingester-service && bun test && bunx tsc -p tsconfig.json --noEmit   # from T02
G4  cd services/api-gateway && bun test                  # from T03 onward
G5  cd services/admin-console && pnpm test               # from T04 onward
G6a ITERATION — as in manual-loops/trace-console.md (dev-mode + e2e per attempt;
    admin-console tasks skip G6a; deps sha-check at task start).
G6b COMMIT GATE — as in manual-loops/trace-console.md (dev-mode off +
    rebuild-redeploy of touched services + e2e green on built image).
```

Gate rules: identical to `manual-loops/trace-console.md` (full suites in touched
services; commits only on built image).

---

## Task queue

### T01 — Causal threading: endpointCall events join the run's correlation

- Extend `IEndpointCallEvent` with optional `causal?: EventCausalContext`
  (or `correlationId`/`causationId`/`depth` — match whatever shape
  `mcp-call.activity.ts` consumes, do not invent a third).
- `emit()` passes `correlationId`, `causationId`, `depth: causal.depth + 1` to
  `buildEventEnvelope`; absent causal → today's behavior (root event).
- Thread the causal context from the workflow's `serviceCall`/`endpointCall`
  activity args into `executeWithAdapterEndpoint` and `executeWithAdapterBase`
  — same source `mcpCall` uses (`outcome.causal`).
- `DepthExceededError` → retry emit without causal + warn (constraint above).
- Unit tests: with causal (correlation/causation/depth propagated), without
  causal (random correlation, null causation), depth-exceeded fallback.

**Accept**
```
cd services/connector-runtime && bun test && bunx tsc -p tsconfig.json --noEmit
grep -n "correlation" services/connector-runtime/src/activities/_shared/event-publisher.ts
```

### T02 — Diagnose the empty Recent calls (report task, no code)

In the live dev cluster, determine and RECORD in the task report which of these
is true today (fix nothing yet — T03's design depends on the answer):

- Does the deployed connector-runtime image emit `endpoint_call_completed`?
  (`kubectl logs` for "published endpoint_call event" after an e2e run)
- Do the events reach `tracking.tracked_events`? (SQL count by type, last 24h)
- Does audit-service persist them? (its `/events?type=` response — for the
  record only; audit stays untouched)

**Accept**
```
./scripts/e2e-http-workflow.sh   # exit 0, then evidence of all three answers in the report
```

### T03 — Ingester read endpoint: events by type/resource + gateway proxy

- Ingester: `GET /events?type=<t>&resource=<r>&from=<iso>&limit=<n>` (tenant
  header required), ordered `occurred_at DESC`, payloads EXCLUDED (chain-list
  decision), returns envelope metadata + summary fields the console needs
  (`correlation_id`, `event_id`, `occurred_at`, selected payload scalars:
  `method`, `resolvedUrl`, `status`, `durationMs`, `cacheResult` — projected
  server-side, NOT the full payload).
- Index if the query plan needs it: `(tenant, event_type, occurred_at DESC)`,
  idempotent SQL.
- Gateway: mirror route in `modules/tracking` (read-only proxy precedent),
  global guards apply.
- Unit tests: filtering, tenant scoping, projection excludes bodies, limit cap.

**Accept**
```
cd services/tracking-ingester-service && bun test
cd services/api-gateway && bun test
```

### T04 — Console: Recent calls reads tracked_events + links to the real trace

- `connector-call.service.ts` switches from `${AUDIT}/events` to the new gateway
  tracking route. Window default 7 days (was 60 min), `limit` unchanged.
- Trace link per row → `/processes/trace/<correlation_id>` (now the run's real
  correlation thanks to T01; pre-fix rows link to their orphan correlation —
  acceptable, do not special-case).
- Empty state copy tells the user the window ("No calls in the last 7 days").
- Component/service specs updated; remove the audit-specific mapping only if
  nothing else uses it.

**Accept**
```
cd services/admin-console && pnpm test
grep -rn "AUDIT" services/admin-console/src/app/core/services/connector-call.service.ts | wc -l   # expect 0
```

### T05 — Deep links: trace/run-view detail cards → entity screens

- Pure mapping function (one file, console `domain/`):
  event `{type, resource, payload}` → route:
  - `connector.endpoint_call.completed.v1` + `resource: adapter/<id>` →
    `/connections/http/<id>`
  - mcp call events → `/connections/mcp/<id>`
  - agent `execution_*` events (payload `agentId`) → `/ai/agents/<agentId>`
  - hosted `serviceCall` events → `/connections/hosted-services` (list — no
    detail route exists; do NOT build one here)
  - unknown → no link (function returns null; card shows nothing).
- "Open <entity>" button in the causal-graph detail card AND the run-view popup,
  rendered only when the mapping resolves. Payload button untouched.
- Unit tests: one per mapping + null case; component specs for conditional render.

**Accept**
```
cd services/admin-console && pnpm test
```

### T06 — Cluster e2e: correlation round-trip + navigation contract

- Extend `scripts/e2e-http-workflow.sh`: after the run, assert the
  `endpoint_call_completed` row shares the run's `correlation_id` (SQL), and the
  new `/events?type=...` endpoint returns it through the gateway.
- Verify in the built image (G6b): Recent calls shows the e2e call; its trace
  link opens the run's correlation; the node's "Open connector" resolves.
- Record the before/after orphan-correlation count for endpoint_call events in
  the task report (evidence the fix works at volume).

**Accept**
```
./scripts/e2e-http-workflow.sh   # exit 0 including new assertions
```

### T07 — Docs + index

- `services/connector-runtime/README.md`: causal contract of endpoint_call events
  (fields, fallback semantics).
- `services/tracking-ingester-service/README.md`: the `/events` read endpoint.
- `SCHEMAS.md`: note the causal fields now populated on endpoint_call envelopes.
- Register the queue in `cowork/INDEX.md` (Engram topic
  `tracking/connector-trace-linking`).

**Accept**
```
grep -n "connector-trace-linking" cowork/INDEX.md
```

---

- [x] T01 causal threading endpointCall
- [ ] T02 diagnose empty Recent calls (report)
- [ ] T03 ingester /events endpoint + gateway proxy
- [ ] T04 Recent calls on tracked_events + trace links
- [ ] T05 deep links detail card → entity screens
- [ ] T06 cluster e2e correlation round-trip
- [ ] T07 docs + index

## Out of scope (explicit)

- Backfilling correlations of historical endpoint_call events (orphans stay orphans).
- New "recent activity" sections on agent/mcp/hosted screens (future queue —
  T03's endpoint already supports them by `type`/`resource` when that day comes).
- A hosted-services DETAIL page (deep link targets the list until one exists).
- Rendering payloads on entity screens (payload viewing stays in the trace, with
  its admin guard + audit trail).
- Extending audit-service in any way (payload-capture decision stands).

## Human boundaries for this change

- Approving this SPEC before the first run.
- T02's verdict: if the diagnosis reveals events are NOT being emitted at all in
  the cluster, deciding whether to pause the queue for an infra fix is a human call.
- Any new deep-link mapping beyond the four entity types listed in T05.
- Changing the 7-day Recent calls window default.
