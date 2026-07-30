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

- [ ] T01 timeout & ack inventory (report)
- [ ] T02 deterministic delay hook
- [ ] T03 long-execution e2e + contention probe
- [ ] T04 workflow agentCall path
- [ ] T05 docs + index

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
