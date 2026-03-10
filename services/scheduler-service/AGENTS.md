# AGENTS.md - Scheduler Service

## Project Overview

The Scheduler Service provides multi-tenant job scheduling with support for cron expressions, fixed intervals, and one-time executions. It runs a tick-based scheduling engine that evaluates due schedules and dispatches them to pluggable executors (inline JavaScript evaluation or Kubernetes Jobs). State is persisted in per-tenant PostgreSQL databases via the `TenantConnectionManager` pattern, and a min-heap priority queue ensures efficient schedule evaluation.

## Tech Stack

| Category | Technology |
|----------|------------|
| Runtime | Bun 1.3 |
| Framework | NestJS 11 + Fastify |
| Language | TypeScript 5.7 (strict) |
| Database | Per-tenant PostgreSQL via `postgres` (postgres.js) |
| K8s Client | `@kubernetes/client-node` (CoreV1Api, BatchV1Api) |
| Cron Parsing | `cron-parser` |
| Validation | `class-validator` + `class-transformer` |
| Shared | `@yoizen/shared` (workspace: `packages/shared/`) |

## Repository Structure

```
src/
├── main.ts                                 # Bootstrap: Fastify adapter, ValidationPipe, port binding
├── app.module.ts                           # @Global() root module with K8s + TenantConnectionManager
├── providers/
│   ├── kubernetes.provider.ts              # @Global() K8S_CORE_API, K8S_BATCH_API tokens
│   └── tenant-connection-manager.ts        # Per-tenant PostgreSQL pools (Map-based), schema auto-init
├── engine/
│   ├── engine.module.ts                    # EngineModule (imports Schedules + Executions)
│   ├── engine.service.ts                   # Tick loop, schedule evaluation, executor dispatch
│   └── schedule-queue.ts                   # Min-heap priority queue sorted by next_run_at
├── executors/
│   ├── executors.module.ts                 # Registers executors on init
│   ├── executor.interface.ts               # ScheduleExecutor interface
│   ├── js-inline.executor.ts              # Evaluates inline JS via new Function()
│   └── k8s-job.executor.ts                # Creates K8s Jobs for js-k8s and docker exec modes
└── modules/
    ├── schedules/
    │   ├── schedules.module.ts
    │   ├── schedules.controller.ts         # CRUD /schedules, POST /schedules/:id/trigger
    │   ├── schedules.service.ts            # Schedule CRUD, next_run_at calculation
    │   └── schedule.dto.ts                 # CreateScheduleDto, UpdateScheduleDto
    ├── executions/
    │   ├── executions.module.ts
    │   ├── executions.controller.ts        # GET /executions, GET /schedules/:id/executions
    │   └── executions.service.ts           # Execution log queries
    └── health/
        ├── health.module.ts
        └── health.controller.ts            # GET /health
```

## Key Files

| File | Purpose |
|------|---------|
| `src/engine/engine.service.ts` | Central tick loop (interval-based), evaluates due schedules, dispatches to registered executors, logs results |
| `src/engine/schedule-queue.ts` | Min-heap priority queue for O(log n) schedule insertion and O(1) peek of next due schedule |
| `src/executors/js-inline.executor.ts` | Executes inline JavaScript code via `new Function()` with timeout |
| `src/executors/k8s-job.executor.ts` | Creates Kubernetes Jobs for `js-k8s` and `docker` execution modes, polls for completion |
| `src/providers/tenant-connection-manager.ts` | Lazy per-tenant pool creation, schema auto-init (schedules + execution_logs tables) |
| `src/modules/schedules/schedules.service.ts` | Schedule CRUD with cron/interval/one-time next_run_at calculation |

## Architecture Highlights

### Module Dependency Graph

```
AppModule (@Global)
├── KubernetesModule (@Global) ─── K8S_CORE_API, K8S_BATCH_API
├── TenantConnectionManager (Map<string, Sql>)
├── EngineModule (@Global)
│   ├── SchedulesModule ─── SchedulesController, SchedulesService
│   ├── ExecutionsModule ─── ExecutionsController, ExecutionsService
│   └── EngineService (tick loop + executor dispatch)
├── ExecutorsModule
│   ├── JsInlineExecutor
│   └── K8sJobExecutor
└── HealthModule -> HealthController
```

### Data Flow

1. **Create schedule**: `POST /schedules` -> validate DTO -> compute `next_run_at` from expression -> INSERT into tenant DB
2. **Engine tick**: `EngineService` runs on interval -> queries due schedules -> dispatches to executor -> logs execution result
3. **Inline JS**: `JsInlineExecutor` runs code via `new Function()` with configurable timeout
4. **K8s Job**: `K8sJobExecutor` creates a Job in tenant namespace, polls pod status until completion/timeout
5. **Manual trigger**: `POST /schedules/:id/trigger` immediately executes a schedule regardless of next_run_at

### Schedule Types

| Type | Expression | Example |
|------|-----------|---------|
| `cron` | Cron expression | `0 */5 * * *` (every 5 hours) |
| `interval` | Milliseconds | `60000` (every minute) |
| `one-time` | ISO timestamp | `2025-01-01T00:00:00Z` |

### Execution Modes

| Mode | Executor | Description |
|------|----------|-------------|
| `js-inline` | `JsInlineExecutor` | Evaluates inline JS in the service process |
| `js-k8s` | `K8sJobExecutor` | Runs JS code in a Kubernetes Job (Bun image) |
| `docker` | `K8sJobExecutor` | Runs arbitrary Docker image as a K8s Job |

### Database Schema (per-tenant)

```sql
schedules (
    id UUID, name, description, type, expression, exec_mode,
    config JSONB, enabled, next_run_at, last_run_at,
    created_at, updated_at
)

execution_logs (
    id UUID, schedule_id FK, status, started_at, completed_at,
    duration_ms, output, error, metadata JSONB, created_at
)
```

### Communication

| Target | Protocol | Purpose |
|--------|----------|---------|
| Per-tenant PostgreSQL | TCP | Persist schedules and execution logs |
| Kubernetes Batch API | HTTPS | Create and monitor Jobs for js-k8s/docker execution |
| Kubernetes Core API | HTTPS | Read pod logs, list pods |

### DI Tokens

| Token | Type | Source |
|-------|------|--------|
| `K8S_CORE_API` | `CoreV1Api` | `kubernetes.provider.ts` |
| `K8S_BATCH_API` | `BatchV1Api` | `kubernetes.provider.ts` |

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `POSTGRES_PORT` | `5432` | PostgreSQL port (per-tenant) |
| `POSTGRES_USER` | `yoizen` | PostgreSQL username |
| `POSTGRES_PASSWORD` | `yoizen-dev-password` | PostgreSQL password |
| `PLATFORM_ENVIRONMENT` | `dev` | Environment name for tenant namespace resolution |

### Constants from `@yoizen/shared`

| Constant | Description |
|----------|-------------|
| `SCHEDULER_DEFAULT_TIMEOUT_MS` | Default execution timeout |
| `SCHEDULER_K8S_DEFAULT_TIMEOUT_S` | K8s Job timeout |
| `SCHEDULER_TICK_INTERVAL_MS` | Engine tick interval |
| `SCHEDULER_MAX_EXECUTION_LOG_ROWS` | Max rows returned for execution queries |

### Knative

- Image: `dev.local/scheduler-service:local`
- Autoscaling: min 1, max 5, target concurrency 50
- Readiness probe: `GET /health` on port 3000
- RBAC: `scheduler-job-manager` ClusterRole for batch Jobs, pods, pods/log, configmaps

## Testing

| Command | Scope |
|---------|-------|
| `bun test` | All tests |
| `bun test test/unit` | Unit tests |
| `bun test test/integration` | Integration tests (requires K8s + PostgreSQL) |

## Code Style and Conventions

- **Per-tenant pools**: `Map<string, Sql>` with lazy creation, schema auto-init on first access
- **Min-heap queue**: O(log n) insertion, O(1) peek for next due schedule
- **Executor registry**: `Map<string, ScheduleExecutor>` populated at module init via `ExecutorsModule`
- **Tick loop**: `setInterval` with configurable tick rate, processes one tenant at a time
- **Tenant scoping**: all operations require `x-yoizen-tenant` header
- **Lifecycle hooks**: `OnModuleInit` starts engine tick, `OnModuleDestroy` stops it and closes pools

## Common Tasks

### Add a new executor

1. Create a file in `src/executors/`, implement `ScheduleExecutor` interface
2. Register it in `ExecutorsModule.onModuleInit()` via `engineService.registerExecutor()`

### Run locally

```bash
bun install
bun run start:dev
```

Requires local PostgreSQL per tenant and Kubernetes cluster access for K8s executors.

## Dependencies on Other Services

| Service | Relationship |
|---------|-------------|
| **Per-tenant PostgreSQL** | Persists schedules and execution logs |
| **Kubernetes API** | Creates Jobs for js-k8s and docker execution modes |
| **api-gateway** | Upstream proxy (scheduler endpoints proxied through the gateway) |
| **tenant-service** | Provisions per-tenant PostgreSQL instances |
| **`@yoizen/shared`** | Scheduler constants, `TENANT_HEADER` |
