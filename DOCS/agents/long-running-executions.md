# Long-Running Agent Executions

**Your agent may take minutes. This is the contract that protects you.**

A tool chain that calls three slow APIs, a reasoning model that thinks for
ninety seconds, an MCP server on a bad day — none of these are incidents on
this platform. Agent execution is asynchronous end to end: the caller gets a
handle immediately, nothing holds an HTTP connection while the agent works,
and the result is collected afterwards. This page is the contract a feature
author can rely on, plus the two things that will bite you if you ignore them.

Audience: feature implementers writing agents, workflows, or clients that call
agents. Runtime mechanics of a single `agentCall` live in
[Agent Execution Flow](./execution.md); the authoritative budget table lives in
[`services/agent-ai-service/README.md`](../../services/agent-ai-service/README.md)
("Async execution timeout contract").

## The contract in five lines

1. **You get a handle immediately.** `POST /api/runtime/executions` answers
   **202** with `{ executionId, status: "accepted" }` in milliseconds — the
   `@Post()` handler on `ExecutionsController` (`@Controller("runtime/executions")`)
   is annotated `@HttpCode(HttpStatus.ACCEPTED)`.
   It publishes `execution_requested` to JetStream and returns — it never waits
   for the agent.
2. **The connection closes.** No live HTTP connection exists while the agent
   works, so no client, proxy, or ingress timeout can kill an execution.
3. **You collect the result later**, by polling
   `GET /api/runtime/executions/:id` (a single Redis GET) or by subscribing to
   the `execution_completed` bus event. The Redis record lives for **3600 s**.
4. **Nothing is redelivered while you wait.** The consumer holds the JetStream
   message for the whole execution and heartbeats it (`msg.working()`) every
   **30 s** against a **900 s** ack wait.
5. **A workflow `agentCall` is covered too.** Temporal gives the activity
   **15 min** (`startToClose`) with a **30 s** `heartbeatTimeout` and a
   heartbeat emitted every **15 s**, so a multi-minute agent never trips a
   heartbeat failure.

## How to call a long-running agent

### Direct (HTTP client, SDK, hosted service)

```bash
# 1. Submit — returns in milliseconds
curl -X POST "$API/api/runtime/executions" \
  -H "Authorization: Bearer $TOKEN" -H "x-yoizen-tenant: acme" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"<uuid>","message":"summarise this ticket"}'
# 202 {"executionId":"...","status":"accepted"}

# 2. Poll — tolerate the pre-terminal states
curl "$API/api/runtime/executions/<executionId>" \
  -H "Authorization: Bearer $TOKEN" -H "x-yoizen-tenant: acme"
# {"state":"pending"|"started"|"completed"|"failed", "result":{...}}
```

Rules for the poller:

- `pending` and `started` are **not** failures — the projector writes the
  terminal row only when `execution_completed` arrives. Poll on an interval
  (a few seconds); never treat a non-terminal read as an error.
- Do **not** wrap the wait in a single long request. The submit and the poll
  are two short requests by design.
- Do **not** use `POST /api/runtime/executions/stream` if your goal is merely
  "wait for the answer": that variant holds an SSE connection open for the
  whole execution, which is exactly what the async contract avoids. Use it only
  when you actually want token-by-token streaming
  ([runtime-streaming](../architecture/runtime-streaming.md)).

### From a workflow

Use the `agentCall` action. The activity submits to JetStream and waits on core
NATS — it does **not** traverse the api-gateway, so the 30 s proxy fetch
timeout of the HTTP path is irrelevant to it (`executeAgentCall` in
`services/workflow-service/src/temporal/activities/agent-call.activity.ts` drives
`YoizenClawExecutionClient.executeAndWait`, whose submit is `js.publish` and whose
wait is `nc.subscribe`).
Temporal's heartbeats cover the wait; you write nothing extra.

```json
{ "name": "callAgent", "activity": "agentCall",
  "args": { "agentId": { "agentRef": "my-agent" }, "message": "{{request.text}}" } }
```

## Two things that will bite you

### 1. The agent-ai consumer is SERIAL per tenant

One consumer runner per tenant stream. `MultiTenantConsumerManager` builds each
`NatsConsumerRunner` from `config.runnerOptions`, and agent-ai-service passes only
`workingIntervalMs` there — no `concurrency`. `NatsConsumerRunner` defaults
`concurrency` to `1` and, for `1`, dispatches to `runSerial` instead of
`runConcurrent`. While a 120 s
execution of tenant X is in flight, **other agent messages of that same tenant
queue behind it**. They are not lost and not redelivered — `num_ack_pending`
reads 1 and drains — but they wait.

Consequences for your design:

- Anything that must stay responsive while a long agent execution runs must
  **not** go through agent-ai-service. A workflow of `jsFunction` +
  `endpointCall` + `serviceCall` steps is unaffected and keeps its normal
  latency (this is exactly what the e2e's contention probe proves: ~6-7 s while
  a 120 s agent execution waits).
- Two long agent executions for the same tenant run one after the other. Budget
  their total, or use different tenants.

### 2. Everything has a budget — know which one you are near

The full table (13 budgets, each with `file:line`) is in
[`services/agent-ai-service/README.md`](../../services/agent-ai-service/README.md).
The ones a feature author actually feels:

| If your execution takes… | What happens |
|---|---|
| seconds to a few minutes | Nothing special. This is the designed case. |
| > 900 s (15 min) | The buffered-execution wall clock aborts it (`AGENT_BUFFERED_EXECUTION_TIMEOUT_MS`), and the consumer ack wait is at the same 900 s. Split the work or make the agent asynchronous internally. |
| > 15 min inside a workflow | Temporal's `startToClose` for `agentCall` ends the attempt. Same remedy. |
| > 3600 s before you poll | The Redis result record has expired. Subscribe to `execution_completed` instead of polling that late. |

The one budget that surprises people is the **30 s** api-gateway → ai-agent-gateway
proxy fetch (`PROXY_TIMEOUT_MS` in `services/api-gateway/src/constants.ts`). It is fine because it
only guards sub-second hops (a JetStream publish and a Redis GET). It would
only become a problem if someone made the submit endpoint synchronous — do not.

## How this is proven

`scripts/e2e/long-agent-execution.sh` runs against the dev cluster and exits 0
only if all of the following hold. Slowness is injected deterministically by
the env-gated test-delay hook (`AGENT_TEST_DELAY_ENABLED` +
`__test_delay_ms`, default 120 000 ms — see the service README), never by a
real slow model:

| Evidence | Assertion |
|---|---|
| Immediate handle | 202 + `executionId` in **< 5 s** (curl's own `time_total`), and a follow-up GET reports `pending`/`started` — proving no result was delivered on the submit connection. |
| No held connection | The submit is a plain `POST` that returns and closes; the poller is a separate later process. |
| Contention probe | A normal workflow (jsFunction + endpointCall + serviceCall) completes within its budget **while** the long execution waits, and the long execution is verified to still be running at that moment. |
| Completion | Poll to terminal `completed`, wall-clock duration ≥ the injected delay, reply echoes the run's nonce, `model`/`provider`/`usage` present. |
| Zero redeliveries | The durable consumer's JetStream info (`num_redelivered`, `num_ack_pending`) sampled before / during / after: no growth, drains to 0. Plus exactly one handler delivery per execution, read from the service's own logs. |
| Resource flatness | `kubectl top pod` before / during / after for agent-ai-service and ai-agent-gateway. A waiting execution measures ~10-23 m CPU — indistinguishable from idle, i.e. a sleep, not a busy-wait. |
| Workflow path | A webhook-triggered workflow whose `agentCall` targets the delayed agent completes with no Temporal `failure`, lasts ≥ the delay, and its tracking chain carries **exactly one** agent `execution_completed` (and exactly one `execution_requested`, zero `execution_failed`) — the no-duplicate guard that matters because the 120 s wait sits right at JetStream's 120 s duplicate window. |

Loop record, decisions, and the full budget inventory:
`manual-loops/agents/long-running-agent-executions.md`.
