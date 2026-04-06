# AGENTS.md - Workflow HTTP Worker

## Project Overview

The Workflow HTTP Worker is a standalone Temporal worker that executes HTTP-based workflow activities. It connects to the Temporal server on the `workflow-http` task queue and processes `endpointCall` activities. When `adapterId` and `endpointId` are provided, it resolves the full request configuration (URL, auth, headers, retries, timeouts) through `AdapterClient` backed by a Redis stale-while-revalidate cache. Otherwise, it makes direct HTTP requests to the specified URL. All HTTP calls use `tracedFetch` from `@yoizen/observability` for OpenTelemetry instrumentation. It has no NestJS framework — just a raw Temporal worker with an HTTP health server.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | None (standalone Temporal worker) |
| Language | TypeScript 5.7 (strict) |
| Orchestration | Temporal (`@temporalio/worker`, `@temporalio/activity`) |
| HTTP Client | `tracedFetch` (`@yoizen/observability`) |
| Adapter Resolution | `AdapterClient` (`@yoizen/shared`) with `ioredis` cache |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── worker.ts                               # Main entry: Temporal worker + HTTP health server
└── activities/
    ├── index.ts                            # Barrel export: executeEndpointCall
    └── endpoint-call.activity.ts          # HTTP call via tracedFetch; adapter-aware with AdapterClient

Dockerfile                                  # oven/bun:1.3-debian multi-stage
package.json
tsconfig.json
```

## Key Files

| File | Purpose |
|------|---------|
| `src/worker.ts` | Creates Temporal `NativeConnection`, registers activities, starts worker on `workflow-http` task queue, runs health server |
| `src/activities/endpoint-call.activity.ts` | Routes to `executeWithAdapter` (adapter path) or `executeRaw` (direct path). Uses `AdapterClient` with Redis SWR cache for adapter resolution, `tracedFetch` for all HTTP calls |

## Architecture Highlights

### Data Flow

```
Temporal Server
  -> deliver endpointCall activity task (workflow-http queue)
  -> worker picks up task
  -> if adapterId + endpointId:
       AdapterClient.resolveRequest(tenantId, adapterId, endpointId)
       -> fetch adapter config from adapter-service (Redis SWR cache)
       -> resolve URL, auth headers, timeout, retries
       -> tracedFetch with adapter config + exponential backoff retry
  -> else:
       tracedFetch to raw URL with tenant header (30s default timeout)
  -> return { status, data, headers } to Temporal
```

### Activity: `executeEndpointCall`

| Field | Description |
|-------|-------------|
| `method` | HTTP method (GET, POST, PUT, etc.) |
| `url` | Target URL (used for raw path; ignored when adapter resolves URL) |
| `adapterId` | *(optional)* Adapter ID for config resolution |
| `endpointId` | *(optional)* Endpoint ID within the adapter |
| `params` | URL query parameters |
| `data` | Request body |
| `headers` | Additional headers (merged with adapter/tenant headers) |

When `adapterId` and `endpointId` are present, the activity resolves the full request via `AdapterClient` (URL, auth, custom headers, timeout, retries). The tenant header is always injected. Caller-provided `headers` override adapter headers.

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| Temporal Server | gRPC | Bidirectional | Receive activity tasks, report results |
| Arbitrary endpoints | HTTP | Outbound | Execute endpoint calls as workflow activities |
| adapter-service | HTTP | Outbound | Fetch adapter config via `AdapterClient` (cached in Redis) |
| Redis | TCP | Outbound | Stale-while-revalidate cache for adapter configs and OAuth2 tokens |

### Worker Configuration

| Setting | Value |
|---------|-------|
| Task queue | `workflow-http` |
| Max concurrent activities | 200 |
| Shutdown grace time | 30s |
| Activity timeout | Adapter `timeoutMs` or 30s default |
| DNS | IPv4-first (via `dns.setDefaultResultOrder`) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Health server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `ADAPTER_SERVICE_URL` | `http://adapter-service.platform-services-dev.svc.cluster.local` | Adapter service URL |
| `REDIS_HOST` | `localhost` | Redis host (adapter cache) |
| `REDIS_PORT` | `6379` | Redis port |

### Knative

- Image: `dev.local/workflow-http-worker:local`
- Autoscaling: min 1, max 5
- Readiness probe: HTTP health check on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |

There is no `test/integration/` suite in this package yet; use `bun test` for the full run.

## Code Style and Conventions

- **No NestJS**: raw Temporal worker + `http.createServer` for health checks
- **DNS resolution**: `dns.setDefaultResultOrder('ipv4first')` for K8s compatibility
- **Graceful shutdown**: SIGTERM/SIGINT handlers toggle health status and call `worker.shutdown()`
- **Response normalization**: only string headers are included in the response object
- **High concurrency**: 200 max concurrent activity tasks for parallel HTTP calls

## Common Tasks

### Run locally

```bash
bun install
bun run start:dev
```

Requires local Temporal server (`localhost:7233`).

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **Temporal Server** | Receives activity tasks from the `workflow-http` task queue |
| **workflow-service** | Dispatches `endpointCall` activities to this worker via Temporal |
| **adapter-service** | Provides adapter config via REST API (fetched through `AdapterClient`) |
| **Redis** | Stale-while-revalidate cache for adapter configs and OAuth2 tokens |
| **`@yoizen/shared`** | `WORKFLOW_HTTP_TASK_QUEUE`, `EndpointCallArgs`, `TENANT_HEADER`, `AdapterClient`, `DEFAULT_ADAPTER_SERVICE_URL` |
| **`@yoizen/observability`** | `tracedFetch` for instrumented HTTP calls |
