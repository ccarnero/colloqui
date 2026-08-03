# Connector Runtime

A standalone Temporal worker service that executes generic HTTP requests with optional connector-driven configuration. This service is the execution engine for all HTTP-based activities in the platform — whether called from workflows, event processors, webhooks, or direct external callers. It operates independently from workflow orchestration and scales based on Temporal task queue depth.

## What is connector-runtime?

connector-runtime listens on the `connector-runtime` Temporal task queue for activity tasks. Each activity represents a single HTTP request that may be configured in one of two ways:

1. **Raw HTTP**: Caller provides complete URL, method, headers, and body
2. **Connector-driven**: Caller provides `adapterId`/connector ID and `endpointId`; the service resolves full configuration (base URL, auth, custom headers, timeout, retries) from connector-admin and applies it

All HTTP calls are instrumented with OpenTelemetry for observability. The service maintains a Redis stale-while-revalidate cache for connector configurations to minimize dependency on connector-admin.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run locally with Temporal on localhost:7233
bun run start:dev
```

**Prerequisites**: Temporal server running (`localhost:7233`), Redis (`localhost:6379`), connector-admin reachable.

## Local Development

### Running the service

```bash
bun run start:dev
```

This starts both the Temporal worker and the health server on port 3000.

### Health check

```bash
curl http://localhost:3000
```

`startTemporalWorkerHealthServer` (`src/temporal-worker-health.ts`) answers on
EVERY path and method: `200 {"status":"ok"}` once the worker has connected,
`503 {"status":"starting"}` before that and again after shutdown begins.

### Running tests

```bash
bun test
bun test test/unit
```

## Architecture

### Core Components

**Temporal Worker** (`src/worker.ts`)
- Connects to Temporal server at `TEMPORAL_ADDRESS:7233`
- Registers activities on the `connector-runtime` task queue
- Maintains health server on `PORT` (default 3000)
- Gracefully shuts down on SIGTERM/SIGINT
- Max 400 concurrent activity tasks

**Activity: `executeEndpointCall`** (`src/activities/endpoint-call.activity.ts`)
- Entry point for HTTP requests
- Routes to connector-driven path (if `adapterId`/connector ID and `endpointId` are provided) or raw path
- Uses `tracedFetch` from `@yoizen/observability` for instrumentation
- Implements exponential backoff retry with circuit breaker
- Returns `{ status, body, headers }` to caller

**Activity: `executeServiceCall`** (`src/activities/service-call.activity.ts`)
- Resolves a tenant-registered service (`serviceId` / `serviceSlug`) via the
  internal-adapter mirror in connector-admin
- Falls back to a registry-service lookup on a mirror miss
- Delegates to the same `endpoint-call-core` pipeline for HTTP execution
- Returns the same `IHttpCallResult` shape

**Connector Resolution** (`src/activities/_shared/adapter-client.provider.ts`)
- `AdapterClient` class wraps connector-admin REST API calls
- Redis stale-while-revalidate cache (soft TTL 60s, stale-serve window 300s)
- Lazy cache misses: fetch from connector-admin while serving stale data if cache is fresh
- OAuth2 client credentials token management for secured adapters

### Data Flow

```
Temporal Server receives activity task for connector-runtime queue
         ↓
Worker picks up executeEndpointCall activity
         ↓
         ├─ [Connector-driven path]
         │   AdapterClient.resolveRequest(tenantId, adapterId, endpointId)
         │   ├─ Check Redis cache (hit → return config)
         │   └─ [Cache miss]
         │       ├─ Fetch from connector-admin REST API
         │       ├─ Cache in Redis
         │       └─ Return resolved config (URL, auth headers, timeout, retries)
         │
         └─ [Raw HTTP path]
             Caller provides complete URL + headers
         ↓
tracedFetch with OpenTelemetry instrumentation
         ├─ [Circuit breaker open?] → immediate failure
         ├─ [First attempt] → execute request
         └─ [Failure?] → exponential backoff retry (up to 3 attempts)
         ↓
Return { status, body, headers } to Temporal
```

### Request/Response Shapes

These are the real interfaces in `packages/shared/src/workflow.interfaces.ts`
(args) and `src/activities/_shared/http-call-with-retry.ts` (result) — there
are no per-call `timeout` / `retries` overrides on either activity, and the
result field is `data`, not `body`.

**Endpoint Call Request** — `EndpointCallArgs`

```
{
  method: string              // GET, POST, PUT, DELETE, PATCH
  url: string                 // Absolute target URL on the raw branch; the
                              // adapter branches derive the URL from the
                              // connector's baseUrl (+ endpoint path)
  adapterId?: string          // Connector ID for config resolution
  endpointId?: string         // Endpoint ID within the connector (requires adapterId)
  params?: Record<string, unknown>  // URL query parameters
  data?: unknown              // Request body (JSON-serialized)
  headers?: Record<string, string>  // Additional headers (merged with the connector's)
}
```

**Endpoint Call Response** — `IEndpointCallResult` (= `IHttpCallResult`)

```
{
  status: number              // HTTP status code (200, 404, 500, …)
  data: unknown               // Response body (parsed JSON when the response is JSON)
  headers: Record<string, string>  // Response headers
  cacheResult?: "hit" | "miss" | "bypass" | null   // HTTP-response cache outcome
}
```

**Service Call Request** — `ServiceCallArgs`

```
{
  serviceId: string           // registered_services row id (UUID, never the slug)
  serviceSlug?: string        // registry slug, pre-populated by workflow-service
                              // so the adapter-mirror lookup is O(1)
  method: string              // HTTP method
  path: string                // Service path
  data?: unknown              // Request body
  headers?: Record<string, string>  // Additional headers
  endpointId?: string         // Optional endpoint id from the internal-adapter mirror
}
```

## Activities

### executeEndpointCall

Executes an HTTP request with optional adapter-driven configuration.

**Example 1: Raw HTTP call**

```
// Caller (workflow-service). No adapterId → the raw branch: one fetch,
// fixed 30 s timeout, no retries.
activity = executeEndpointCall({
  method: "GET",
  url: "https://api.example.com/users/123",
  headers: { "Accept": "application/json" }
}, "acme")

// Result
{
  status: 200,
  data: { id: 123, name: "Alice" },
  headers: { "content-type": "application/json" },
  cacheResult: null
}
```

**Example 2: Connector-driven call**

```
// Caller provides minimal info; the connector resolves the rest
activity = executeEndpointCall({
  method: "GET",
  url: "/users/123",          // ignored on this branch — the endpoint's path wins
  adapterId: "crm-adapter",
  endpointId: "get-customer"
}, "acme")

// AdapterClient resolves from connector-admin:
// - Base URL: https://crm.example.com/api
// - authType/authConfig → Authorization header
// - Custom headers from the connector's `headers` array
// - timeoutMs   (connector-configured, capped at ADAPTER_TIMEOUT_MS_MAX = 60000)
// - maxRetries  (capped at ADAPTER_MAX_RETRIES_MAX = 3)
// - retryBackoffMs (capped at ADAPTER_RETRY_BACKOFF_MS_MAX = 10000)

// Full request becomes:
// GET https://crm.example.com/api/users/123
// Headers: {
//   "Authorization": "Bearer <token>",
//   "X-API-Key": "...",
//   "x-yoizen-tenant": "acme"
// }

// Result
{
  status: 200,
  data: { customerId: 123, name: "Alice", email: "alice@example.com" },
  headers: { "content-type": "application/json" },
  cacheResult: "miss"
}
```

### executeServiceCall

Resolves and calls a TENANT-registered service (a row in registry-service's
`registered_services`), addressed by its registry id — not by an arbitrary
platform service name. Delegates to the same HTTP core as
`executeEndpointCall`.

**Example**

```
// Caller (workflow-service, which pre-populates serviceSlug at start time)
activity = executeServiceCall({
  serviceId: "0f4c…-uuid",
  serviceSlug: "echo-service",
  path: "/events/log",
  method: "POST",
  data: { action: "user.login", userId: "123" }
}, "acme")

// Service resolution:
// 1. Look the slug up in the tenant's internal-adapter mirror
//    (connector-admin, context=internal) — O(1), no registry hop
// 2. On a miss, fall back to registry-service to resolve the URL
// 3. Execute through the shared core (breaker + cache + audit event)

// Result — same IHttpCallResult shape as executeEndpointCall
{
  status: 200,
  data: { eventId: "evt_abc123" },
  headers: { "content-type": "application/json" },
  cacheResult: null
}
```

## Event Publishing

Every `executeEndpointCall` invocation fire-and-forgets a
`connector.endpoint_call.completed.v1` event to NATS JetStream via
`publishEndpointCallEvent` (`src/activities/_shared/event-publisher.ts`).
Publish failures are logged as warnings and never propagate to the caller —
this is an observability side-effect, not part of the activity's critical
path.

### Causal contract

`IEndpointCallEvent` accepts an optional `causal?: EventCausalContext`
field, mirroring the causal-threading pattern used by
`mcp-call.activity.ts` (this service) and workflow-service's
`agent-call.activity.ts`:

- **With `causal` present** — the workflow action supplied a causal
  context (`correlation_id`, `causation_id`, `depth`). The published
  envelope's `correlation_id`/`causation_id` are set from it, and
  `transport.depth` is `causal.depth + 1`, joining the event into the run's
  correlation chain instead of starting a new one.
- **With `causal` absent** — today's pre-existing behavior: `buildEventEnvelope`
  assigns a random `correlation_id`, `causation_id` stays `null`, and
  `transport.depth` is `0`. The event is published as a root event, not
  linked to any run.
- **`DepthExceededError` fallback** — if threading the causal context would
  exceed `MAX_DEPTH_BY_CATEGORY`, `buildEventEnvelope` throws
  `DepthExceededError`. `emit()` catches it, logs a warning (visible as
  "endpoint_call event depth exceeded ... publishing as root event"), and
  retries `buildEventEnvelope` WITHOUT the causal fields — the event is
  still published, just as a root event. The publish path never fails
  because of causal threading; an orphan event beats a lost event.

Backward compatibility: events emitted before this contract existed (no
`causal` field ever passed) remain valid root events — the causal fields
are additive, not a breaking envelope change.

## Per-call capture: serviceCall, raw HTTP, and MCP

`manual-loops/connectors/connection-call-inspector.md` closes the remaining
gaps in per-call request/response capture — `serviceCall` and the raw
no-adapter HTTP branch previously emitted NO audit event at all, and MCP
tool calls only reported scalar usage to agent-admin-service, never the
actual tool arguments/result content. All three paths now reuse the SAME
`_shared/event-publisher.ts` sink (`publishEndpointCallEvent` /
`publishMcpCallEvent`) `endpoint-call.activity.ts` already used — no new
publisher module, same fire-and-forget/redaction/truncation/causal contract
described above.

### serviceCall — `service/<serviceName>`

`src/activities/service-call.activity.ts`'s `emitServiceCallEvent` publishes
`connector.endpoint_call.completed.v1` after every completed platform
service call (mirror-resolved or registry-fallback branch alike), with
`resource: \`service/${serviceName}\`` (`serviceSlug ?? serviceId`) instead
of the sink's default `adapter/${adapterId}` derivation — `evt.resource`
overrides it. Emitted unconditionally on a completed HTTP response (2xx
AND non-2xx — only transport-level failures that never reach a response
skip emission, same semantics as `execute-with-adapter-endpoint.ts`).
Request/response headers go through `redactHeaders`, bodies through
`truncateBody` (8192 chars). Causal context, when the calling workflow
action supplied one, is threaded the same way `mcp-call.activity.ts`
threads its usage event.

### Raw no-adapter HTTP — `raw/<host>`

`src/lib/endpoint-call-core/execute-raw.ts` (the branch used when no
`adapterId` is supplied — a caller-provided absolute URL) publishes the
same `connector.endpoint_call.completed.v1` event via the `publish` port
injected by the entrypoint, with `resource: \`raw/${host}\`` — `host` is
derived from the resolved URL (`rawResourceHost`, falling back to the full
URL string if parsing somehow fails so resource derivation itself can
never break the fire-and-forget publish). Redaction, truncation, causal
threading, and emit-on-any-completed-status all match the adapter-driven
branches; this branch has no `adapterId` to key the default resource shape
on, so `resource` is always set explicitly.

### mcpCall — `mcp/<mcpServerId>`, args + result

`src/activities/mcp-call.activity.ts`'s `emitMcpCallEvent` publishes a
SECOND, additive event kind — `connector.mcp_call.completed.v1`
(`publishMcpCallEvent`, `_shared/event-publisher.ts`) — on top of the
existing `reportMcpUsageEvent` HTTP call to agent-admin-service, which
keeps feeding the `mcp_call_events` aggregate usage summary UNCHANGED
(decision 3 of the SPEC — do not extend or delete it). Payload:
`serverName`, `mcpServerId`, `toolName`, `success`, `durationMs`, `error?`,
`arguments` (the tool call args) and `result` (the tool's `CallToolResult`
content) — BOTH `arguments` and `result` go through `truncateBody` (8192
chars). Resource: `mcp/<mcpServerId>`. Emitted on BOTH success and failure
(a failed tool call is the interesting case for the inspector) — causal
context reuses the same `outcome.causal` already threaded into the usage
event.

### Shared contract across all three paths

- **Fire-and-forget**: `publishEndpointCallEvent`/`publishMcpCallEvent`
  never throw synchronously into the caller; publish failures are caught
  inside `emit()`/`emitMcpCall()` and logged as warnings.
- **`DepthExceededError` fallback**: identical to the base contract above —
  causal threading that would exceed `MAX_DEPTH_BY_CATEGORY` falls back to
  a root event (warn-logged), never a lost event.
- **Redaction/truncation**: every header map goes through
  `_shared/redact-headers.ts` (12-38, denylist of auth-bearing headers);
  every body/args/result goes through `_shared/truncate-body.ts` (8192
  chars, `truncateBody`).
- **Payload lifecycle**: these events ride the SAME `payload_status`
  state machine and 30-day retention scrub as every other envelope the
  ingester persists — see
  `services/tracking-ingester-service/README.md` "Payload lifecycle". No
  retention changes were made for this loop.

## Error Handling

### Circuit Breaker

If a remote endpoint fails repeatedly, the breaker fails fast without
attempting the call. **The thresholds are module constants in
`src/activities/_shared/breaker.ts`, NOT connector-configurable** — a
connector's `timeoutMs`/`maxRetries`/`retryBackoffMs` tune the retry chain,
never the breaker. Two named configs exist:

| Config | `failureThreshold` | `windowMs` | `cooldownMs` | `successThreshold` | `probeTimeoutMs` | Redis key prefix |
|---|---|---|---|---|---|---|
| `HTTP_BREAKER_CONFIG` | `5` | `60_000` | `HTTP_BREAKER_COOLDOWN_MS` = `30_000` | `2` | `60_000` | `cb:workflow:http` |
| `AGENT_BREAKER_CONFIG` | `10` | `120_000` | `AGENT_BREAKER_COOLDOWN_MS` = `60_000` | `3` | `300_000` | `cb:workflow:agent` |

So the HTTP breaker opens after **5** failures inside a rolling 60 s window
(not 3), and half-open needs **2** consecutive successes to close (not 1).
State lives in Redis with a 500 ms L1 cache and a 1 s per-op budget
(`BREAKER_REDIS_TIMEOUT_MS`); `fallbackOnRedisError: "allow"` means a Redis
outage fails OPEN in the permissive direction — calls are allowed, not
blocked. Note the threshold is counted per breaker instance, so with N pods
it takes up to N × threshold total failures to trip everywhere (the code
says so at the top of `breaker.ts`).

### Retries & Backoff

`httpCallWithRetry` (`src/activities/_shared/http-call-with-retry.ts`):

- **Strategy**: `retryBackoffMs × 2^(attempt-1)` before attempts 2, 3, … —
  exponential, but the BASE is the connector's own `retryBackoffMs`, not a
  fixed 1 s. A connector with `retryBackoffMs: 1000` gives 1 s / 2 s / 4 s.
- **Max retries**: the connector's `maxRetries` (`maxRetries = 0` means one
  attempt, no retry). connector-admin caps it at `ADAPTER_MAX_RETRIES_MAX = 3`
  and `retryBackoffMs` at `ADAPTER_RETRY_BACKOFF_MS_MAX = 10_000` on write.
- **Retried**: `res.status >= 500` and any thrown error (network failure,
  `AbortSignal.timeout` abort).
- **Not retried**: every response with `status < 500` — including 4xx — is
  returned to the caller as-is, not thrown. A non-2xx is a normal result
  here, not an exception.
- **The raw (no-`adapterId`) branch does not retry at all**:
  `src/lib/endpoint-call-core/execute-raw.ts` issues ONE `tracedFetch` with a
  fixed `RAW_TIMEOUT_MS = 30_000` signal.

### Timeout Strategy

| Branch | Timeout used |
|---|---|
| Raw (`url` only, no `adapterId`) | Fixed `RAW_TIMEOUT_MS` = **30 s** (`execute-raw.ts`). A caller-supplied `timeout` is NOT honoured on this branch |
| Adapter-driven (`adapterId` [+ `endpointId`]) | The resolved connector's `timeoutMs`, passed straight through to `httpCallWithRetry` (`execute-with-adapter-base.ts` / `execute-with-adapter-endpoint.ts`) |

The ceiling on a connector's `timeoutMs` is `ADAPTER_TIMEOUT_MS_MAX =
60_000` (60 s), enforced by connector-admin's DTO on write — there is no
300 s timeout anywhere. The 300 s figure that belongs to this service is
`INVOKE_CONSUMER_ACK_WAIT_MS` (`src/config.ts`), the async invoke consumer's
JetStream ack window, which the worst-case retry chain must stay under
(asserted by `test/unit/invoke-ack-wait-invariant.spec.ts`).

## Performance

### Worker configuration (`src/worker.ts`)

| Setting | Value | Source |
|---|---|---|
| Task queue | `CONNECTOR_RUNTIME_TASK_QUEUE` (`@yoizen/shared`) | `src/worker.ts:24` |
| Max concurrent activity task executions | `400` per replica | `src/worker.ts:35` |
| Shutdown grace time | `30s` | `src/worker.ts:37` |
| Max concurrent activity task POLLS | `20` | `src/worker.ts:36` |
| DNS resolution | IPv4-first via `dns.setDefaultResultOrder("ipv4first")`, for Kubernetes compatibility | `src/worker.ts:12` |

The 400 ceiling is deliberate and explained in the code: HTTP activities are
pure I/O (outbound `tracedFetch`), so one pod comfortably sustains hundreds of
in-flight requests (`src/worker.ts:31-35`).

There is no NestJS here — the entrypoint is a raw Temporal worker driven by
`runTemporalWorkerCli` (`src/worker.ts:14`) with `exitOnSignal: true` (`:21`),
so SIGTERM/SIGINT drain in-flight activities within the grace window and exit.

### Concurrency

- **Max concurrent activities**: 400 per replica (`src/worker.ts:35`)
- **Task dequeue**: Pull-based from Temporal (prevents overload)
- **HTTP timeout**: 30 s fixed on the raw branch (`RAW_TIMEOUT_MS`), the
  connector's `timeoutMs` on the adapter branches — see "Timeout Strategy".
  The Temporal-level `startToCloseTimeout` for these activities is declared
  by the CALLER, in `workflow-service`'s `proxyActivities` blocks
  (`services/workflow-service/src/temporal/workflows.ts`), not here.

### Scaling

The Temporal worker is deployed as a plain Kubernetes Deployment (not Knative Service) because Temporal uses pull-based task distribution — it pulls tasks over a long-lived gRPC connection and never receives inbound HTTP, so Knative's activator/KPA model adds nothing.

In developer mode it runs at a fixed **1 replica** with no autoscaling. Each replica sustains up to 400 concurrent activities; horizontal capacity would come from raising the replica count.

**HTTP invoke facade (`src/http-main.ts`) scales differently from the worker** — see the section below.

## Three entrypoints, one deployable

`manual-loops/connector-invoke-api.md` turns connector-runtime into a
**three-entrypoint deployable** (human-approved shape, 2026-07-14 — see
"Deployment: three Deployments" below), all sharing the same image and the
same pure core (`src/lib/endpoint-call-core/`):

| Entrypoint | File | Purpose | Scales on |
|---|---|---|---|
| Temporal worker | `src/worker.ts` | `executeEndpointCall`/`executeServiceCall` activities dispatched by workflow-service | Temporal task-queue depth |
| HTTP invoke facade | `src/http-main.ts` | Sync invoke (`mode: "sync"`, default) + async publish (`mode: "async"`) + `GET /invocations/:id` polling | Inbound RPS |
| Async invoke consumer | `src/invoke-consumer-main.ts` | Durable JetStream consumer that executes async invoke requests, parks the result, and delivers the webhook | JetStream (`INGRESS-<tenant>`) consumer lag |

Every invocation (sync, async, hit or miss) emits the SAME
`connector.endpoint_call.completed.v1` audit event — no new event kinds for
audit, only the transport pair (see "Async invoke transport" below) that
carries the request/result between the facade and the consumer.

## HTTP Invoke Facade (`src/http-main.ts`)

`manual-loops/connector-invoke-api.md` T02/T04 adds a SECOND entrypoint to
the same deployable: a plain `Bun.serve` HTTP server (no Express/Fastify)
that lets hosted-service code invoke connectors — synchronously or
asynchronously — without going through Temporal. It reuses the exact same
governed pipeline (breaker, HTTP-response cache,
`connector.endpoint_call.completed.v1` audit event) as
`executeEndpointCall` — both are thin wrappers around the pure core in
`src/lib/endpoint-call-core/`.

### Route

```
POST /invoke/:connectorId/:endpointId
Headers: x-yoizen-tenant: <tenant>
Body: {
  "args": { "method": "GET", "params": {...}, "data": {...}, "headers": {...} },
  "mode"?: "sync" | "async",
  "idempotencyKey"?: string,
  "webhook"?: { "url": string, "headers"?: Record<string, string> }  // mode: "async" only
}
```

`connectorId`/`endpointId` map onto the core's `adapterId`/`endpointId`
(fully-resolved adapter+endpoint branch — method/path/headers/timeouts all
come from the adapter). Any `mode` other than `"sync"`/`"async"` is rejected
with 400.

### Sync vs. async invoke contract

- **`mode: "sync"` (default, T02)** — the facade runs the core inline and
  returns the result in the SAME HTTP response: `200` with
  `{ invocationId, status, data, headers, cacheResult }`, or a mapped error
  status (see "Responses" below). `webhook` is rejected (400) for sync —
  there is nothing to deliver later, the caller already has the result.
- **`mode: "async"` (T04/T05)** — the facade validates the request, publishes
  an `invoke_requested` envelope to NATS JetStream (see "Async invoke
  transport" below), and returns immediately with `202 { invocationId }`.
  The actual HTTP call has NOT happened yet at that point — it runs later,
  in the async invoke consumer entrypoint. The result reaches the caller one
  of two ways: **webhook** (if `webhook.url` was supplied, delivered
  best-effort once the consumer finishes) or **polling**
  `GET /invocations/:invocationId` (works regardless of whether a webhook
  was supplied, and is the only option if it was not).
- **`idempotencyKey`** — reused as the JetStream `Nats-Msg-Id` for async
  dedup AND as the audit `invocationId` for both modes (present in both
  sync's response and async's `invoke_requested` envelope) — see "At-least-
  once contract" below for why callers should set it.

### Responses

| Status | When |
|---|---|
| 200 | Sync success — `{ invocationId, status, data, headers, cacheResult }` |
| 202 | Async accepted — `{ invocationId }` (the call has not run yet) |
| 400 | Missing/blank `x-yoizen-tenant` header, invalid JSON body, missing/invalid `args`, unsupported `mode`, `webhook` on a sync request, a webhook URL that fails the SSRF guard, or the core's `invalid_args` error |
| 429 | Per-tenant rate limit exceeded — `{ error: "rate_limited", resetSeconds }` |
| 503 | Circuit breaker OPEN (sync only) — `{ error: "circuit_open", retryAfterMs }` (caller should back off; transient, not a hard failure). For `mode: "async"`, an `invoke_requested` publish failure ALSO returns an immediate synchronous 503 to the POST caller — `{ invocationId, error }` — distinct from post-accept async errors, which surface via `GET /invocations/:id` instead |
| 502 | Upstream HTTP failure (sync only) — `{ error: "upstream_http_error" }` |
| 504 | Upstream timeout (sync only) — `{ error: "upstream_timeout" }` |

Every response includes `invocationId` — a UUID generated per request
(`randomUUID()`, or the caller's `idempotencyKey` when supplied), even on
sync calls, so the audit event is addressable by invocation. Standalone
(non-workflow) invocations start a **root correlation** (no `causal` context
to join, since there's no workflow `executionId`); the published envelope's
`resource` is `invocation/${invocationId}` instead of the Temporal path's
`adapter/${adapterId}`. This holds for BOTH the audit
`connector.endpoint_call.completed.v1` event and the async transport pair —
no new audit event kind exists for invoke.

### `GET /invocations/:invocationId` — polling fallback

```
GET /invocations/:invocationId
Headers: x-yoizen-tenant: <tenant>
```

| Status | Body |
|---|---|
| 200 | `{ invocationId, status: "pending" }` — the consumer hasn't finished yet |
| 200 | `{ invocationId, status: "completed", outcome: "ok" \| "error", result?, error? }` |
| 404 | Unknown invocation ID, OR the result expired past the Redis TTL — the two cases are indistinguishable |

Backed by `getInvocationRecord` (`src/activities/_shared/invocation-store.ts`)
reading the same Redis key the consumer parks into (see "Result parking"
below).

### At-least-once contract (async)

Async delivery is **at-least-once, not exactly-once**, by explicit human
decision (`manual-loops/connector-invoke-api.md` "User decisions" — durability-
by-workflow is a Temporal feature, not something this API re-implements).
The window where a duplicate outbound HTTP call can happen: if the async
invoke consumer crashes or is killed AFTER it has made the outbound HTTP
call to the target endpoint but BEFORE it acks the JetStream message, the
message is redelivered and the SAME outbound HTTP call runs again on
another (or the same) consumer instance. Explicit ack happens only AFTER
the result is parked in Redis (`handle-invoke-requested-message.ts`), which
narrows the window as much as possible but cannot close it entirely — ack
and the outbound call cannot be one atomic operation.

**Caller responsibility**: pass `idempotencyKey` whenever the underlying
HTTP verb is not naturally idempotent (e.g. a `POST` that creates a
resource). The platform does not attempt exactly-once delivery — this is a
documented caller-side contract, not a bug.

### Tenant guard + rate limit

- **Tenant guard** (`src/lib/http-facade/check-tenant-header.ts`): same
  header contract as the gateway-proxied services (e.g.
  `tracking-ingester-service`) — `x-yoizen-tenant` must be present and
  non-blank, or the request is rejected with 400. No `@Public()`-style
  bypass; this is a new HTTP surface with no task-queue boundary protecting
  it, so authz is required from day one.
- **Rate limit** (`src/lib/http-facade/check-rate-limit.ts`): per-tenant
  sliding-window counter, in-memory per pod (not Redis-backed like the
  breaker — the facade rate limit gates per-pod RPS, it doesn't need
  cross-pod accuracy). Defaults reuse the platform-wide
  `RATE_LIMIT_DEFAULT_LIMIT`/`RATE_LIMIT_DEFAULT_WINDOW_MS` constants
  already established in `@yoizen/shared`; override via
  `INVOKE_RATE_LIMIT`/`INVOKE_RATE_LIMIT_WINDOW_MS`. Rejections are logged
  as warnings with the tenant and reset window.

## Async invoke transport (`invoke_requested` / `invoke_completed`)

The `mode: "async"` request/result pair travels over NATS JetStream as its
own subject family, published/consumed with the exact same envelope,
correlation-header, and `Nats-Msg-Id` dedup semantics
`service-bus.activity.ts` established for `serviceBusCall`
(`workflow-service`):

```
evt.<tenant>.connector-runtime.platform.endpoint.system.invoke_requested.v1
evt.<tenant>.connector-runtime.platform.endpoint.system.invoke_completed.v1
```

TAXONOMY.md rule 21 classifies both kinds `tech: platform` /
`business_fn: connector-invocation` — evaluated BEFORE rule 11 (the broader
`connector.endpoint_call.completed.v1` audit-event rule) so these two
transport/control-plane kinds are never mis-tagged `tech: connector`. This
is a SEPARATE concern from the audit event: `invoke_requested`/
`invoke_completed` carry the request/result across the broker,
`connector.endpoint_call.completed.v1` (unchanged, resource
`invocation/<invocationId>`) is the durable audit trail of the HTTP call
itself — both are emitted for every async invocation, neither replaces the
other.

**Stream binding — design change from the original plan:** a dedicated
`CONNECTOR-INVOKE` stream turned out to be impossible. Every tenant's
`INGRESS-<tenant>` stream already binds `evt.<tenant>.>`, and JetStream
forbids overlapping stream subject filters — both invoke subjects fall
inside that wildcard, so they ride the tenant's existing `INGRESS-<tenant>`
stream (created at tenant provisioning), the same mechanism every other
`evt.<tenant>.*` publisher in the platform already relies on. There is
nothing to provision for a new tenant beyond what tenant provisioning
already does.

**`scripts/verify-invoke-stream-binding.ts` — verify-only, not provisioning.**
This script CREATES NOTHING. For each tenant given on the command line, it
asserts that BOTH invoke subjects resolve to a bound JetStream stream
(expected: `INGRESS-<tenant>`) and fails loud (non-zero exit) if either does
not — e.g. because the tenant was never provisioned, or its
`INGRESS-<tenant>` stream was deleted out of band. It replaces an earlier
`provision-invoke-stream.ts` design that assumed a dedicated stream would
exist; there is no `--apply` flag because there is nothing this script could
apply.

```bash
kubectl port-forward -n support-services-dev svc/nats 4222:4222 &
NATS_URL=nats://localhost:4222 bun run scripts/verify-invoke-stream-binding.ts acme
```

The HTTP facade's async publish path (`publish-invoke-request.ts` via
`src/activities/_shared/invoke-request-publisher.ts`) never falls back to a
non-streamed core-NATS publish for these subjects — if the subject is
somehow unbound, the publish fails loud (503) rather than silently
delivering an unreliable message.

## Async invoke consumer (`src/invoke-consumer-main.ts`)

The THIRD entrypoint of the deployable (`manual-loops/connector-invoke-api.md`
T05): a durable JetStream consumer, `connector-runtime-invoke`, bound
against every stream matching `INGRESS-<tenant>` (`MultiTenantConsumerManager`,
`streamPattern: /^INGRESS-/`), filtering on `invoke_requested`. One durable
name shared across pods — pull-consumer sharding load-balances
automatically across replicas, same pattern `channel-service`'s
`webhook-ingress-consumer.service.ts` uses.

Per message:

1. Decode + validate the envelope (`parseInvokeRequestedEnvelope`). A
   malformed message, non-compliant envelope, or a payload that fails
   validation is a `PermanentError` — `msg.term()`, never redelivered, no
   retry loop for something that can never succeed.
2. Run the SAME pure core (`src/lib/endpoint-call-core/`) the sync facade
   and the Temporal activity use — breaker, cache, and the
   `connector.endpoint_call.completed.v1` audit event fire identically to
   the sync path.
3. **Park the result in Redis** (see below) BEFORE acking.
4. Publish `invoke_completed`.
5. Best-effort **deliver the caller's webhook** if one was supplied (see
   below) — delivery failure never blocks the ack; the result is already
   parked, so polling still works.
6. Ack the JetStream message.

Concurrency: 16 in-flight messages per pod (`runnerOptions.concurrency`) —
async invoke work is I/O-bound (outbound HTTP + Redis + NATS publishes) and
independent per invocation, so several run concurrently per pod, mirroring
`webhook-ingress-consumer.service.ts`'s own reasoning.

Health: a tiny `Bun.serve` on `INVOKE_CONSUMER_HEALTH_PORT` (default
`3200`) serving `GET /health`.

### Redis result parking

`parkInvocationResult`/`getInvocationRecord`
(`src/activities/_shared/invocation-store.ts`) read/write a single Redis key
per invocation:

```
invocation:<tenantId>:<invocationId>
```

`SET ... EX <ttlSeconds>` — TTL default **900s (15 minutes)**, configurable
via `INVOCATION_RESULT_TTL_SECONDS`. Both the facade's initial "pending"
write (when the async request is accepted) and the consumer's "completed"
write target the SAME key; each write resets the full TTL window. This
single-key design is what makes result parking idempotent across JetStream
redelivery — replaying the same `invocationId` after a crash-before-ack
overwrites the same key with the same "completed" shape, never creating a
duplicate record. Past the TTL, `GET /invocations/:id` 404s — expired and
never-existed are indistinguishable by design (see "Responses" above).

### Webhook delivery

`deliverWebhook` (`src/activities/_shared/webhook-delivery.ts`) POSTs the
completed `InvocationRecord` as JSON to the caller-supplied `webhook.url`,
with the caller's `webhook.headers` merged in (bounded timeout,
`INVOKE_WEBHOOK_TIMEOUT_MS`, default 10s). Two defense-in-depth layers
protect this — a caller-supplied URL is never trusted to be safe just
because it was valid when the request was accepted:

- **SSRF guard** (`src/activities/_shared/validate-outbound-url.ts`,
  `validateOutboundUrl`) runs TWICE: once at request-validation time
  (`parse-invoke-request-body.ts`, rejects with 400 before the request is
  ever queued) and again at delivery time (defense in depth — the envelope
  crosses a broker in between, so a value that was valid when parked is not
  assumed to still be safe when dequeued). It rejects: non-`http(s)`
  schemes, `localhost`/`127.0.0.1`/`::1`, the cloud-metadata endpoint
  (`169.254.169.254`), link-local addresses (`169.254.*`, `fe80:`), and
  RFC1918 private ranges (`10.*`, `172.16-31.*`, `192.168.*`). **Known
  limitation** (reviewer-flagged, non-blocking follow-up): the guard checks
  the URL's literal hostname/IP only — it never resolves DNS, so a
  cluster-internal name like `foo.svc.cluster.local` is NOT caught even
  though it would resolve to an in-cluster address. There is no `scope:
  "internal"` opt-in here (unlike `mcp-call.activity.ts`'s MCP server
  config) — webhook targets are always caller-supplied over the public
  invoke API, so no private-range exception exists.
- **Hop-by-hop header denylist** (`DENIED_WEBHOOK_HEADERS` in
  `webhook-delivery.ts`) strips `host`, `content-length`, `content-type`,
  `transfer-encoding`, `connection`, `keep-alive`, `upgrade`, `te`,
  `trailer`, `proxy-authorization`, `proxy-connection` from a caller's
  `webhook.headers` before the outbound POST — these would corrupt or
  desync the request, or override the fixed `content-type:
  application/json` this activity sets itself, if caller-controlled.
  Stripping is logged (warn) per header so a misbehaving caller is visible.
  `authorization` is intentionally NOT denied — a caller supplying their own
  bearer/basic auth for their own webhook endpoint is expected and safe.

Delivery failure (blocked URL, non-2xx response, network error, timeout) is
logged as a warning and never propagates — the result is already parked in
Redis before delivery is attempted, so `GET /invocations/:id` polling
remains the reliable path regardless of webhook outcome (SPEC.md: "webhook
delivery failure → warn + result still available by polling until TTL").

## Deployment: three Deployments, independently scaled

**Human-approved shape (2026-07-14).** Same image across all three; each
entrypoint is its own Deployment (not a second container in the worker's
pod) so each gets independent replica counts and resource requests, and a
rebuild-redeploy rolls all three:

| Deployment | Entrypoint | Scales on |
|---|---|---|
| `connector-runtime` (worker) | `src/worker.ts` | Temporal task-queue depth — pull-based, no inbound HTTP, KEDA/HPA on queue backlog if autoscaling is ever enabled |
| `connector-runtime-http` | `src/http-main.ts`, port `HTTP_FACADE_PORT` (3100), fronted by a Service | Inbound RPS — a normal HTTP server behind the gateway, so HPA on CPU/RPS/concurrent-connections applies as it would to any other HTTP service |
| `connector-runtime-invoke` | `src/invoke-consumer-main.ts` | JetStream consumer lag on the `connector-runtime-invoke` durable across `INGRESS-<tenant>` streams |

Sharing one image keeps the breaker/cache/audit-event code identical across
all three entrypoints without a build/publish step per entrypoint; each
Deployment gets independent resource requests and (if enabled) HPA targets.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Health server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address:port |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `CONNECTOR_ADMIN_URL` | `platformServiceUrl("connector-admin-api", env)` | Connector admin API URL |
| `PLATFORM_ENVIRONMENT` | `dev` | Feeds every `platformServiceUrl(...)` default below |
| `REDIS_HOST` | `localhost` | Redis host for the connector-config cache, breaker state and invocation parking |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_CLUSTER_MODE` | *(off)* | Cluster client only on the literal `"true"` (`workflowHttpWorkerConfig.redisClusterMode`) |
| `HTTP_RESPONSE_CACHE_ENABLED` | `true` | Disabled only by the literal `"false"` (case-insensitive) |
| `REGISTRY_SERVICE_URL` | `platformServiceUrl("registry-service", env)` | Registry DNS-fallback lookup for `executeServiceCall` |
| `AGENT_ADMIN_SERVICE_URL` | `platformServiceUrl("agent-admin-service", env)` | Target of `reportMcpUsageEvent` |
| `NATS_URL` | `nats://localhost:4222` | JetStream endpoint for the audit events and the async invoke transport |
| `LOG_LEVEL` | `info` | Read by the shared `PinoLoggerService` (`packages/observability/src/logger.ts`), NOT by this service's `src/config.ts` |
| `HTTP_FACADE_PORT` | `3100` | Port for the HTTP invoke facade (`src/http-main.ts`) — separate from the worker's health `PORT` |
| `INVOKE_RATE_LIMIT` | `RATE_LIMIT_DEFAULT_LIMIT` (`@yoizen/shared`, currently `1000`) | Per-tenant request limit for the invoke facade's sliding window |
| `INVOKE_RATE_LIMIT_WINDOW_MS` | `RATE_LIMIT_DEFAULT_WINDOW_MS` (`@yoizen/shared`, currently `60000`) | Sliding-window duration (ms) for the invoke facade's rate limit |
| `INVOCATION_RESULT_TTL_SECONDS` | `900` (15 min) | Redis TTL for a parked invocation result (`invocation:<tenant>:<id>`) |
| `INVOKE_WEBHOOK_TIMEOUT_MS` | `10000` | Bounded timeout for the async invoke consumer's outbound webhook POST |
| `INVOKE_CONSUMER_HEALTH_PORT` | `3200` | Health server port for the async invoke consumer entrypoint (`src/invoke-consumer-main.ts`) |

### Connector Configuration

Connectors are managed by connector-admin. connector-runtime queries connector-admin for runtime configuration:

The wire shape is `AdapterConfig` (`packages/shared/src/adapter.interfaces.ts`)
— note there is no nested `auth` object and no `timeout`/`retries` fields;
auth is the flat `authType` + `authConfig` pair, and the retry chain is
`timeoutMs`/`maxRetries`/`retryBackoffMs`:

```
GET /connectors/{adapterId}
→ {
    id: string,
    tenantId: string,
    name: string,
    context: string,
    baseUrl: string,
    authType: string,                       // "none" | "api-key" | "bearer" | "basic" | "oauth2-client"
    authConfig: Record<string, unknown>,
    headers: IAdapterHeaderEntry[],         // an ARRAY, not a map
    timeoutMs: number,
    maxRetries: number,
    retryBackoffMs: number,
    healthCheckPath: string,
    status: AdapterStatusValue,
    tags: string[],
    defaultCache?: AdapterCacheStrategy,
    endpoints: AdapterEndpointConfig[]
  }
```

The service caches this for a soft TTL of 60s and serves stale data (up to a 300s stale window) while refreshing in the background.

## Debugging Tips

### Check Health Status

```bash
curl -v http://localhost:3000
```

**200 OK**: Worker is ready and connected to Temporal.  
**503 Service Unavailable**: Worker is starting or Temporal connection failed.

### Enable Debug Logging

```bash
LOG_LEVEL=debug bun run start:dev
```

Watch for:
- `[adapter-client] cache hit/miss` — connector config resolution
- `[http-call] retrying after` — retry attempts
- `[circuit-breaker] state changed` — circuit breaker state transitions

### Monitor Task Queue Depth

Use Temporal Web UI (usually at `http://localhost:8080`):
1. Navigate to "Task Queues"
2. Find `connector-runtime`
3. Observe pending task count

High pending count → consider raising the replica count manually.

### Common Issues

**Issue**: Activity hangs or times out  
**Solution**: Check connector-admin connectivity and Redis. Enable debug logging to see where time is spent.

**Issue**: Connector config not resolving
**Solution**: Verify connector-admin is running and returning configs. Check Redis cache by:
```bash
redis-cli KEYS "*adapter*"
```

**Issue**: Circuit breaker keeps opening  
**Solution**: Check if the target endpoint is responding. Examine response times — if consistently > timeout, increase timeout in connector config.

## Dependencies

| Service | Protocol | Purpose |
|---------|----------|---------|
| **Temporal Server** | gRPC | Receive activity tasks, report results |
| **connector-admin** | HTTP | Fetch connector configs |
| **Redis** | TCP | Cache connector configs and OAuth2 tokens |
| **Target endpoints** | HTTP(S) | Execute user-requested HTTP calls |

## Integration Points

### Called By

- **workflow-service**: `endpointCall` actions dispatch to connector-runtime task queue
- **api-gateway**: proxies `POST /api/v1/connectors/:connectorId/endpoints/:endpointId/invoke`
  (200 sync / 202 async passthrough) and `GET /api/v1/connectors/invocations/:invocationId`
  to `connector-runtime-http` — tenant-scoped authz + per-tenant rate limiting from day one,
  no `@Public()` bypass. See `services/api-gateway/src/modules/connector-invoke/`.
- **NATS JetStream (`INGRESS-<tenant>`)**: the async invoke consumer
  (`connector-runtime-invoke` durable) is invoked indirectly — the facade
  publishes `invoke_requested`, the consumer picks it up.

### Calls To

- **connector-admin**: REST API for connector config resolution
- **Redis**: stale-while-revalidate connector-config cache AND (T05) invocation result
  parking (`invocation:<tenant>:<id>`)
- **Target endpoints**: user-configured HTTP endpoints (sync, and async via the invoke consumer)
- **Caller-supplied webhook URLs**: best-effort async invoke result delivery, SSRF-guarded
- **OpenTelemetry collector** (if configured): Traces and metrics

## Further Reading

- [Temporal Activity Documentation](https://temporal.io/docs/concepts/what-is-a-workflow-definition#activities)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
