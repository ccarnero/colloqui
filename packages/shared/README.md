# @yoizen/shared

The single source of truth for cross-service types, interfaces, and constants in the Yoizen platform. This workspace package defines the contract between all services — from NATS messaging conventions to Temporal task queues to auth token shapes. Every service depends on this package to ensure type safety and consistency across the distributed system.

## What is @yoizen/shared?

This package contains:
- **Type Definitions** — Interfaces for events, workflows, adapters, auth, channels, webhooks
- **Constants** — NATS streams, Temporal task queues, Redis key prefixes, TTLs, default timeouts
- **Utilities** — `AdapterClient` for runtime adapter resolution, ID generation, async helpers
- **Schemas** — SQL DDL for workflow, adapter, and channel tables (consumed by tenant-service)

It is **not** published to npm; each service imports it as a workspace dependency via `file:../../packages/shared`.

## Installation

Add to your service's `package.json`:

```json
{
  "dependencies": {
    "@yoizen/shared": "file:../../packages/shared"
  }
}
```

Then `bun install`.

## Core Concepts

### Multi-Tenancy

All services in the platform are multi-tenant. The shared package defines:

- **Tenant Header**: `x-yoizen-tenant` (injected into all HTTP requests and NATS subjects)
- **Subject Prefixes**: NATS subjects encode tenant: `events.{tenantId}.workflow.started`
- **Database Isolation**: Per-tenant Postgres instances (each tenant gets their own database)

All shared types assume multi-tenancy; no single-tenant bypass exists.

### Temporal Task Queues

Temporal workflows dispatch activities to different task queues for independent scaling:

```
WORKFLOW_ORCHESTRATOR_TASK_QUEUE = "workflow-orchestrator"
  └─ Executes: jsFunction, serviceBusCall, channelSend, agentCall (local activities)
  
HTTP_ADAPTER_TASK_QUEUE = "http-adapter"
  └─ Executes: endpointCall, serviceCall (HTTP execution activities)
```

Services register workers on their designated task queue and process activities from that queue.

### Event-Driven Architecture

The platform uses NATS JetStream for event distribution:

```
NATS Streams:
  EVENTS          → events.> (all events)
  RESULTS         → results.> (workflow results)
  DLQ             → dlq.webhook (dead-letter events)
  TENANT_*        → Per-tenant streams (INGRESS, CALLBACK, etc.)

Consumers:
  event-processor → events.> (processes all events)
  audit-writer    → events.> (audits all events)
  metrics-writer  → events.metrics (metrics events)
  webhook-dispatcher → results.> (delivers webhooks)
```

## Types & Interfaces Reference

### HTTP Execution (`http-execution.interfaces.ts`)

Used by workflow-service and http-adapter for HTTP request/response handling.

**HttpEndpointRequest** — HTTP call with optional adapter config

```
{
  method: string              // GET, POST, PUT, DELETE, PATCH, etc.
  url: string                 // Target URL
  adapterId?: string          // Adapter ID for config resolution
  endpointId?: string         // Endpoint ID within adapter
  params?: Record<string, *>  // Query parameters
  data?: any                  // Request body (JSON or form)
  headers?: Record<string, string>  // Additional headers
  timeout?: number            // Timeout in milliseconds
  retries?: number            // Max retry attempts
}
```

**HttpExecutionResult** — HTTP response

```
{
  status: number              // HTTP status code
  body: string | object       // Response body (parsed if JSON)
  headers: Record<string, string>  // Response headers
  duration: number            // Execution duration (ms)
  retriesUsed: number         // Retries consumed
}
```

**HttpServiceRequest** — Internal service call

```
{
  service: string             // Service name (e.g., "audit-service")
  path: string                // Service path
  method: string              // HTTP method
  data?: any                  // Request body
  headers?: Record<string, string>
  adapterId?: string          // Optional adapter for service config
  timeout?: number            // Timeout override
}
```

**AgentChatRequest** — YoizenClaw agent execution

```
{
  agentId: string             // Agent identifier
  input: string               // Main input/prompt
  context?: Record<string, any>  // Additional context
  systemPrompt?: string       // Optional system prompt override
  timeout?: number            // Execution timeout (ms)
}
```

### Workflow (`workflow.interfaces.ts`)

Used by workflow-service for workflow definition and execution.

**WorkflowDefinition** — Complete workflow specification

```
{
  name: string                // Workflow name
  tenantId: string            // Owner tenant
  application: string         // Owning application
  request: Record<string, any>  // Initial request payload
  actions: WorkflowAction[]   // Action sequence
  timeout?: number            // Workflow timeout (ms)
  retryPolicy?: RetryPolicy   // Global retry strategy
}
```

**WorkflowAction** — Union of all action types

```
type WorkflowAction = 
  | EndpointCallAction
  | ServiceCallAction
  | AgentCallAction
  | JsFunctionAction
  | ServiceBusCallAction
  | ChannelSendAction
  | BranchAction
  | SleepAction
```

Each action has:
```
{
  type: string               // Action type identifier
  name: string               // Unique within workflow
  args: {                    // Type-specific arguments
    [key: string]: any
  }
  timeout?: number           // Override timeout
  retryPolicy?: RetryPolicy  // Override retry strategy
}
```

**EndpointCallAction** — HTTP request action

```
{
  type: "endpointCall"
  name: string
  args: {
    method: string
    url: string
    adapterId?: string
    endpointId?: string
    params?: Record<string, *>
    data?: any
    headers?: Record<string, string>
    timeout?: number
    retries?: number
  }
}
```

**AgentCallAction** — AI agent execution action (NEW)

```
{
  type: "agentCall"
  name: string
  args: {
    agentId: string
    input: string
    context?: Record<string, any>
    systemPrompt?: string
    timeout?: number
  }
}
```

**JsFunctionAction** — Inline JavaScript execution

```
{
  type: "jsFunction"
  name: string
  args: {
    code: string              // JavaScript code as string
    timeout?: number
  }
}
```

**ServiceBusCallAction** — NATS publish action

```
{
  type: "serviceBusCall"
  name: string
  args: {
    subject: string           // NATS subject
    payload: Record<string, any>  // Message payload
    headers?: Record<string, string>
  }
}
```

**BranchAction** — Parallel execution

```
{
  type: "branch"
  name: string
  args: {
    branches: WorkflowAction[][]  // Multiple action sequences
  }
}
```

**SleepAction** — Workflow pause

```
{
  type: "sleep"
  name: string
  args: {
    duration: number          // Milliseconds to sleep
  }
}
```

**WorkflowExecutionContext** — Runtime execution context

```
{
  workflow: {
    id: string
    tenantId: string
    name: string
    startTime: Date
  }
  request: Record<string, any>           // Original request
  results: {
    [actionName: string]: {
      status: "success" | "failure"
      data?: any
      error?: string
    }
  }
}
```

### Adapter (`adapter.interfaces.ts`)

Used by adapter-service, http-adapter, event-processor, webhook-service.

**AdapterConfig** — Full adapter configuration

```
{
  id: string                  // Unique adapter identifier
  tenantId: string            // Owner tenant
  name: string                // Display name
  baseUrl: string             // Base URL for all endpoints
  auth?: {
    type: "bearer" | "apiKey" | "oauth2" | "basic"
    credentials: Record<string, string>
  }
  headers?: Record<string, string>  // Default headers
  timeout?: number            // Default timeout (ms)
  retries?: number            // Default retry count
  endpoints: AdapterEndpointConfig[]
}
```

**AdapterEndpointConfig** — Endpoint within adapter

```
{
  id: string                  // Endpoint identifier
  label: string               // Display name
  method: string              // HTTP method
  path: string                // Endpoint path (relative to baseUrl)
  description?: string        // Optional documentation
}
```

**ResolvedAdapterRequest** — Resolved request ready for execution

```
{
  url: string                 // Full URL (baseUrl + path)
  method: string              // HTTP method
  headers: Record<string, string>  // Merged headers
  timeout: number             // Timeout (ms)
  retries: number             // Retry count
  auth?: {
    type: string
    token?: string            // OAuth2 access token
  }
}
```

**AdapterCache** — Cache interface for adapter config

```
interface AdapterCache {
  get(key: string): Promise<any>
  set(key: string, value: any, ttl?: number): Promise<void>
  del(key: string): Promise<void>
}
```

### Auth (`auth.interfaces.ts`, `auth.constants.ts`)

Used by auth-service, api-gateway, and other services.

**JwtPayload** — JWT claims

```
{
  sub: string                 // Subject (user ID or client ID)
  type: "user" | "client"     // Token type
  scope: TokenScope           // Scope: "platform" or "tenant:name"
  role?: "admin" | "operator" // User role (if type is "user")
  env: string                 // Environment (dev, staging, prod)
  iat: number                 // Issued at (seconds)
  exp: number                 // Expiration (seconds)
}
```

**TokenResponse** — OAuth2 token response

```
{
  access_token: string        // JWT
  token_type: string          // "Bearer"
  expires_in: number          // TTL (seconds)
  scope: string               // Granted scope
  refresh_token?: string      // Optional refresh token
}
```

**TokenScope** — Scope variant

```
type TokenScope = "platform" | `tenant:${string}`
```

**Auth Constants**

```
ACCESS_TOKEN_TTL = 3600              // 1 hour (seconds)
REFRESH_TOKEN_TTL = 86400 * 30       // 30 days (seconds)
PUBLIC_ROUTES_CACHE_KEY_PREFIX = "public:routes:"
PUBLIC_ROUTES_CACHE_TTL = 3600       // 1 hour (seconds)
```

### Event (`interfaces.ts`)

Used by gateway, event-processor, audit-service, metrics-service, webhook-service.

**EventEnvelope** — Event wrapper

```
{
  id: string                  // Unique event ID
  type: string                // Event type (e.g., "user.created")
  payload: any                // Event payload
  metadata?: EventMetadata    // Optional metadata
  callbackUrl?: string        // Optional webhook callback
  adapterId?: string          // Optional adapter for enrichment
  enrichAdapter?: string      // Adapter for enrichment pipeline
  forwardAdapter?: string     // Adapter for forwarding
}
```

**ProcessedEvent** — Event after processing

```
{
  ...envelope
  result: EventResult         // Processing result
  processedAt: Date           // Completion timestamp
  processingTime: number      // Duration (ms)
}
```

**CompletionEvent** — Event delivery notification

```
{
  eventId: string             // Original event ID
  type: string                // Original event type
  status: "success" | "failure"
  result: any                 // Processing result
  completedAt: Date           // Completion timestamp
  callbackUrl?: string        // Callback URL
  adapterId?: string          // Adapter used for enrichment
}
```

## Constants Reference

### Temporal Task Queues

```
WORKFLOW_ORCHESTRATOR_TASK_QUEUE = "workflow-orchestrator"
HTTP_ADAPTER_TASK_QUEUE = "http-adapter"
WORKFLOW_DEFAULT_TIMEOUT_MS = 86400000  // 24 hours
```

### NATS Streams

```
STREAM_NAME = "EVENTS"
STREAM_SUBJECTS = ["events.>"]
RESULTS_STREAM_NAME = "RESULTS"
RESULTS_STREAM_SUBJECTS = ["results.>"]
DLQ_STREAM_NAME = "DLQ"

// Per-tenant streams (created dynamically)
TENANT_INGRESS_STREAM = "INGRESS-{tenantId}"
TENANT_CALLBACK_STREAM = "CALLBACK-{tenantId}"
```

### Redis Keys & TTLs

```
RESULT_KEY_PREFIX = "result:"
PENDING_KEY_PREFIX = "pending:"
CALLBACK_KEY_PREFIX = "callback:"
RESULT_TTL = 3600                      // 1 hour (seconds)
RESULT_CACHE_MAX = 1024                // Max cached results
```

### Webhook Configuration

```
WEBHOOK_MAX_RETRIES = 3
WEBHOOK_RETRY_DELAYS = [1000, 5000, 30000]  // Milliseconds
WEBHOOK_DLQ_SUBJECT = "dlq.webhook"
```

### Multi-Tenancy

```
TENANT_HEADER = "x-yoizen-tenant"
```

## Runtime Utilities

### AdapterClient

Resolves adapter configurations from adapter-service with stale-while-revalidate caching.

**Usage Example**

```
import { AdapterClient } from "@yoizen/shared"
import Redis from "ioredis"

const redis = new Redis({ host: "localhost", port: 6379 })
const adapterClient = new AdapterClient(
  "http://adapter-service:3000",
  redis
)

// Resolve adapter config
const config = await adapterClient.getAdapterConfig(tenantId, adapterId)
// → {
//     id: "crm-adapter",
//     baseUrl: "https://crm.example.com/api",
//     auth: { type: "oauth2", ... },
//     endpoints: [...]
//   }

// Resolve a specific endpoint request
const resolved = await adapterClient.resolveRequest(
  tenantId,
  adapterId,
  endpointId,
  { params: { id: "123" } }
)
// → {
//     url: "https://crm.example.com/api/customers/123",
//     method: "GET",
//     headers: { "Authorization": "Bearer <token>", ... },
//     timeout: 30000,
//     retries: 3
//   }
```

**Caching Strategy**

- **TTL**: 300 seconds (adapter configs cached for 5 minutes)
- **Stale window**: 60 seconds (serve stale data while refreshing in background)
- **Cache keys**: `adapter:{tenantId}:{adapterId}`, `endpoint:{tenantId}:{adapterId}:{endpointId}`

### ID Generation

```
import { nanoid, ulid, uuid } from "@yoizen/shared"

const id1 = nanoid()      // "V1StGXR_Z5j3eK9Z"
const id2 = ulid()        // "01ARZ3NDEKTSV4RRFFQ69G5FAV"
const id3 = uuid()        // "550e8400-e29b-41d4-a716-446655440000"
```

### Async Utilities

```
import { sleep } from "@yoizen/shared"

// Pause for 5 seconds
await sleep(5000)
```

## Database Schemas

The package exports SQL DDL for workflow, adapter, and channel tables. These are consumed by tenant-service during tenant provisioning:

### Workflow Schema

```sql
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  application TEXT,
  definition JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL,
  status TEXT,
  result JSONB,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
```

Available as:
```
import { WORKFLOW_SCHEMA_SQL } from "@yoizen/shared"
```

### Adapter Schema

```sql
CREATE TABLE IF NOT EXISTS adapters (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Available as:
```
import { ADAPTER_SCHEMA_SQL } from "@yoizen/shared"
```

## Common Import Patterns

### In workflow-service

```typescript
import {
  WORKFLOW_ORCHESTRATOR_TASK_QUEUE,
  HTTP_ADAPTER_TASK_QUEUE,
  WorkflowDefinition,
  WorkflowAction,
  TENANT_HEADER,
  AdapterClient
} from "@yoizen/shared"
```

### In http-adapter

```typescript
import {
  HTTP_ADAPTER_TASK_QUEUE,
  HttpEndpointRequest,
  HttpExecutionResult,
  HttpServiceRequest,
  TENANT_HEADER,
  AdapterClient,
  DEFAULT_ADAPTER_SERVICE_URL
} from "@yoizen/shared"
```

### In event-processor

```typescript
import {
  STREAM_NAME,
  CONSUMER_NAME,
  EventEnvelope,
  ProcessedEvent,
  CompletionEvent,
  TENANT_HEADER,
  AdapterClient
} from "@yoizen/shared"
```

### In adapter-service

```typescript
import {
  AdapterConfig,
  AdapterEndpointConfig,
  ResolvedAdapterRequest,
  TENANT_HEADER,
  ADAPTER_SCHEMA_SQL
} from "@yoizen/shared"
```

## Adding New Types

When adding new shared types:

1. Create or update the appropriate file (`interfaces.ts`, `constants.ts`, etc.)
2. Ensure the type/constant is exported from `src/index.ts`
3. Add JSDoc comments if the meaning is non-obvious
4. Update this README with usage examples
5. Notify all consuming services that a new contract exists

## Versioning & Stability

This package is **private** and **not versioned**. It follows the main repository's version. All breaking changes require:

1. Coordination across all consuming services
2. Careful testing to ensure no service breaks
3. Documentation of the change in this README

## Dependencies

The package has minimal external dependencies:

```json
{
  "dependencies": {},
  "optionalPeerDependencies": {
    "ioredis": "^5.0.0"  // Required only for AdapterClient
  }
}
```

`ioredis` is optional; only services using `AdapterClient` need to install it.

## Further Reading

- [AGENTS.md](AGENTS.md) — Detailed package inventory and usage by service
- [HTTP Adapter README](../services/http-adapter/README.md) — HTTP execution engine
- [Workflow Service README](../services/workflow-service/README.md) — Workflow orchestration
- [Architecture Overview](../DOCS/01-ARCHITECTURE.md) — System-wide design
