# AGENTS.md - Workflow Service

## Project Overview

The Workflow Service provides a REST API for starting and querying Temporal workflows, plus a standalone Temporal worker that executes orchestrator-level activities. Workflows are defined as ordered sequences of actions (endpoint calls, inline JS functions, NATS service bus calls, parallel branches) with `{{path.to.value}}` template resolution against the execution context. The service runs as two processes: the NestJS API server and the Temporal worker.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify (API), standalone Temporal worker |
| Language | TypeScript 5.7 (strict) |
| Orchestration | Temporal (`@temporalio/client`, `@temporalio/worker`, `@temporalio/workflow`) |
| Messaging | NATS (`nats` package, used in service-bus activity) |
| Validation | `class-validator` + `class-transformer` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                                     # API server bootstrap: Fastify adapter, ValidationPipe
├── app.module.ts                               # Root module: ProvidersModule, WorkflowsModule, HealthModule
├── providers/
│   ├── providers.module.ts                     # @Global() exporting TEMPORAL_CLIENT + NATS_CONNECTION
│   ├── temporal.provider.ts                    # TEMPORAL_CLIENT token, TenantId search attribute registration
│   └── nats.provider.ts                        # NATS_CONNECTION token
├── modules/
│   ├── workflows/
│   │   ├── workflows.module.ts
│   │   ├── workflows.controller.ts             # POST /workflows (202), GET /workflows, GET /workflows/:id
│   │   ├── workflows.service.ts                # Start workflow via Temporal, query status, list by tenant
│   │   └── dto/
│   │       └── start-workflow.dto.ts           # StartWorkflowDto (name, application, request, actions)
│   └── health/
│       ├── health.module.ts
│       └── health.controller.ts                # GET /health (Temporal connectivity)
└── temporal/
    ├── workflows.ts                            # runWorkflow: sequential action execution with template resolution
    ├── worker.ts                               # Standalone Temporal worker process (orchestrator task queue)
    ├── templating.ts                           # {{path.to.value}} template resolution utility
    └── activities/
        ├── index.ts                            # Barrel export: executeJsFunction, executeServiceBusCall
        ├── js-function.activity.ts            # Evaluates inline JS via new Function()
        └── service-bus.activity.ts             # Publishes to NATS subject with tenant header
```

## Key Files

| File | Purpose |
|------|---------|
| `src/temporal/workflows.ts` | Main workflow definition: `runWorkflow()` — iterates actions, resolves templates, dispatches to activities |
| `src/temporal/worker.ts` | Standalone worker process: connects to Temporal, registers workflows + activities, health server |
| `src/temporal/activities/service-bus.activity.ts` | NATS publish activity with tenant header injection |
| `src/temporal/activities/js-function.activity.ts` | Inline JS execution via `new Function()` |
| `src/modules/workflows/workflows.service.ts` | Starts workflows via Temporal client, queries status, lists by tenant using `TenantId` search attribute |
| `src/providers/temporal.provider.ts` | Temporal client factory, registers `TenantId` search attribute on init |

## Architecture Highlights

### Dual Process Architecture

| Process | Entry Point | Task Queue | Purpose |
|---------|-------------|------------|---------|
| API Server | `src/main.ts` | — | REST API for workflow management |
| Orchestrator Worker | `src/temporal/worker.ts` | `workflow-orchestrator` | Executes workflows + local activities |

### Action Types

| Activity | Task Queue | Description |
|----------|-----------|-------------|
| `endpointCall` | `workflow-http` (remote) | HTTP call via `workflow-http-worker` |
| `jsFunction` | `workflow-orchestrator` (local) | Inline JS evaluation via `new Function()` |
| `serviceBusCall` | `workflow-orchestrator` (local) | NATS publish with tenant header |
| `branch` | — (workflow-level) | Parallel execution of multiple action branches |

### Template Resolution

Actions support `{{path.to.value}}` templates resolved against the `WorkflowExecutionContext`:
- `{{request.fieldName}}` — from the initial request payload
- `{{results.actionName.data}}` — from a previous action's result
- `{{workflow.tenant}}` — tenant ID

### Data Flow

1. **Start workflow**: `POST /workflows` -> validate DTO -> `temporal.workflow.start('runWorkflow', ...)` with `TenantId` search attribute -> 202 Accepted
2. **Workflow execution**: `runWorkflow()` iterates actions sequentially, resolves templates, dispatches to activities
3. **Query status**: `GET /workflows/:id` -> `temporal.workflow.getHandle(id).describe()` -> return status/result
4. **List workflows**: `GET /workflows` -> Temporal `workflow.list()` with `TenantId` filter

### Module Dependency Graph

```
AppModule
├── ProvidersModule (@Global) ─── TEMPORAL_CLIENT, NATS_CONNECTION
├── WorkflowsModule ─── WorkflowsController, WorkflowsService
└── HealthModule ─── HealthController
```

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| Temporal Server | gRPC | Outbound | Start/query/list workflows |
| NATS | TCP | Outbound | Service bus activity publishes to NATS subjects |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `TEMPORAL_CLIENT` | `Client` (@temporalio/client) | `temporal.provider.ts` |
| `NATS_CONNECTION` | `NatsConnection` | `nats.provider.ts` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |

### Knative

Two Knative services are deployed from this codebase:

| Service | Image | Entrypoint | Min/Max Scale |
|---------|-------|------------|---------------|
| `workflow-api` | `dev.local/workflow-service:local` | `dist/main.js` | 1 / 5 |
| `workflow-worker` | `dev.local/workflow-service:local` | `dist/temporal/worker.js` | 1 / 3 |

Readiness probe: `GET /health` on port 3000

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests (requires Temporal server) |

## Code Style and Conventions

- **Dual entrypoint**: single codebase, `ENTRYPOINT` env var selects API or worker mode via Dockerfile
- **Workflow ID format**: `{tenantId}:{name}:{nanoid()}` for tenant-scoped uniqueness
- **Search attributes**: `TenantId` indexed keyword for tenant-scoped workflow queries
- **Template resolution**: `{{path.to.value}}` syntax in action args, resolved at execution time
- **Activity retry**: 3 attempts with 30s start-to-close timeout for all activities
- **Parallel branches**: `branch` action type executes sub-action lists concurrently via `Promise.all`
- **Worker concurrency**: max 100 activity tasks, 50 workflow tasks, 30s shutdown grace

## Common Tasks

### Add a new activity type

1. Create activity function in `src/temporal/activities/`
2. Export from `src/temporal/activities/index.ts`
3. Add activity type to `WorkflowAction` union in `@yoizen/shared`
4. Add case to `executeAction()` switch in `src/temporal/workflows.ts`

### Run locally

```bash
# API server
bun install
bun run start:dev

# Worker (separate terminal)
bun run start:worker:dev
```

Requires local Temporal server (`localhost:7233`) and NATS (`nats://localhost:4222`).

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **Temporal Server** | Workflow execution engine (gRPC) |
| **NATS** | Service bus activity publishes to NATS subjects |
| **workflow-http-worker** | Executes `endpointCall` activities on the `workflow-http` task queue |
| **api-gateway** | Upstream proxy (workflow endpoints proxied through the gateway) |
| **`@yoizen/shared`** | Workflow types, task queue names, `TENANT_HEADER` |
