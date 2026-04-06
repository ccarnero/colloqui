# AGENTS.md - @yoizen/shared

## Project Overview

The `@yoizen/shared` package is the single source of truth for cross-service types, interfaces, and constants in the Yoizen Arch platform. It primarily contains type definitions and constant values that keep service contracts in sync. The one exception is `AdapterClient` — a runtime class providing stale-while-revalidate caching, OAuth2 token management, and request resolution for adapter configs.

## Package Details

| Field | Value |
|-------|-------|
| Name | `@yoizen/shared` |
| Version | `1.0.0` |
| Private | `true` |
| Entry | `./src/index.ts` |
| Dependencies | `ioredis` (optional peer — required only when using `AdapterClient`) |

## Repository Structure

```
src/
├── index.ts                # Barrel export (re-exports all modules)
├── constants.ts            # NATS streams, Redis keys, webhook config, scheduler, registry, workflow constants
├── interfaces.ts           # Event types: EventEnvelope, EventResult, ProcessedEvent, CompletionEvent, MetricsPayload
├── auth.constants.ts       # JWT TTLs, public routes cache config
├── auth.interfaces.ts      # JwtPayload, TokenResponse, TokenScope, UserRole, PublicRouteEntry
├── workflow.interfaces.ts  # WorkflowDefinition, WorkflowAction, activity argument types
├── adapter.interfaces.ts   # AdapterConfig, AdapterEndpointConfig, AdapterCache, ResolvedAdapterRequest
├── adapter-client.ts       # AdapterClient (runtime: SWR cache, OAuth2 tokens, request resolution)
└── async.utils.ts          # sleep(ms) for backoff and tests
```

## Exports by Category

### NATS Constants (`constants.ts`)

| Constant | Value | Used By |
|----------|-------|---------|
| `STREAM_NAME` | `EVENTS` | Event Processor, Audit, Metrics |
| `STREAM_SUBJECTS` | `['events.>']` | Gateway, Event Processor, Audit |
| `CONSUMER_NAME` | `event-processor` | Event Processor |
| `AUDIT_CONSUMER_NAME` | `audit-writer` | Audit Service |
| `METRICS_CONSUMER_NAME` | `metrics-writer` | Metrics Service |
| `METRICS_SUBJECT` | `events.metrics` | Metrics Service |
| `SUBJECT_PREFIX` | `events.` | Gateway |
| `RESULTS_STREAM_NAME` | `RESULTS` | Event Processor, Webhook |
| `RESULTS_STREAM_SUBJECTS` | `['results.>']` | Event Processor, Webhook |
| `RESULTS_SUBJECT_PREFIX` | `results.` | Event Processor |
| `WEBHOOK_CONSUMER_NAME` | `webhook-dispatcher` | Webhook Service |
| `WEBHOOK_DLQ_SUBJECT` | `dlq.webhook` | Webhook Service |
| `DLQ_STREAM_NAME` | `DLQ` | Webhook Service |
| `STREAM_MAX_AGE_NS` | 7 days (ns) | Event Processor, Audit, Metrics |
| `STREAM_MAX_BYTES` | 512 MB | Event Processor, Audit |
| `MAX_DELIVER` | `5` | All consumers |

### Redis Constants (`constants.ts`)

| Constant | Value | Used By |
|----------|-------|---------|
| `RESULT_KEY_PREFIX` | `result:` | Gateway, Event Processor |
| `PENDING_KEY_PREFIX` | `pending:` | Gateway |
| `CALLBACK_KEY_PREFIX` | `callback:` | Gateway |
| `RESULT_TTL` | `3600` (1 hour) | Gateway, Event Processor |
| `RESULT_CACHE_MAX` | `1024` | Gateway |

### Webhook Constants (`constants.ts`)

| Constant | Value | Used By |
|----------|-------|---------|
| `WEBHOOK_MAX_RETRIES` | `3` | Webhook Service |
| `WEBHOOK_RETRY_DELAYS` | `[1000, 5000, 30000]` | Webhook Service |

### Multi-Tenancy (`constants.ts`)

| Constant | Value | Used By |
|----------|-------|---------|
| `TENANT_HEADER` | `x-yoizen-tenant` | All services |

### Scheduler Constants (`constants.ts`)

| Constant | Description | Used By |
|----------|-------------|---------|
| `SCHEDULER_DEFAULT_TIMEOUT_MS` | Default execution timeout | Scheduler Service |
| `SCHEDULER_K8S_DEFAULT_TIMEOUT_S` | K8s Job timeout | Scheduler Service |
| `SCHEDULER_TICK_INTERVAL_MS` | Engine tick interval | Scheduler Service |
| `SCHEDULER_MAX_EXECUTION_LOG_ROWS` | Max query rows | Scheduler Service |

### Registry / Knative Constants (`constants.ts`)

| Constant | Description | Used By |
|----------|-------------|---------|
| `REGISTRY_KNATIVE_GROUP` | Knative API group | Registry Service |
| `REGISTRY_KNATIVE_VERSION` | Knative API version | Registry Service |
| `REGISTRY_KNATIVE_SERVICES_PLURAL` | Knative services plural | Registry Service |
| `REGISTRY_KNATIVE_REVISIONS_PLURAL` | Knative revisions plural | Registry Service |

### Workflow / Temporal Constants (`constants.ts`)

| Constant | Value | Used By |
|----------|-------|---------|
| `WORKFLOW_ORCHESTRATOR_TASK_QUEUE` | `workflow-orchestrator` | Workflow Service |
| `WORKFLOW_HTTP_TASK_QUEUE` | `workflow-http` | Workflow HTTP Worker |
| `WORKFLOW_DEFAULT_TIMEOUT_MS` | Default workflow timeout | Workflow Service |

### Auth Constants (`auth.constants.ts`)

| Constant | Description | Used By |
|----------|-------------|---------|
| `ACCESS_TOKEN_TTL` | Access token TTL (seconds) | Auth Service |
| `REFRESH_TOKEN_TTL` | Refresh token TTL (seconds) | Auth Service |
| `PUBLIC_ROUTES_CACHE_KEY_PREFIX` | Redis key prefix | Auth Service, Gateway |
| `PUBLIC_ROUTES_CACHE_TTL` | Cache TTL (seconds) | Gateway |

### Event Interfaces (`interfaces.ts`)

| Interface | Fields | Used By |
|-----------|--------|---------|
| `EventEnvelope` | `id, type, payload, metadata?, callbackUrl?, adapterId?, enrichAdapter?, forwardAdapter?` | Gateway, Event Processor, Audit |
| `EventMetadata` | `receivedAt, source, subject, tenantId?` | Event Processor |
| `EventResult` | `eventId, status, data, processedAt, processingTime` | Event Processor, Gateway |
| `ProcessedEvent` | `...envelope, result, processedAt, processingTime` | Event Processor |
| `CompletionEvent` | `eventId, type, status, result, completedAt, callbackUrl?, adapterId?` | Event Processor, Webhook |
| `MetricsPayload` | `source, name, value, tags?, metadata?, timestamp?` | Metrics Service |

### Auth Interfaces (`auth.interfaces.ts`)

| Interface | Fields | Used By |
|-----------|--------|---------|
| `JwtPayload` | `sub, type, scope, role?, env, iat, exp` | Auth Service, Gateway |
| `TokenResponse` | `access_token, token_type, expires_in, scope, refresh_token?` | Auth Service |
| `TokenScope` | `'platform' \| 'tenant:<name>'` | Auth Service, Gateway |
| `TokenType` | `'user' \| 'client'` | Auth Service |
| `UserRole` | `'admin' \| 'operator'` | Auth Service |
| `PublicRouteEntry` | `method, path, scope` | Auth Service, Gateway |

### Workflow Interfaces (`workflow.interfaces.ts`)

| Interface | Description | Used By |
|-----------|-------------|---------|
| `WorkflowDefinition` | Workflow name, tenant, application, request, actions | Workflow Service |
| `WorkflowExecutionContext` | Runtime context: workflow info, request, results map | Workflow Service |
| `WorkflowAction` | Union: EndpointCall \| JsFunction \| ServiceBusCall \| Branch | Workflow Service |
| `EndpointCallArgs` | HTTP method, url, params, data, headers, adapterId?, endpointId? | Workflow HTTP Worker |
| `JsFunctionArgs` | Inline JS code string | Workflow Service |
| `ServiceBusCallArgs` | NATS subject, payload, headers | Workflow Service |

### Adapter Constants (`adapter.interfaces.ts`)

| Constant | Value | Used By |
|----------|-------|---------|
| `DEFAULT_ADAPTER_SERVICE_URL` | `http://adapter-service.platform-services-dev.svc.cluster.local` | Workflow HTTP Worker, Event Processor, Webhook Service |

### Adapter Interfaces (`adapter.interfaces.ts`)

| Interface | Description | Used By |
|-----------|-------------|---------|
| `AdapterConfig` | Full adapter config: base URL, auth, headers, timeout, retries, endpoints | All adapter consumers |
| `AdapterEndpointConfig` | Endpoint definition: id, label, method, path | All adapter consumers |
| `AdapterCache` | Cache interface (get/set/del) compatible with `ioredis` | All adapter consumers |
| `ResolvedAdapterRequest` | Resolved URL, headers, timeout, retries for a specific endpoint call | Workflow HTTP Worker, Event Processor |
| `AdapterReference` | `{ adapterId: string; endpointId: string }` reference tuple | Gateway, Event Processor |

### Adapter Client (`adapter-client.ts`)

| Export | Description | Used By |
|--------|-------------|---------|
| `AdapterClient` | Runtime class: fetches adapter config from adapter-service REST API, caches in Redis with stale-while-revalidate (TTL 300s, stale 60s), manages OAuth2 client credentials tokens, resolves full request config (URL + auth headers + timeout + retries) | Workflow HTTP Worker, Event Processor, Webhook Service |

## Consumer Services

| Service | Imports |
|---------|---------|
| api-gateway | `TENANT_HEADER`, stream constants, key prefixes, TTLs, auth types |
| auth-service | Auth constants/types, `TENANT_HEADER` |
| event-processor | Stream/consumer names, key prefixes, event interfaces |
| audit-service | Stream config, `EventEnvelope`, `TENANT_HEADER` |
| webhook-service | Results/DLQ stream config, `CompletionEvent`, retry constants |
| metrics-service | `MetricsPayload`, `EventEnvelope`, stream config |
| scheduler-service | Scheduler constants, `TENANT_HEADER` |
| registry-service | Knative constants, `TENANT_HEADER` |
| tenant-service | `TENANT_HEADER` |
| workflow-service | Workflow types, task queues, `TENANT_HEADER` |
| workflow-http-worker | `WORKFLOW_HTTP_TASK_QUEUE`, `EndpointCallArgs`, `TENANT_HEADER`, `AdapterClient`, `DEFAULT_ADAPTER_SERVICE_URL` |
| adapter-service | `TENANT_HEADER`, `AdapterConfig` interface |

**Not a consumer**: `cache-service` (standalone, no shared package dependency).

## Code Style and Conventions

- **Primarily no runtime logic**: types, interfaces, and constant values; the one exception is `AdapterClient` which is a runtime class
- **Barrel exports**: `index.ts` re-exports everything
- **Naming**: SCREAMING_SNAKE_CASE for constants, PascalCase for interfaces
- **Versioning**: not published to npm; consumed via workspace `file:` references
- **TypeScript strict mode**: all strict checks enabled

## Common Tasks

### Add a new constant

1. Add the constant to the appropriate file (`constants.ts`, `auth.constants.ts`, etc.)
2. Export it from `index.ts` if not already covered by wildcard re-export

### Add a new interface

1. Add the interface to the appropriate file (`interfaces.ts`, `auth.interfaces.ts`, `workflow.interfaces.ts`)
2. Export it from `index.ts` if not already covered by wildcard re-export
