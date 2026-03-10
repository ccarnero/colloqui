# AGENTS.md - Workflow HTTP Worker

## Project Overview

The Workflow HTTP Worker is a standalone Temporal worker that executes HTTP-based workflow activities. It connects to the Temporal server on the `workflow-http` task queue and processes `endpointCall` activities, making HTTP requests to arbitrary endpoints via `axios` with tenant header injection. It has no NestJS framework — just a raw Temporal worker with an HTTP health server.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | None (standalone Temporal worker) |
| Language | TypeScript 5.7 (strict) |
| Orchestration | Temporal (`@temporalio/worker`, `@temporalio/activity`) |
| HTTP Client | `axios` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── worker.ts                               # Main entry: Temporal worker + HTTP health server
└── activities/
    ├── index.ts                            # Barrel export: executeEndpointCall
    └── endpoint-call.activity.ts          # HTTP call via axios with tenant header

Dockerfile                                  # oven/bun:1.3-debian multi-stage
package.json
tsconfig.json
```

## Key Files

| File | Purpose |
|------|---------|
| `src/worker.ts` | Creates Temporal `NativeConnection`, registers activities, starts worker on `workflow-http` task queue, runs health server |
| `src/activities/endpoint-call.activity.ts` | Makes HTTP requests via `axios` with `x-yoizen-tenant` header, 30s timeout, returns status/data/headers |

## Architecture Highlights

### Data Flow

```
Temporal Server
  -> deliver endpointCall activity task (workflow-http queue)
  -> worker picks up task
  -> axios HTTP request to target URL with tenant header
  -> return { status, data, headers } to Temporal
```

### Activity: `executeEndpointCall`

| Field | Description |
|-------|-------------|
| `method` | HTTP method (GET, POST, PUT, etc.) |
| `url` | Target URL |
| `params` | URL query parameters |
| `data` | Request body |
| `headers` | Additional headers (merged with tenant header) |

The activity automatically injects `x-yoizen-tenant` header with the tenant ID and uses `validateStatus: () => true` to return all HTTP status codes without throwing.

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| Temporal Server | gRPC | Bidirectional | Receive activity tasks, report results |
| Arbitrary endpoints | HTTP | Outbound | Execute endpoint calls as workflow activities |

### Worker Configuration

| Setting | Value |
|---------|-------|
| Task queue | `workflow-http` |
| Max concurrent activities | 200 |
| Shutdown grace time | 30s |
| Activity timeout | 30s (axios) |
| DNS | IPv4-first (via `dns.setDefaultResultOrder`) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Health server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |

### Knative

- Image: `dev.local/workflow-http-worker:local`
- Autoscaling: min 1, max 5
- Readiness probe: HTTP health check on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests (requires Temporal server) |

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
| **`@yoizen/shared`** | `WORKFLOW_HTTP_TASK_QUEUE`, `EndpointCallArgs`, `TENANT_HEADER` |
