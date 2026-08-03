# agent-ai-service

AI-powered conversational agent service for the YoizenClaw platform. Handles LLM orchestration, tool execution, agent lifecycle, skill management, memory, and multi-agent coordination.

## Tech Stack

- **Runtime**: Bun 1.3
- **Framework**: NestJS 11 + Fastify
- **Language**: TypeScript 5.7 (strict)
- **Messaging**: NATS JetStream (consumer)
- **LLM**: Vercel AI SDK (OpenAI, Anthropic, Google)
- **Shared**: @yoizen/shared, @yoizen/observability, @yoizen/database

## Architecture

The service consumes CloudEvents from per-tenant NATS JetStream ingress streams and dispatches them to domain modules based on action type. It acts as the AI brain of the YoizenClaw platform — processing chat messages, executing tools, managing agent configurations, and coordinating multi-agent workflows.

## Development

```bash
pnpm install
bun run start:dev
```

Requires local NATS, Redis, and per-tenant database instances.

## Storage engine

Agent configuration repositories support Postgres (default) and Mongo,
selected once at bootstrap by `DB_ENGINE`: `agentAiServiceConfig.dbEngine`
calls `resolveStorageEngine()` (`src/config.ts:38-40`), which reads `DB_ENGINE`,
falls back to `STORAGE_ENGINE`, defaults to `postgres`, and throws on any other
value (`packages/database/src/engine.ts:13-23`). `ProvidersModule` branches the
tenant connection manager and its base DI token from that single value
(`src/providers/providers.module.ts:19-29`).

**One path ignores the setting on purpose**: `SYSTEM_VARIABLES_PG`
(`src/providers/providers.module.ts:31-40`) is ALWAYS backed by the Postgres
manager, because `SystemVariablesProvider` queries the tenant's
`system_variables` table as a server-side fallback when an incoming
chat/execution payload carries no `variables.system`. This mirrors
`workflow-service/src/providers/providers.module.ts`.

## Environment Variables

`src/config.ts` — lazy getters throughout.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (`src/config.ts:35-37`) |
| `DB_ENGINE` | `postgres` | Storage engine: `postgres` or `mongo`; falls back to `STORAGE_ENGINE` (`src/config.ts:38-40`) |
| `PLATFORM_ENVIRONMENT` | `dev` | Feeds in-cluster service URLs (`src/config.ts:41-43`) |
| `NATS_URL` | `nats://localhost:4222` | (`src/config.ts:44-46`) |
| `REDIS_URL` | `redis://localhost:6379` | (`src/config.ts:47-49`) |
| `MEMORY_SERVICE_URL` | `http://agent-memory-service:3000` | (`src/config.ts:50-52`) |
| `CONNECTOR_ADMIN_URL` | `http://connector-admin-api:3000` | (`src/config.ts:53-55`) |
| `AGENT_ADMIN_SERVICE_URL` | `platformServiceUrl("agent-admin-service", env)` | (`src/config.ts:56-61`) |
| `AGENT_TOOL_DESCRIPTION_OVERRIDES_ENABLED` | *(off)* | Enabled only on the literal `"true"` (`src/config.ts:62-64`) |
| `AGENT_MCP_TOOL_FILTERING_ENABLED` | *(off)* | When on, MCP tools are namespaced `"<serverName>__<toolName>"` and filtered by the agent's `enabled_mcp_tools`; when off, raw tool-name keys and no allowlist (`src/config.ts:65-78`) |
| `AGENT_AI_CONSUMER_ACK_WAIT_MS` | `900000` | Ack window for the multi-tenant NATS consumer. Handlers run `generateReply` — LLM + tool/MCP chains that routinely take minutes — so a smaller value causes mid-handler redelivery and DUPLICATE concurrent LLM executions (`src/config.ts:79-93`) |
| `AGENT_AI_CONSUMER_WORKING_INTERVAL_MS` | `30000` | How often the consumer calls `msg.working()` to extend the server-side ack deadline without waiting for the full window (`src/config.ts:95-106`) |
| `MCP_LIVE_CALL_TIMEOUT_MS` | `25000` | Bounded wait for live-chat MCP connect / discovery / execution (`src/config.ts:107-118`) |
| `AGENT_BUFFERED_EXECUTION_TIMEOUT_MS` | `900000` | Wall-clock ceiling for the buffered (non-streaming) execution path (`src/config.ts:119-131`) |
| `AGENT_TEST_DELAY_ENABLED` | *(off)* | Dev-only delay hook; off in every non-dev overlay (`src/config.ts:132-143`) |
| `AGENT_TEST_DELAY_MAX_MS` | `600000` | Hard-clamped to `AGENT_TEST_DELAY_HARD_CAP_MS` (`src/config.ts:32`), so it can only ever LOWER the ceiling; non-numeric or non-positive values fall back to the cap (`src/config.ts:144-161`) |

## Event Publishing — standalone LLM calls (`ai.llm_call.completed.v1`)

`manual-loops/connectors/connection-call-inspector.md` T04 closes a capture
gap: LLM calls made OUTSIDE a chat/agent execution — today just the
job-executor's `llm_call` action (`src/modules/job-executor/actions/llm-action.service.ts`
calling `src/modules/llm/llm-executor.service.ts`) — previously recorded
only cost (`cost-tracker.service.ts`), with no per-call request/response
capture. `LlmCallEventPublisherService`
(`src/modules/llm/llm-call-event-publisher.service.ts`) fills that gap by
publishing `ai.llm_call.completed.v1` after every standalone LLM call.

**Payload**: `model`, `provider`, `prompt` (truncated to 8192 chars via
`truncateText`, `src/modules/llm/truncate-text.ts`), `completion` (same
truncation), `inputTokens`, `outputTokens`, `cachedInputTokens`, `costUsd`,
`durationMs`. Resource: `execution/<executionId>`.

**Execution-path exclusion (do not double-capture)**: chat executions
already carry their own full payload (message, reply text,
toolCalls/toolResults, usage, cost) in `execution_completed`
(`src/nats-handlers/execution.handler.ts`) — they route through
`SessionChatService`/`execution.handler.ts`, which never depends on
`LlmCallEventPublisherService`. `LlmActionService.execute` is the ONLY
call site that publishes `ai.llm_call.completed.v1`, so the two payloads
never overlap for the same call.

**Causal contract**: when the job-executor has an incoming envelope for
the event that triggered the job (`job-executor.service.ts`'s `executeJob`
threading it down as `envelope`), the publisher calls `deriveEnvelope`
so the event joins that run's causal chain; otherwise it calls
`buildEventEnvelope` and the event is a causal root. A
`DepthExceededError` from either factory falls back to a root event
(warn-logged) — same fallback contract as
`services/connector-runtime/README.md`'s `event-publisher.ts` (the prior
art this publisher mirrors).

**Fire-and-forget**: `publish()` never throws synchronously; `emit()`'s
failures are caught and logged as warnings. `LlmActionService.execute`
additionally wraps the call site in try/catch so a misbehaving injected
publisher can never fail or delay the LLM action's result (SPEC
constraint) — capture is a pure observability side effect, not part of
the LLM call's critical path.

## Async execution timeout contract

An agent execution is **asynchronous end to end**: the caller gets a handle
immediately and the result arrives by poll or event. Nothing on the platform
holds an HTTP connection for the duration of an execution, so an execution
that runs for minutes is a normal case, not an incident. Every budget it
crosses is listed below — all values read first-hand at the cited `file:line`
and recorded as the T01 findings of
`manual-loops/agents/long-running-agent-executions.md`.

| # | Budget | Value | Where it is set | What it protects |
|---|---|---|---|---|
| 1 | Consumer `ackWait` (this service) | **900 s** | `src/config.ts:89-95` (`AGENT_AI_CONSUMER_ACK_WAIT_MS`), wired at `src/modules/nats-consumer/multi-tenant-consumer.service.ts:60-67` | The window before JetStream redelivers an un-acked `execution_requested`. The message is held for the WHOLE execution: `packages/database/src/nats-consumer-runner.ts:491-517` acks only after the handler returns. |
| 2 | `msg.working()` keepalive | every **30 s** | `src/config.ts:101-106` (`AGENT_AI_CONSUMER_WORKING_INTERVAL_MS`), emitted by `packages/database/src/nats-consumer-runner.ts:524-539` | Extends the server-side ack deadline while the handler is in flight, so budget 1 is refreshed rather than merely large. |
| 3 | Redelivery backoff | `[900 s, 1200 s, 1800 s, 3600 s]` | `multi-tenant-consumer.service.ts:60-67`; step 0 also overrides `ack_wait` per `packages/database/src/nats-durable-consumer.ts:26-37` | The effective first-redelivery window stays 900 s either way. |
| 4 | Buffered-execution wall clock | **900 s** | `src/config.ts:126-131` (`AGENT_BUFFERED_EXECUTION_TIMEOUT_MS`), aborted at `src/nats-handlers/execution.handler.ts:156-162` | Aborts a buffered execution (LLM included) so a caller that gave up never leaves compute burning. |
| 5 | Temporal `startToCloseTimeout` (`agentCall`) | **15 min** | `services/workflow-service/src/temporal/workflows.ts:181-190` | Ceiling for one `agentCall` activity attempt. |
| 6 | Temporal `heartbeatTimeout` | **30 s** | same `proxyActivities` block | Detects a dead worker mid-wait. |
| 7 | Temporal heartbeat emission | every **15 s** | `services/workflow-service/src/temporal/activities/agent-call.activity.ts:267-276` | Keeps budget 6 satisfied for the whole wait (~8 heartbeats across a 120 s execution). |
| 8 | `AGENT_CALL_TIMEOUT_MS` | **900 s** | `agent-call.activity.ts:20-23`, passed to `executeAndWait` at `:279` | The activity's own wait on the NATS result. |
| 9 | Knative revision timeout | **3600 s** (floor **960 s**) | `knative/services/base/api-gateway.yaml:30`, `knative/services/base/ai-agent-gateway.yaml:25`; floor enforced by `scripts/checks/doc-code-guards.sh` (K8) | Bounds any single HTTP request to the gateways. |
| 10 | api-gateway → ai-agent-gateway fetch | **30 s** | `services/api-gateway/src/constants.ts:5` (`PROXY_TIMEOUT_MS`), used at `runtime-proxy.service.ts:43` | The tightest internal fetch in the path — and it only ever guards sub-second hops (a JetStream publish, a Redis GET). It would only bite if the submit endpoint were made synchronous. |
| 11 | Redis result / pending TTL | **3600 s** | `packages/shared/src/constants.ts:17-18` | How long a poller can take to collect a terminal result. |
| 12 | JetStream duplicate window | **120 s** | NATS default on the ingress stream | Collapses retry re-submits whose `Nats-Msg-Id` hash drifted (see `agent-call.activity.ts:294-304`). |
| 13 | Test-delay hard cap | **600 s** | `src/config.ts` (`AGENT_TEST_DELAY_HARD_CAP_MS`) — see the next section | Keeps an injected delay strictly below budgets 1 and 4. |

**Ordering invariant:** an execution's wall clock must stay below the ack wait
(budget 1, refreshed by budget 2) AND below the buffered-execution abort
(budget 4). The 120 s target of this loop sits 7.5× inside both; the tightest
budget it actually crosses is the 900 s ack wait.

**Serial per-tenant consumer (know this before you design around it):**
`MultiTenantConsumerManager.bindStream`
(`packages/database/src/multi-tenant-consumer-manager.ts`) builds one
`NatsConsumerRunner` per tenant stream and forwards `config.runnerOptions`
verbatim. This service's `IMultiTenantConsumerConfig` sets `runnerOptions` to
`{ workingIntervalMs }` only — no `concurrency` — so `NatsConsumerRunner`'s
`runSession` resolves `concurrency` to 1 and takes `runSerial`. (The manager
itself is not serial: audit-service passes `runnerOptions.concurrency = 16`
through the same code path.) While one execution of
tenant X is in flight, other agent messages of the SAME tenant queue behind it
— they are not lost and not redelivered (`num_ack_pending` reads 1 and drains).
Work that must not wait behind a long agent execution simply must not go
through agent-ai-service.

Both paths are proven end to end by `scripts/e2e/long-agent-execution.sh`
(direct async submit + poll, and the workflow `agentCall` path), described for
feature authors in `DOCS/agents/long-running-executions.md`.

## Deterministic execution delay hook (dev/test only — default OFF)

`manual-loops/agents/long-running-agent-executions.md` T02 adds a way to make a
**real** agent execution take a known amount of wall-clock time, so
long-running-execution behavior (client polling, consumer keepalive, timeouts)
can be exercised against the real pipeline rather than a mock. It is a test
affordance, not a product feature.

- **Where**: `src/nats-handlers/test-delay.ts`, invoked from `handleBuffered`
  in `src/nats-handlers/execution.handler.ts` — the real path every buffered
  `execution_requested` takes — right before `chatService.generateReply`.
- **Gate**: `AGENT_TEST_DELAY_ENABLED` (`agentAiServiceConfig.testDelayEnabled`).
  Defaults to **off** in code and is enabled ONLY by the local dev overlays
  (`knative/services/overlays/local/{postgres,mongo}-dev/env-patches.yaml`).
  With the gate off, the key below is ignored and logged at `debug` —
  production behavior is byte-identical to before the hook existed.
- **Per-execution key**: `__test_delay_ms` (milliseconds). Read from
  `input.variables.request.__test_delay_ms` (canonical — the free-form
  `request` scope of `VariableResolutionContext`, forwarded verbatim inside
  `execution_requested` by `@yoizen/shared`'s `execution-client.ts`), falling
  back to `input.metadata.__test_delay_ms`. Non-numeric or non-positive values
  are ignored with a warning. **No agent is ever delayed implicitly** — without
  the explicit key the hook is a no-op, so shared e2e agents such as
  `e2e-http-agent-echo` are never affected.
- **Cap**: hard-capped at `AGENT_TEST_DELAY_HARD_CAP_MS` = 600_000 ms
  (`src/config.ts`). Larger requests are clamped (warn-logged).
  `AGENT_TEST_DELAY_MAX_MS` can only LOWER the cap, never raise it. The cap
  sits below both `consumerAckWaitMs` (900_000) and
  `bufferedExecutionTimeoutMs` (900_000), so an injected delay can never reach
  JetStream redelivery. No new keepalive is needed: the consumer runner already
  emits `msg.working()` every `consumerWorkingIntervalMs` (30s) while the
  handler is in flight.
- **Abort-safe**: the wait is bound to the execution's `AbortSignal`, so the
  `rt.<tenant>.exec.<id>.cancel` control message and the buffered-execution
  wall-clock ceiling still abort it — the delay sits inside that window and
  does not alter it. An interrupted delay surfaces as the usual
  `execution_failed` / `reason: "cancelled"`.
- **Logging**: every branch logs (accepted, clamped, ignored-gate-off,
  ignored-invalid, start, end, interrupted) with executionId + tenant.
- **Where the key can come from, per path** (both exercised by
  `scripts/e2e/long-agent-execution.sh`):
  - *Direct async submit* — `POST /api/runtime/executions` with a
    `metadata` object: `{"agentId": "...", "message": "...", "metadata":
    {"__test_delay_ms": 120000}}`. `metadata` is an optional pass-through
    field on `CreateExecutionDto` in BOTH gateways (api-gateway
    `src/modules/runtime/runtime.dto.ts`, ai-agent-gateway
    `src/modules/executions/executions.dto.ts`); it exists because the
    global `ValidationPipe` runs with `whitelist` + `forbidNonWhitelisted`,
    so an undeclared key is a 400, not a silent strip. Nothing in either
    gateway interprets its contents.
  - *Workflow `agentCall`* — the delay rides in the action args
    (`args.metadata.__test_delay_ms`), which `agent-call.activity.ts`
    forwards verbatim into `submitExecution`. It cannot ride in the webhook
    body: `services/workflow-service/src/modules/triggers/trigger-consumer.service.ts:185-193`
    builds a FIXED request shape, so a body field lands under
    `request.envelope.*`, not at `variables.request.__test_delay_ms`.
- **Budgets it must respect**: see "Async execution timeout contract" above —
  the cap (600 s) is deliberately below budgets 1 and 4 (900 s each).
