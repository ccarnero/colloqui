# SPEC — Long-running agent executions: async survives past the HTTP timeout without contention

> Task queue for the `/manual-loop` command. One task at a time, gated by tests
> and dual review. Queues for this loop live in `manual-loops/agents/`.
> Depends on: G0 green (2026-07-29 generation); relates to the invoke
> ackWait work (`services/connector-runtime/src/invoke-consumer-main.ts`,
> commit f096a97a) and the caps invariant of
> `manual-loops/architecture/system-validation.md`.
> Origin: user decisions 2026-07-30 (Cowork session).
> Engram topic: 'agents/long-running-executions'.

## Goal

An agent execution that takes LONGER than any default HTTP timeout completes
correctly through the async path — the caller gets its handle immediately,
the result arrives via poll/event, nothing times out, nothing is redelivered,
and the platform's resources stay flat while it waits. Proven by a
deterministic, repeatable e2e — not by anecdote.

## User decisions (human boundary — do not reinterpret)

1. (2026-07-30) Slowness is simulated with a DETERMINISTIC test-only delay
   mechanism inside the real execution path (no real slow LLM, no executor
   mock): duration is a parameter of the e2e.
2. (2026-07-30) Evidence bar = async contract AND resources: immediate
   handle, no live HTTP connection during the wait, correct result delivery,
   ZERO NATS redeliveries, plus before/during/after resource measurements.
   Load testing (N concurrent long executions) is explicitly OUT — one
   normal workflow running DURING the long execution is the contention probe.
3. Target long duration: 120 seconds by default (longer than common client
   defaults, far under the Knative 960s revision timeout and Temporal agent
   budgets). T01's timeout inventory may adjust this number — with human
   sign-off, recorded here as a dated amendment.
4. The delay hook is env-gated OFF by default: enabled only where the dev
   overlay explicitly turns it on. Production behavior is byte-identical
   when the gate is off.
5. (2026-07-30, T03 amendment — human approved) The direct submit path
   cannot carry `__test_delay_ms`: both `CreateExecutionDto` classes
   (api-gateway `runtime.dto.ts`, ai-agent-gateway `executions.dto.ts`)
   whitelist fields with `forbidNonWhitelisted` (live-proven 400).
   AMENDMENT: the read-only boundary is lifted MINIMALLY for T03 — add an
   optional pass-through object field (`metadata`) to both DTOs so the
   execution input can carry the test key. No other gateway change.
   Additionally: the delay gate env var is made live by applying the full
   dev overlay (`kubectl apply -k knative/services/overlays/local/postgres-dev`)
   — `rebuild-redeploy.sh` alone never re-applies overlay env.

## Prior art (validated 2026-07-30 — REUSE, do not duplicate)

The engine does not forward this section — repeat citations inside tasks.

- Async execution spine: `packages/shared/src/execution-client.ts:78-161`
  (publishes `execution_requested` to JetStream) →
  `services/agent-ai-service/src/nats-handlers/execution.handler.ts:163-292`
  (`execution_started` / `execution_completed` with full payload) →
  `services/ai-agent-gateway/src/modules/executions/executions.service.ts`
  (persists execution status to Redis; K7-allowlisted as fast).
- agent-ai-service's durable consumer
  (`src/modules/nats-consumer/multi-tenant-consumer.service.ts:50-68`) —
  PRE-VALIDATED 2026-07-30: `ackWaitMs` defaults to 900_000
  (`config.ts:76-81`, deliberately matched to Temporal's
  `AGENT_CALL_TIMEOUT_MS`), backoff `[900s,1200s,1800s,3600s]`, AND the
  runner heartbeats `msg.working()` every 30s while the handler is in
  flight (`packages/database/src/nats-consumer-runner.ts:494-531`). The
  120s target fits with 7.5× margin against ackWait alone; T01 confirms
  and records this rather than discovering it.
- Temporal budgets for `agentCall`: 15m startToClose + 30s heartbeat
  (`services/workflow-service/src/temporal/workflows.ts:146-190`).
- Knative timeout floor: gateway/ai-agent-gateway `timeoutSeconds >= 960`,
  guarded by K8 (`scripts/checks/doc-code-guards.sh`).
- E2E conventions to copy: `scripts/e2e/http-workflow.sh` — stage-per-function,
  exit-code contract, per-run account-scoped triggers + trap-guarded cleanup
  (isolation rules from `connector-trace-linking.md` T08), echo-agent
  provisioning stages.
- Resource observation precedent: `kubectl top` + JetStream consumer info
  (`nats consumer info` / JSM API: `num_redelivered`, `num_ack_pending`).

## Constraints (apply to every task)

- Never weaken, skip, or delete existing tests — automatic reviewer rejection.
- Verbose logging on every new code path; nothing fails silently.
- The delay hook NEVER ships enabled: env-gated (decision 4), default off,
  and its gate + semantics documented in the service README in the same task.
- Fire-and-forget and causal-chain contracts untouched (AGENTS.md).
- Hard gate assertions only on DETERMINISTIC facts (status codes, completion,
  redelivery counts, ack-pending draining to zero). Resource numbers (memory,
  CPU) are REQUIRED report evidence with generous sanity ceilings — never
  tight thresholds that flake on dev hardware.
- Repo style wins per service; touched services: agent-ai-service (+ e2e
  scripts). ai-agent-gateway and workflow-service are read-only unless T01
  findings force otherwise (then STOP — human boundary).

## Gates (the `/manual-loop` command runs these verbatim, in order)

```
# G0 — repo guards (doc/code drift, cheap, every attempt)
./scripts/checks/doc-code-guards.sh
# G1 — agent-ai-service tests + typecheck (from T02 onward)
cd services/agent-ai-service && bun test && bunx tsc -p tsconfig.json --noEmit
# G2b — COMMIT GATE (once per task, built image)
./rebuild-redeploy.sh agent-ai-service dev && ./scripts/e2e/http-workflow.sh
```

Gate rules (self-contained): G2b keeps the EXISTING e2e green (regression);
the new long-execution e2e joins G2b from T03 onward. Commits only on built
image.

PRECONDITION: `./scripts/validate-dev-mode.sh --with-e2e` must be green once
before T01; if it fails, skip iteration dev-mode use and rely on G2b — and
RECORD the skip (date + symptom) in Progress as a pending repair item (see
`manual-loops/architecture/dev-mode-validator-fix.md`).

---

## Task queue

### T01 — Timeout & ack inventory (report task, no code)

Map every timeout/ack budget a 120s execution crosses, and RECORD in Progress
as "**T01 findings (recorded <date>):**", numbered, with file:line evidence:

- agent-ai-service consumer `ackWaitMs`
  (`src/modules/nats-consumer/multi-tenant-consumer.service.ts`) — and
  whether the handler holds the message for the whole execution or acks
  early. **The invariant to pin: delay < ackWait, or the design acks before
  executing.** If 120s violates it, propose the adjustment (decision 3
  amendment path).
- ai-agent-gateway execution flow: what the caller receives immediately, how
  results are exposed (Redis status endpoint? `execution_completed` event?),
  any polling endpoint's own timeout.
- HTTP hops and their defaults: client → api-gateway → ai-agent-gateway
  (Knative 960s floor per K8), any internal fetch defaults in the path.
- Temporal budgets for the workflow path (`workflows.ts:146-190`): confirm
  120s fits inside heartbeat + startToClose.
- The e2e echo agent: how `scripts/e2e/http-workflow.sh` provisions it and
  whether its execution goes through the REAL `execution.handler.ts` path.

**Accept**
```
grep -n "T01 findings" manual-loops/agents/long-running-agent-executions.md
```

### T02 — Deterministic delay hook in the real execution path

- In agent-ai-service, inside the real execution pipeline (the path
  `execution.handler.ts` drives — exact insertion point per T01 findings):
  when the gate env var (e.g. `AGENT_TEST_DELAY_ENABLED=true`) is on AND the
  execution's variables/context carry the test key (e.g.
  `__test_delay_ms: <n>`), await that delay before producing the response.
  Cap the accepted delay (e.g. ≤ 600_000) and log start/end with
  executionId + tenant, verbose.
- Gate off (default, and always in prod overlays) → the key is ignored and
  logged at debug. Dev overlay (`knative/services/base` env or dev patch)
  turns the gate on — same task, same commit.
- Heartbeat/keepalive: if T01 found the consumer holds the message, emit
  whatever keepalive the manager supports during the delay (or ack-early per
  the pinned invariant) — never let the delay outlive ackWait silently.
- Unit tests: delay applied when gated on, ignored when off, cap enforced,
  delay does not swallow errors, `execution_completed` still carries the
  full payload contract.
- Document the hook (gate, key, cap, purpose) in the service README.

**Accept**
```
cd services/agent-ai-service && bun test && bunx tsc -p tsconfig.json --noEmit
grep -n "AGENT_TEST_DELAY" services/agent-ai-service/src -r | head -3
```

### T03 — Long-execution e2e: direct async path + contention probe

New `scripts/e2e/long-agent-execution.sh` (copy the stage/exit-code/cleanup
conventions of `scripts/e2e/http-workflow.sh`, per-run isolation incl. its
own ephemeral agent with `__test_delay_ms=120000`):

1. **Immediate handle**: fire the execution via the gateway; assert the
   response (execution id / 202-equivalent) arrives in < 5s and the client
   connection CLOSES (the poller is a separate later process — no connection
   is held during the wait).
2. **Contention probe**: while the long execution waits, run one normal
   `e2e-http-log`-style workflow and assert it completes within its normal
   budget — the long execution must not stall unrelated work.
3. **Completion**: poll until the long execution completes; assert total
   duration ≥ the injected delay (it really waited) and the result payload
   is complete.
4. **Zero redeliveries**: after completion, read the agent-ai consumer's
   JetStream info and assert `num_redelivered` did not grow during the run
   and `num_ack_pending` drained to 0.
5. **Resource evidence (report, sanity-ceiling only)**: capture
   `kubectl top pod` for agent-ai-service + ai-agent-gateway before/during/
   after; record the three snapshots in the task report; fail only if
   during-wait CPU of agent-ai-service exceeds a generous idle ceiling
   (a sleeping execution must look like sleep, not like a busy-wait).

**Accept**
```
./rebuild-redeploy.sh agent-ai-service dev
./scripts/e2e/long-agent-execution.sh
```

### T04 — Workflow path: agentCall over the long agent

- Extend the long-execution e2e (or a stage within it): a workflow whose
  `agentCall` targets the delayed agent; assert the run completes, Temporal
  heartbeats covered the wait (no `startToClose`/heartbeat failure), the
  run's trace carries ONE `execution_completed` for it (no duplicates), and
  the normal-workflow probe still passes alongside.

**Accept**
```
./scripts/e2e/long-agent-execution.sh   # exit 0 including the workflow stage
```

### T05 — Docs + index

- `services/agent-ai-service/README.md`: the async-execution timeout
  contract (every budget from T01, in one table) + the delay hook.
- `DOCS/guides/` or `DOCS/agents/`: where long-running executions are
  explained for feature authors ("your agent may take minutes — this is the
  contract that protects you").
- `cowork/INDEX.md` entry; Engram topic `agents/long-running-executions`.

**Accept**
```
grep -n "long-running" cowork/INDEX.md
grep -n "AGENT_TEST_DELAY" services/agent-ai-service/README.md
```

---

## Progress

- [x] T01 timeout & ack inventory (report)
- [x] T02 deterministic delay hook
- [x] T03 long-execution e2e + contention probe
- [ ] T04 workflow agentCall path
- [ ] T05 docs + index

**T01 findings (recorded 2026-07-30):** every budget below was read
first-hand at the cited file:line. **Verdict: the 120s default of decision 3
fits every budget with margin — no amendment needed, and NO change to
ai-agent-gateway or workflow-service is required (both stay read-only).**

1. **agent-ai-service consumer ackWait — the message IS held for the whole
   execution, and that is safe.**
   - `multi-tenant-consumer.service.ts:60-67` sets
     `ackWaitMs: agentAiServiceConfig.consumerAckWaitMs`,
     `backoffMs: [900_000, 1_200_000, 1_800_000, 3_600_000]`, and
     `runnerOptions: { workingIntervalMs: agentAiServiceConfig.consumerWorkingIntervalMs }`.
   - `services/agent-ai-service/src/config.ts:76-81` — `consumerAckWaitMs`
     defaults to `900_000` (`AGENT_AI_CONSUMER_ACK_WAIT_MS`);
     `config.ts:88-93` — `consumerWorkingIntervalMs` defaults to `30_000`
     (`AGENT_AI_CONSUMER_WORKING_INTERVAL_MS`). Neither var is overridden in
     any Knative manifest (`rg AGENT_AI_CONSUMER_ACK_WAIT_MS knative/` → no
     hits), so the deployed values ARE the defaults.
   - Hold-vs-ack-early: `packages/database/src/nats-consumer-runner.ts:491-517`
     — `processOne` does `await this.handler(msg); msg.ack();`. The ack
     happens strictly AFTER the handler returns, i.e. after
     `generateReply`. There is NO ack-before-execute design.
   - Keepalive: `nats-consumer-runner.ts:524-539` — `startWorkingTimer`
     calls `msg.working()` on a `setInterval(intervalMs)` for the whole
     in-flight window, cleared in the `finally` at line 513-516.
   - **Invariant pinned: delay < ackWait.** 120_000 ms < 900_000 ms
     (7.5× margin), and `msg.working()` fires 4× during a 120s delay
     (30s interval), so the server-side deadline is extended long before
     it can expire. Backoff step 0 (`900_000`) also overrides `ack_wait`
     per `packages/database/src/nats-durable-consumer.ts:26-37`, so the
     effective first redelivery window is 900s either way. No decision-3
     amendment is proposed.
   - Backpressure/concurrency caveat (design note, not a blocker):
     `nats-durable-consumer.ts:13` `DEFAULT_MAX_ACK_PENDING = 1000`, and
     `multi-tenant-consumer-manager.ts:324-334` builds ONE
     `NatsConsumerRunner` per tenant stream with only the
     `workingIntervalMs` runner option — `concurrency` is unset, so
     `nats-consumer-runner.ts:427-431` takes the serial path
     (`concurrency = 1`). Consequence: while a 120s execution is in
     flight, OTHER agent messages of the SAME tenant queue behind it
     (they are not lost, not redelivered — `num_ack_pending` will read 1
     and drain). The T03 contention probe (`e2e-http-log`: jsFunction +
     endpointCall + serviceCall, `scripts/e2e/http-workflow.sh:684-721`)
     touches neither agent-ai-service nor its consumer, so it is a valid
     probe. But T04's `agentCall` stage MUST be sequenced AFTER the T03
     long execution completes (or its total duration budgeted as
     delay + delay), because same-tenant agent work serializes.

2. **ai-agent-gateway execution flow — fully async, nothing holds a
   connection for the wait.**
   - Submit: `services/ai-agent-gateway/src/modules/executions/executions.controller.ts:29-37`
     — `POST /runtime/executions` with `@HttpCode(HttpStatus.ACCEPTED)`
     (202) → `executions.service.ts:113-123` `submitExecution` →
     `packages/shared/src/execution-client.ts:78-161`, which seeds Redis
     (`pending` + `status`) and JetStream-publishes
     `execution_requested` with `Nats-Msg-Id` dedup, then returns
     `{ executionId, status: "accepted" }` (line 160) immediately. No
     wait, no timeout on this path.
   - Result exposure — BOTH mechanisms exist:
     (a) Redis status endpoint `GET /runtime/executions/:id`
     (`executions.controller.ts:39-45` → `executions.service.ts:125-163`
     → `execution-client.ts:163-174`), fed by the gateway's own durable
     projector `ai-agent-gateway-results`
     (`executions.service.ts:61-67, 89-104, 379-411` →
     `execution-client.ts:334-347 persistExecutionStatus`);
     (b) the `execution_completed` bus event published by
     `services/agent-ai-service/src/nats-handlers/execution.handler.ts:175-192`
     (full payload: response, usage, costUsd, toolCalls, toolResults,
     model, provider) on
     `evt.<tenant>.ai-agent-gateway.automation.platform.internal.execution_completed.v1`
     (`execution.handler.ts:394-395`).
   - Redis TTLs: `RESULT_TTL = 3600` and `PENDING_TTL = 3600` seconds
     (`packages/shared/src/constants.ts:17-18`) — 30× the 120s target, so
     a poller cannot miss the result by TTL expiry.
   - Polling endpoint's own timeout: none of its own; it is a single
     Redis GET. `getExecution` throws 404 until the projector writes the
     terminal state (`executions.service.ts:129-132`) — the poll loop in
     T03 must tolerate the pre-terminal `state: "pending"/"started"`
     rather than treating it as failure.
   - The only wait-bearing API is `waitForExecutionResult(..., timeoutMs)`
     (`execution-client.ts:176-283`) — an in-process NATS subscription
     with a caller-supplied timeout, used by the WORKFLOW path (finding 4),
     never by the HTTP submit path.
   - Streaming variant (`POST /runtime/executions/stream`,
     `executions.controller.ts:61-77` → `executions.service.ts:201-377`)
     DOES hold an SSE connection and would violate the "no live HTTP
     connection during the wait" bar of decision 2 — T03 must use the
     async submit + poll path, not this one.
   - Agent-side wall-clock ceiling on the buffered path:
     `execution.handler.ts:155-161` aborts via
     `agentAiServiceConfig.bufferedExecutionTimeoutMs`, default `900_000`
     (`config.ts:113-118`, `AGENT_BUFFERED_EXECUTION_TIMEOUT_MS`, not
     overridden in Knative). 120s < 900s — the delay hook of T02 must sit
     INSIDE this window (it does), and T02 must not disable this abort.

3. **HTTP hops — the 120s never rides on one.**
   - client → api-gateway: `services/api-gateway/src/modules/runtime/runtime.controller.ts:25-38`
     (`POST /api/runtime/executions`, 202) and `:40-51`
     (`GET /api/runtime/executions/:id`).
   - api-gateway → ai-agent-gateway: `runtime-proxy.service.ts:43` uses
     `AbortSignal.timeout(PROXY_TIMEOUT_MS)` with
     `services/api-gateway/src/constants.ts:5` `PROXY_TIMEOUT_MS = 30_000`.
     This 30s cap is the TIGHTEST internal fetch default in the path — and
     it is fine, because both hops it guards are sub-second (a JetStream
     publish and a Redis GET). It would only bite if someone made the
     submit endpoint synchronous, which this loop must not do.
   - Knative revision timeouts: `knative/services/base/api-gateway.yaml:30`
     and `knative/services/base/ai-agent-gateway.yaml:25` both declare
     `timeoutSeconds: 3600`, above the K8 floor of 960 enforced by
     `scripts/checks/doc-code-guards.sh:394-398` (`min_required=960`,
     "900s AGENT_CALL_TIMEOUT_MS + 60s margin"). Cluster ceiling is set in
     `knative/serving/config-defaults.yaml:9-13`.
   - e2e client-side: `scripts/e2e/http-workflow.sh:508-510` and `:527-529`
     bound every `api()`/`api_status()` curl with
     `--connect-timeout 10 --max-time 45`. The submit POST returns in
     milliseconds so this is fine, but the new T03 script MUST NOT wrap
     the 120s wait in a single curl — it has to poll.

4. **Temporal budgets — 120s fits, with heartbeats covering it.**
   - `services/workflow-service/src/temporal/workflows.ts:181-190`:
     `httpAgent = proxyActivities<IAgentHttpActivities>({ startToCloseTimeout: "15m",
     heartbeatTimeout: "30s", retry: { maximumAttempts: 3, initialInterval: "1s",
     backoffCoefficient: 2, maximumInterval: "60s" } })` — confirmed
     verbatim, exactly the 15m + 30s the SPEC expected.
   - Heartbeat emission:
     `services/workflow-service/src/temporal/activities/agent-call.activity.ts:267-276`
     — `setInterval(() => Context.current().heartbeat(), 15_000)`, cleared
     in `finally` (line 346-348). 15s emit vs 30s `heartbeatTimeout` → a
     120s wait produces ~8 heartbeats; no `heartbeatTimeout` failure.
   - Activity-level wait:
     `agent-call.activity.ts:20-23` `AGENT_CALL_TIMEOUT_MS` defaults to
     `15 * 60 * 1000` (900_000), used at `:265` as
     `timeout = agentTimeoutMs ?? AGENT_CALL_TIMEOUT_MS` and passed to
     `client.executeAndWait(tenantId, args, timeout, ...)` at `:279`.
     120s < 900s < 15m startToClose — ordered correctly at every level.
   - NOTE: the workflow `agentCall` does NOT traverse ai-agent-gateway over
     HTTP. `agent-call.activity.ts:88-99` builds its own
     `YoizenClawExecutionClient` and publishes `execution_requested`
     straight to JetStream, then waits on core NATS
     (`execution-client.ts:285-301 executeAndWait`). So the api-gateway 30s
     proxy cap of finding 3 is irrelevant to the workflow path.
   - Retry-safety during a long wait:
     `agent-call.activity.ts:241-255 deriveStableExecutionId` pins the
     executionId to `runId:activityId` so retries reuse it; the comment at
     `:294-304` records that `requestedAt` still drifts the
     `Nats-Msg-Id` hash and only JetStream's 2-minute duplicate window
     collapses retries. A 120s delay sits right at that 2-minute boundary —
     T04 must assert exactly ONE `execution_completed` (the SPEC already
     requires it) and must not introduce artificial activity retries.

5. **The e2e echo agent — provisioned declaratively, and its execution DOES
   go through the real `execution.handler.ts`.**
   - Provisioning: `scripts/e2e/http-workflow.sh:661-678` — a single
     `IntegrationManifest` PUT/apply (stages at `:765-773`) declaring
     `agents[0] = { name: "${AGENT_NAME}", profile: { system_prompt: ...,
     model_config: { provider: "mock", model: "echo" } } }`.
     `AGENT_NAME="e2e-http-agent-echo"` is FIXED and reused across runs
     (`:246`), unlike the nonce-suffixed workflow names.
   - It is consumed by the second workflow `e2e-http-agentflow`
     (`:734-758`), whose only action is
     `{ "activity": "agentCall", "args": { "agentId": { "agentRef": ... },
     "message": "{{request.text}}" } }`, sharing the http trigger.
   - Real path, confirmed end to end: workflow `agentCall` →
     `agent-call.activity.ts:279 executeAndWait` →
     `execution-client.ts:121-158` publish `execution_requested` →
     agent-ai-service consumer filter subject
     `evt.*.ai-agent-gateway.automation.platform.internal.execution_requested.v1`
     (`multi-tenant-consumer.service.ts:29`) → `handleMessage`
     (`:89-91`) → `message-router.service.ts:77-79`
     `case "execution_requested": await this.executionHandler.handle(...)`
     → `execution.handler.ts:76-137`. `stream` is absent on the workflow
     payload, so it lands in `handleBuffered` (`:139-222`) — the real
     pipeline, no mock handler. That is the insertion point T02 targets.
   - The "mock" is only the LLM provider, not the execution path:
     `services/agent-ai-service/src/modules/llm/provider-registry.service.ts:82-84`
     routes `provider === "mock"` to `createMockModel`, which HARD-FAILS
     unless `RUNTIME_ALLOW_MOCK_PROVIDER=true` (`:113-119`). The dev
     overlay sets it —
     `knative/services/overlays/local/postgres-dev/env-patches.yaml:581-582`
     (and the mongo-dev overlay at `:637`) — so the dev cluster already
     runs this agent for real, echoing in ~10ms/chunk (`:147`).
   - **Isolation warning for T02/T03:** because `AGENT_NAME` is fixed and
     shared, the delay hook must NEVER be attached to
     `e2e-http-agent-echo` — `scripts/e2e/http-workflow.sh:311`
     `POLL_TIMEOUT_S="${E2E_POLL_TIMEOUT_S:-120}"` means a 120s delay on
     that agent would push the EXISTING G2b e2e past its poll budget and
     turn G2b red. T03's own ephemeral, nonce-scoped agent (already
     mandated by the SPEC) is the hard requirement, not a preference.

**Summary table (all confirmed, none violated by 120s):** consumer ackWait
900s (+ `msg.working()` every 30s) | buffered-execution abort 900s |
Temporal `startToClose` 15m / `heartbeatTimeout` 30s (heartbeat emitted
every 15s) | `AGENT_CALL_TIMEOUT_MS` 900s | Knative revision 3600s (floor
960s) | api-gateway proxy fetch 30s (guards only sub-second hops) | Redis
result TTL 3600s | JetStream duplicate window 120s (retry-dedup only).
Tightest budget the 120s wait actually crosses: the 900s ackWait —
7.5× margin.

## Out of scope (explicit)

- Load testing (N concurrent long executions) — decision 2; a future loop if
  the single-probe evidence warrants it.
- Real slow LLM calls or provider changes (decision 1).
- Streaming/partial-result delivery for long executions — separate feature.
- Changing ackWait/heartbeat budgets — if T01 shows 120s does not fit, that
  is a finding + human decision, not a silent adjustment.
- connector-runtime's invoke path (covered by its own ackWait work and the
  system-validation invariant).

## Human boundaries for this change

- Human approves this SPEC before the first run (including the 120s default
  and the delay-hook design of decision 4).
- Any change to the target duration or to ack/heartbeat budgets (T01
  amendment path).
- If T01 findings require touching ai-agent-gateway or workflow-service,
  STOP and re-plan with the human.
