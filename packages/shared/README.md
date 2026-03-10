# @yoizen/shared

Cross-service types, interfaces, and constants for the Yoizen Arch platform. This package is the single source of truth for all shared contracts between services.

## Installation

Referenced as a workspace dependency in each service's `package.json`:

```json
{
  "dependencies": {
    "@yoizen/shared": "file:../../packages/shared"
  }
}
```

## Exports

### Constants (`constants.ts`)

**NATS Streams & Consumers**: `STREAM_NAME`, `STREAM_SUBJECTS`, `CONSUMER_NAME`, `AUDIT_CONSUMER_NAME`, `METRICS_CONSUMER_NAME`, `METRICS_SUBJECT`, `WEBHOOK_CONSUMER_NAME`, `RESULTS_STREAM_NAME`, `DLQ_STREAM_NAME`

**Redis Keys & TTLs**: `RESULT_KEY_PREFIX`, `PENDING_KEY_PREFIX`, `CALLBACK_KEY_PREFIX`, `RESULT_TTL`, `RESULT_CACHE_MAX`

**Webhook**: `WEBHOOK_MAX_RETRIES`, `WEBHOOK_RETRY_DELAYS`, `WEBHOOK_DLQ_SUBJECT`

**Multi-tenancy**: `TENANT_HEADER` (`x-yoizen-tenant`)

**Scheduler**: `SCHEDULER_DEFAULT_TIMEOUT_MS`, `SCHEDULER_K8S_DEFAULT_TIMEOUT_S`, `SCHEDULER_TICK_INTERVAL_MS`

**Registry / Knative**: `REGISTRY_KNATIVE_GROUP`, `REGISTRY_KNATIVE_VERSION`, `REGISTRY_KNATIVE_SERVICES_PLURAL`

**Workflow / Temporal**: `WORKFLOW_ORCHESTRATOR_TASK_QUEUE`, `WORKFLOW_HTTP_TASK_QUEUE`, `WORKFLOW_DEFAULT_TIMEOUT_MS`

### Interfaces (`interfaces.ts`)

`EventEnvelope`, `EventMetadata`, `EventResult`, `ProcessedEvent`, `CompletionEvent`, `MetricsPayload`

### Auth (`auth.constants.ts`, `auth.interfaces.ts`)

`ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `PUBLIC_ROUTES_CACHE_KEY_PREFIX`, `PUBLIC_ROUTES_CACHE_TTL`, `JwtPayload`, `TokenResponse`, `TokenScope`, `TokenType`, `UserRole`, `PublicRouteEntry`

### Workflow (`workflow.interfaces.ts`)

`WorkflowDefinition`, `WorkflowExecutionContext`, `WorkflowAction`, `EndpointCallAction`, `JsFunctionAction`, `ServiceBusCallAction`, `BranchAction`, `EndpointCallArgs`, `JsFunctionArgs`, `ServiceBusCallArgs`

## Architecture

See [AGENTS.md](AGENTS.md) for detailed export inventory and usage by service.
