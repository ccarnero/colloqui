# AI Agent Gateway

Class: descriptive
Summary: The synchronous HTTP front door to asynchronous agent execution: submit/poll routes, the SSE streaming relay, Redis execution state and the timeout ceiling.

The synchronous front door to asynchronous agent execution. Callers submit an
execution over HTTP; the actual work happens in agent-ai-service, driven by NATS
events. This service turns that async flow back into something an HTTP client
can consume: a fire-and-forget submit, a status read, and two SSE streams.

It owns no database. State lives in Redis (via `YoizenClawExecutionClient`) and
on the bus.

## Quick Start

```bash
pnpm install
bun run --cwd services/ai-agent-gateway start:dev
```

`pnpm`, not `bun install`: the root `package.json` has no `workspaces` key —
`pnpm-workspace.yaml` is the single source of truth for workspace membership
(its own header comment says so), so a `bun install` at the root does not link
`@yoizen/*`.

Requires: NATS (JetStream), Redis, and agent-ai-service for the tools proxy.

## HTTP contracts

### `/runtime/executions`

`src/modules/executions/executions.controller.ts:25-77`. Tenant header
`x-yoizen-tenant`; the optional `x-yoizen-user-id` header
(`executions.controller.ts:23`) is forwarded as `requestedBy`.

| Method | Path | Response | Notes |
|---|---|---|---|
| `POST` | `/runtime/executions` | `202 Accepted`, `{ executionId, status }` (`:29-37`) | Submit only. Ensures the tenant's INGRESS stream exists, then delegates to `YoizenClawExecutionClient.submitExecution` (`executions.service.ts:113-123`) |
| `GET` | `/runtime/executions/:id` | Execution status + result (`:39-45`) | Redis-backed read (`executions.service.ts:125-163`) |
| `GET` | `/runtime/executions/stream` | SSE (`:47-52`) | TENANT-wide lifecycle feed: every execution of that tenant, filtered by `status.tenantId` (`executions.service.ts:165-190`) |
| `POST` | `/runtime/executions/stream` | SSE (`:61-77`) | Combined submit + stream for ONE execution — see below |

`CreateExecutionDto` (`src/modules/executions/executions.dto.ts:23-71`) requires
`agentId` (UUID) and a non-empty `message`; `conversationId`, `customerName`,
`userId`, `channel`, `context[]` and `metadata` are optional. `metadata` is
declared purely so the global `whitelist` + `forbidNonWhitelisted` validation
pipe stops rejecting it — nothing in this service reads it; it is passed through
verbatim to `execution_requested` (`executions.dto.ts:53-67`).

### `/tools`

| Method | Path | Notes |
|---|---|---|
| `GET` | `/tools/builtins` | Proxy to agent-ai-service `GET /tools/builtins`, 30 s timeout (`src/modules/tools/tools.service.ts:5`, `:15-34`) |

### `/health`

`GET /health` → `{ status, nats, redis }` with `"connected"`/`"disconnected"`
values; `status` is `"ok"` only when BOTH are up, otherwise `"degraded"`
(`src/modules/health/health.controller.ts:11-33`).

## Streaming design

`POST /runtime/executions/stream` (`executions.service.ts:201-377`) is the
interesting one. Its guarantees, in order of the code:

1. **Subscribe before submit** — the `executionId` is generated client-side with
   `randomUUID()` and every subscription is established synchronously inside the
   Observable's subscriber function, BEFORE `submitExecution` is awaited
   (`:207-212`, submit at `:350-371`). This is race-free by construction, unlike
   "POST, then GET stream by id".
2. **Two subject families.** Ephemeral token/tool events ride core NATS on
   `rt.<tenant>.exec.<executionId>.<kind>` where kind is `token`, `tool_call` or
   `tool_result` (`buildRuntimeStreamSubject` over
   `RUNTIME_STREAM_SUBJECT_PREFIX` and the `RUNTIME_TOKEN` /
   `RUNTIME_TOOL_CALL` / `RUNTIME_TOOL_RESULT` constants, all in
   `packages/shared/src/constants.ts`; subscribed at
   `executions.service.ts:261-288`). These subjects deliberately do
   NOT start with `evt.`, so the per-tenant JetStream stream never captures them
   — token deltas have no replay value (the invariant is stated in the doc
   comment above `RUNTIME_STREAM_SUBJECT_PREFIX`). Lifecycle events
   (`execution_started` / `execution_completed` / `execution_failed`) are
   subscribed separately over core NATS (`executions.service.ts:293-348`).
3. **Bounded relay buffer.** Every emit checks `socket.writableLength` against
   `STREAM_RELAY_MAX_BUFFERED_BYTES` (256 KiB, `executions.service.ts:59`). On
   overflow the stream closes with a terminal `failed { reason: "slow_consumer" }`
   rather than buffering without limit or silently dropping tokens
   (`:243-252`); the client can still recover the result via
   `GET /runtime/executions/:id`. Total stream LENGTH is intentionally unbounded
   — long streams to fast consumers are legitimate (`:49-58`).
4. **Cancel on disconnect.** RxJS teardown publishes a `cancel` control message
   unless a terminal lifecycle state was already reached (`:214-227`, `:373-375`).

## NATS

### Consumed

One durable consumer, `ai-agent-gateway-results`
(`executions.service.ts:61`), reconciling tenant streams matching `/^INGRESS-/`
(`:62`) across three filter subjects (`RESULT_SUBJECTS`, `:77-81`; rationale and
the operational note in the doc comment at `:63-76`):

```
evt.*.agent-ai-service.automation.platform.internal.execution_started.v1
evt.*.agent-ai-service.automation.platform.internal.execution_completed.v1
evt.*.agent-ai-service.automation.platform.internal.execution_failed.v1
```

The producer token is `agent-ai-service`, not this service: the gateway only
*reads* these three kinds — `agent-ai-service`'s `publishStatus` emits them. The
filters moved off the `ai-agent-gateway` token on 2026-08-07
(`PENDIENTES/04-e3-subject.spec.md`, commits 931d16dd + a3bd82c0). Operational
note: `MultiTenantConsumerManager` does not reconcile `filterSubjects` on an
existing durable, so the `ai-agent-gateway-results` durable must be deleted on
every `INGRESS-<tenant>` stream after the redeploy that ships this change, or it
keeps its stale filter and projects nothing.

The handler projects each status into Redis (`handleResultMessage`,
`:393-425`). On a `completed` status it threads the ENVELOPE's own id and causal
depth into the persisted status as `completedEventId` / `completedEventDepth`
(`:414-423`) — the envelope carrying the completed status IS the
`execution_completed` bus event, and workflow-service cites that id as
`causation_id` for whatever it publishes after the agent call.

### Published

Only indirectly, through `YoizenClawExecutionClient` (`@yoizen/shared`):
`submitExecution` emits `execution_requested`, and the streaming teardown emits
the runtime `cancel` control message (`executions.service.ts:219-220`). There is
no direct `js.publish` in this service.

## Environment Variables

The whole config is four values (`src/config.ts`):

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port (`src/config.ts:6`) |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL (`src/config.ts:7`) |
| `AGENT_AI_SERVICE_URL` | `platformServiceUrl("agent-ai-service", env)` | Base URL for the `/tools/builtins` proxy (`src/config.ts:9-11`) |
| `PLATFORM_ENVIRONMENT` | `dev` | Feeds the default service URL above (`src/config.ts:3`) |

Redis connection settings come from the shared `redisProvider`
(`src/providers/redis.provider.ts`), not from this service's config object.
There is no `DB_ENGINE` — the service never calls `resolveStorageEngine()`.

## Testing

```bash
cd services/ai-agent-gateway
bun run test:unit
```

## Deploy

Knative Service, min 1 / max 3, concurrency target 50, image
`dev.local/ai-agent-gateway:local`
(`knative/services/base/ai-agent-gateway.yaml:15-17`, `:29`).

`timeoutSeconds: 3600` (`ai-agent-gateway.yaml:25`) — long agent executions hold
an SSE connection open, so the Knative request timeout must clear
`AGENT_CALL_TIMEOUT_MS` plus margin. This is guarded by G8 in
`scripts/checks/doc-code-guards.sh`.

```bash
./rebuild-redeploy.sh ai-agent-gateway dev
```
