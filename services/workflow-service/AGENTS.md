# AGENTS.md - Workflow Service

## Project Overview

The Workflow Service provides a REST API for starting and querying Temporal workflows, plus a standalone Temporal worker that executes orchestrator-level activities. Workflows are defined as ordered sequences of actions (endpoint calls, inline JS functions, NATS service bus calls, parallel branches) with `{{path.to.value}}` template resolution against the execution context. The service runs as two processes: the NestJS API server and the Temporal worker.

## Storage engines

Workflow **definitions/executions** support **Postgres** (default) and **Mongo** (repository adapters). **Temporal** remains on dedicated Postgres regardless of OLTP engine. See [DOCS/runbooks/storage-engines.md](../../DOCS/runbooks/storage-engines.md).

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
│   ├── providers.module.ts                     # @Global() exporting TEMPORAL_CLIENT, NATS_CONNECTION, WorkflowTenantConnectionManager
│   ├── temporal.provider.ts                    # TEMPORAL_CLIENT token, TenantId search attribute registration
│   └── tenant-connection-manager.ts            # Per-tenant Postgres pool manager (subclass of @yoizen/database TenantConnectionManager)
├── modules/
│   ├── workflows/
│   │   ├── workflows.module.ts
│   │   ├── workflows.controller.ts             # definition CRUD, POST /:id/execute, execution queries
│   │   ├── workflows.service.ts                # Persist definitions, start executions via Temporal, query execution rows/status
│   │   └── dto/
│   │       ├── create-workflow.dto.ts          # CreateWorkflowDto (name, application, request, actions)
│   │       ├── execute-workflow.dto.ts         # Execute workflow request shape
│   │       └── workflow-action.validator.ts    # Action array validation
│   └── health/
│       ├── health.module.ts
│       └── health.controller.ts                # GET /health (Temporal + NATS + per-tenant Postgres)
└── temporal/
    ├── workflows.ts                            # runWorkflow + {{path.to.value}} template resolution (TEMPLATE_RE, resolveTemplates)
    ├── worker.ts                               # Standalone Temporal worker process (orchestrator task queue)
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
| `endpointCall` | `connector-runtime` (remote) | External HTTP call via connector-runtime |
| `serviceCall` | `connector-runtime` (remote) | Internal service HTTP call via connector-runtime |
| `agentCall` | `workflow-orchestrator` (local proxy) | YoizenClaw agent execution with workflow variables |
| `jsFunction` | `workflow-orchestrator` (local) | Inline JS evaluation via `new Function()` |
| `serviceBusCall` | `workflow-orchestrator` (local) | NATS publish with tenant header |
| `channelSend` | `workflow-orchestrator` (local) | Channel delivery command publish |
| `branch` | — (workflow-level) | Parallel execution of named action lists |
| `conditional` | — (workflow-level) | First matching conditional branch or default |

### Template Resolution

Actions support `{{path.to.value}}` templates resolved against the `WorkflowExecutionContext`:
- `{{request.fieldName}}` — from the initial request payload
- `{{results.actionName.data}}` — from a previous action's result
- `{{workflow.tenant}}` — tenant ID

The same resolution applies to `serviceCall` `path` and to string values inside `serviceCall` `args.data` (JSON body) before the HTTP worker runs.

### Per-tenant Postgres storage

`workflow_definitions` and `workflow_executions` are stored in **each tenant's own Postgres instance** (one per Kubernetes namespace: `postgres.{tenant}-{env}-ns.svc.cluster.local`), not in the platform Postgres. The DB itself is the tenant boundary, so neither table carries a `tenant_id` column.

- The canonical DDL lives in `@yoizen/shared` as `WORKFLOW_SCHEMA_SQL` (single source of truth).
- `tenant-service` bakes `WORKFLOW_SCHEMA_SQL` into each tenant's `init.sql` ConfigMap at provisioning time.
- `WorkflowTenantConnectionManager` also registers it via `setSchema([...])` so any older tenant gets the tables lazily on first access (idempotent via `IF NOT EXISTS`).
- Repositories resolve the per-tenant pool with `connections.ensureSchema(tenantId)` before every query.
- `ExecutionProjectorService` partitions its in-memory buffer by `tenantId` (parsed from the canonical subject token) and emits one `UPDATE ... FROM unnest(...)` per tenant on flush, so a DB failure on one tenant does not NAK sibling tenants' batches.

### Data Flow

1. **Create definition**: `POST /workflows` -> validate DTO -> persist workflow definition -> 201 Created
2. **Start execution**: `POST /workflows/:id/execute` -> load definition -> `temporal.workflow.start('runWorkflow', ...)` with `TenantId` search attribute -> 202 Accepted
3. **Query execution**: `GET /workflows/:id/executions/:executionId` -> read execution row, `workflow.getHandle(...).describe()`, return status/result
4. **List definitions/executions**: `GET /workflows` lists definitions; `GET /workflows/:id/executions` lists runs for one definition

### Activity Idempotency Contract

Temporal retries activities aggressively under network/backend stress. The 2026-05-22 stress run ([`post-mortem/POST-MORTEM.md`](../../post-mortem/POST-MORTEM.md)) observed 5 cases of `Activity not found on completion ... workflow execution already completed`, proving an activity CAN finish on the worker side after Temporal already started a retry. Every activity in this service MUST therefore be idempotent under retry/double-completion.

| Activity | Idempotency strategy | Verified |
|----------|---------------------|----------|
| `executeChannelSend` ([`channel-send.activity.ts`](src/temporal/activities/channel-send.activity.ts)) | `Nats-Msg-Id = sha256({payload, correlation_id, causation_id})` -> JetStream `duplicate_window` collapses retries | Yes |
| `publishExecutionCompletedEvent` ([`execution-completed-publisher.activity.ts`](src/temporal/activities/execution-completed-publisher.activity.ts)) | `Nats-Msg-Id = sha256(payload)` -> JetStream dedup | Yes |
| `executeServiceBusCall` ([`service-bus.activity.ts`](src/temporal/activities/service-bus.activity.ts)) | `Nats-Msg-Id = args.dedupKey ?? sha256({subject, payload, headers})`; publishes via JetStream (falls back to core NATS only when the subject has no stream) | Yes (post-mortem §P1.3 fix 1) |
| `executeAgentCall` ([`agent-call.activity.ts`](src/temporal/activities/agent-call.activity.ts)) | `executionId = ${runId}:${activityId}` derived from `@temporalio/activity` `Context.current()` so every retry of the same invocation collapses inside JetStream `duplicate_window` | Yes (post-mortem §P1.3 fix 2) |
| `executeJsFunction` ([`js-function.activity.ts`](src/temporal/activities/js-function.activity.ts)) | The activity itself is pure (just `new Function(args.code)`). Any side effect the user JS performs (HTTP call, Redis write, billing op) MUST be keyed on a stable identifier from `context` (e.g. `context.request.messageId`). Author responsibility. | Contract documented; not enforced |

When adding a new activity:

1. Identify the side effect (network, database, NATS publish, file write).
2. Pick a stable dedup key derivable from inputs that DOES NOT change across retries (e.g. `runId + activityId`, idempotency keys carried in the envelope, content hashes).
3. Prefer server-side dedup (`Nats-Msg-Id`, conditional `INSERT ... ON CONFLICT`) over client-side bookkeeping.
4. Add an entry to the table above so the next reviewer can audit it.

### Module Dependency Graph

```
AppModule
├── ProvidersModule (@Global) ─── TEMPORAL_CLIENT, NATS_CONNECTION, WorkflowTenantConnectionManager
├── WorkflowsModule ─── WorkflowsController, WorkflowsService
└── HealthModule ─── HealthController
```

NATS is not registered in `ProvidersModule`. The service-bus activity (`service-bus.activity.ts`) connects lazily via `workflowServiceConfig.natsUrl` when `executeServiceBusCall` runs.

### Communication

| Target | Protocol | Direction | Purpose |
|--------|----------|-----------|---------|
| Temporal Server | gRPC | Outbound | Start/query workflow executions |
| NATS | TCP | Outbound | Service bus activity publishes to NATS subjects |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `TEMPORAL_CLIENT` | `Client` (@temporalio/client) | `temporal.provider.ts` |
| `WorkflowTenantConnectionManager` | per-tenant `Sql` pool manager | `tenant-connection-manager.ts` |
| `NATS_CONNECTION` | `NatsConnection` | `@yoizen/database` (via `providers.module.ts`) |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `REDIS_HOST` | `localhost` | Redis host. **Required on the worker process** — `executeAgentCall` uses Redis for the distributed circuit breaker and as the `YoizenClawExecutionClient` status cache. Missing on the deployment causes every agentCall to fail with `MaxRetriesPerRequestError` / `REDIS_UNAVAILABLE`. |
| `REDIS_PORT` | `6379` | Redis port (worker only). |

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
| *(none in-service)* | No `test/integration/` directory; use `bun test test/unit` only |

## Code Style and Conventions

- **Dual entrypoint**: single codebase, `ENTRYPOINT` env var selects API or worker mode via Dockerfile
- **Workflow ID format**: `{tenantId}:{name}:{nanoid()}` for tenant-scoped uniqueness
- **Search attributes**: `TenantId` indexed keyword for tenant-scoped workflow queries
- **Template resolution**: `{{path.to.value}}` syntax in action args, resolved at execution time
- **Activity retry**: local activities 3 attempts/30s; endpointCall/serviceCall 5 attempts on connector-runtime; agentCall 3 attempts/15m
- **Parallel branches**: `branch` action type executes sub-action lists concurrently via `Promise.all`
- **Worker concurrency**: max 200 activity tasks, 150 workflow tasks, 30s shutdown grace

## Common Tasks

### Add a new activity type

1. Create activity function in `src/temporal/activities/`
2. Export from `src/temporal/activities/index.ts`
3. Add activity type to `WorkflowAction` union in `@yoizen/shared`
4. Add case to `executeAction()` switch in `src/temporal/workflows.ts`

### Run locally

```bash
# API server
pnpm install
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
| **connector-runtime** | Executes `endpointCall` and `serviceCall` activities on the `connector-runtime` task queue |
| **api-gateway** | Upstream proxy (workflow endpoints proxied through the gateway) |
| **`@yoizen/shared`** | Workflow types, task queue names, `TENANT_HEADER` |
