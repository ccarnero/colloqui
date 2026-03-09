# Event-Driven Architecture on Kubernetes

Serverless event-driven architecture running on Minikube with Knative Serving, NATS JetStream, and Redis. Supports multi-environment deployment (dev, qa, staging, production) with per-environment isolation and tenant namespace management.

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│  Minikube Cluster (6 CPU, 16GB RAM, Docker driver)                    │
│                                                                       │
│  ┌─── knative-serving ─────────────────────────────────────────────┐  │
│  │  Kourier Ingress  ·  KPA Autoscaler  ·  sslip.io DNS           │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─── Per Environment (x4: dev, qa, staging, production) ──────────┐  │
│  │                                                                 │  │
│  │  ┌─ platform-services-{env} (Knative Services) ──────────────┐  │  │
│  │  │  api-gateway · event-processor · audit-service             │  │  │
│  │  │  cache-service · webhook-service · metrics-service         │  │  │
│  │  │  tenant-service                                            │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌─ support-services-{env} (StatefulSets / Deployments) ─────┐  │  │
│  │  │  NATS JetStream · Redis 7 · PostgreSQL 17                  │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

### Environments

Each environment gets a fully isolated stack with its own infrastructure and platform services:

| Environment | Support Namespace | Platform Namespace |
|-------------|-------------------|--------------------|
| dev | `support-services-dev` | `platform-services-dev` |
| qa | `support-services-qa` | `platform-services-qa` |
| staging | `support-services-staging` | `platform-services-staging` |
| production | `support-services-production` | `platform-services-production` |

You can also deploy a single environment for lighter local development:

```bash
kubectl apply -k infrastructure/overlays/local/dev
kubectl apply -k knative/services/overlays/local/dev
```

### Components

| Component | Type | Description |
|---|---|---|
| **API Gateway** | Knative Service | HTTP entry point with input validation, SSE streaming, audit proxy, tenant proxy. Publishes events to NATS, queries Redis for results |
| **Event Processor** | Knative Service | Subscribes to NATS JetStream, runs events through an enrichment pipeline, routes to a pluggable handler registry, writes results to Redis, publishes completion events |
| **Audit Service** | Knative Service | Independent NATS consumer that persists every event to PostgreSQL. Exposes paginated query API |
| **Metrics Service** | Knative Service | Consumes `events.metrics` from NATS and stores metrics in PostgreSQL |
| **Webhook Service** | Knative Service | Consumes completion events from the RESULTS stream. Delivers HTTP callbacks to registered URLs with exponential backoff retry (3 attempts). Failed deliveries go to DLQ |
| **Cache Service** | Knative Service | CRUD API with L1 in-memory + L2 Redis cache-aside pattern |
| **Tenant Service** | Knative Service | Environment-scoped tenant namespace management via `@kubernetes/client-node`. Each instance creates `<tenant>-<env>-ns` for its own environment only |
| **NATS JetStream** | StatefulSet | Persistent event streaming backbone with 7-day retention and limits-based policy. Two streams: `EVENTS` (ingested events) and `RESULTS` (completion events) |
| **Redis** | Deployment | Pure cache (no persistence, LRU eviction) |
| **PostgreSQL** | StatefulSet | Persistent audit and metrics store with 2Gi PVC |

### Event Flow

1. Client sends `POST /events` to API Gateway (optionally with `callbackUrl` for webhook delivery)
2. Gateway validates the payload (`type` must be alphanumeric, max 128 chars; `payload` must be a non-empty object; `callbackUrl` is optional valid URL)
3. Gateway publishes to NATS stream `EVENTS` on subject `events.<type>` (callback URL is embedded in the envelope)
4. If `callbackUrl` is provided, it is also stored in Redis under `callback:<eventId>`
5. Gateway returns `202 Accepted` with event ID
6. Event Processor consumes from durable consumer `event-processor`, runs the event through the enrichment pipeline (validation, enrichment, transform), resolves a handler via the handler registry, processes the event, and writes the enriched result to Redis
7. Event Processor publishes a completion event to the `RESULTS` stream on subject `results.<type>` containing the result and callback URL
8. Audit Service independently consumes from durable consumer `audit-writer` on the `EVENTS` stream, persisting every event to PostgreSQL
9. Webhook Service consumes completion events from durable consumer `webhook-dispatcher` on the `RESULTS` stream. If a callback URL is present, it POSTs the result to that URL with exponential backoff retry (1s, 5s, 30s). Failed deliveries after 3 attempts are published to `results.webhook-dlq`
10. Client polls `GET /results/:id` to retrieve the processed result, or receives it via webhook callback
11. Client can also connect to `GET /events/stream?types=created,updated` for real-time SSE streaming of events
12. Client queries `GET /audit/events?type=...&from=...&to=...` through the API Gateway for historical event data

### Handler Registry

The Event Processor uses a pluggable handler pattern instead of hardcoded event logic. Each event type maps to a dedicated handler class discovered automatically at startup via NestJS `DiscoveryService`.

| Handler | Event Type | Behavior |
|---|---|---|
| `CreatedHandler` | `created` | Marks event as processed |
| `UpdatedHandler` | `updated` | Marks event as processed |
| `DeletedHandler` | `deleted` | Marks event as processed |
| `DefaultHandler` | *(fallback)* | Processes if payload has content |

To add a new event type, create a handler class decorated with `@EventType('my-type')` and register it in the `ProcessorModule` -- the registry picks it up automatically.

```typescript
import { Injectable } from '@nestjs/common';
import type { EventResult } from '@yoizen/shared';
import { EventType } from '../../handlers/event-type.decorator';
import type { EventHandler } from '../../handlers/event-handler.interface';

@Injectable()
@EventType('my-type')
export class MyTypeHandler implements EventHandler {
  readonly eventType = 'my-type';

  async handle(eventId: string, payload: unknown): Promise<EventResult> {
    // your business logic here
    return { processed: true, data: { eventId } };
  }
}
```

### Enrichment Pipeline

Before reaching the handler, every event passes through a middleware-style enrichment pipeline. Stages are sorted by `order` at startup and executed sequentially. The pipeline is extensible -- add new stages by implementing the `PipelineStage` interface.

| Stage | Order | Behavior |
|---|---|---|
| `ValidationStage` | 10 | Validates payload against a registered JSON schema (ajv). No schema = pass-through. Rejects invalid payloads with a descriptive error |
| `EnrichmentStage` | 20 | Attaches `metadata.receivedAt` (timestamp), `metadata.correlationId` (from NATS headers or auto-generated UUID), and `metadata.source` (NATS subject) |
| `TransformStage` | 30 | Runs registered payload transformers in sequence. Starts as pass-through; plug in custom `PayloadTransformer` functions at runtime |

The pipeline context carries the NATS message subject and optional correlation ID from headers, making enrichment transparent to handlers.

To register a JSON schema for payload validation:

```typescript
import { ValidationStage } from '../../pipeline';

// In a module's onModuleInit or a custom provider
validationStage.registerSchema('my-type', {
  type: 'object',
  properties: {
    name: { type: 'string' },
    count: { type: 'number' },
  },
  required: ['name'],
});
```

To add a custom payload transformer:

```typescript
import { TransformStage } from '../../pipeline';

transformStage.registerTransformer((payload) => {
  // trim all string values
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    result[key] = typeof value === 'string' ? value.trim() : value;
  }
  return result;
});
```

### Audit Service

The Audit Service provides a persistent event store and historical query API. It runs as an independent NATS consumer (`audit-writer`) alongside the Event Processor, demonstrating multi-consumer fan-out on a single JetStream stream.

Audit endpoints are exposed through the **API Gateway** (which proxies to the audit service internally), so clients use a single entry point:

| Endpoint (via API Gateway) | Description |
|---|---|
| `GET /audit/events?type=...&from=...&to=...&limit=...&offset=...` | Paginated event query with optional filters |
| `GET /audit/events/:id` | Single event lookup by ID |

Events are stored in PostgreSQL with JSONB columns for payload and metadata, indexed by type and timestamp for efficient querying. The consumer uses `ON CONFLICT DO NOTHING` for idempotent writes.

### Webhook / Callback Support

The platform supports asynchronous webhook delivery for event results. When a client includes a `callbackUrl` in the event payload, the Webhook Service automatically delivers the processed result to that URL.

| Setting | Value | Purpose |
|---|---|---|
| Max retries | 3 | Total delivery attempts before DLQ |
| Retry delays | 1s, 5s, 30s | Exponential backoff between attempts |
| Timeout | 10s | Per-request timeout for callback delivery |
| DLQ subject | `results.webhook-dlq` | Failed deliveries after all retries |

```bash
# Publish an event with callback URL
curl -X POST http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/events \
  -H "Content-Type: application/json" \
  -d '{"type":"created","payload":{"name":"test"},"callbackUrl":"https://example.com/webhook"}'
```

The Webhook Service consumes from the `RESULTS` stream (separate from the `EVENTS` stream) via durable consumer `webhook-dispatcher`, so it operates independently from event processing and audit logging.

### Tenant Management (Third-Level Isolation)

The Tenant Service provides namespace-level isolation for tenants. Each environment runs its own tenant-service instance scoped by the `PLATFORM_ENVIRONMENT` env var. Creating a tenant through a given environment's API gateway provisions only that environment's tenant namespace (`<tenant>-<env>-ns`).

| Endpoint (via API Gateway) | Description |
|---|---|
| `POST /tenants` `{"name":"acme"}` | Create tenant namespace in this environment |
| `GET /tenants` | List tenants in this environment |
| `GET /tenants/:name` | Get tenant detail (namespace status) |
| `DELETE /tenants/:name` | Delete tenant namespace in this environment |

Tenant namespaces are labeled for discoverability:

| Label | Value |
|---|---|
| `yoizen.io/tenant` | `<tenant-name>` |
| `yoizen.io/environment` | `dev` / `qa` / `staging` / `production` |
| `yoizen.io/managed-by` | `tenant-service` |
| `app.kubernetes.io/part-of` | `yoizen-arch` |

The tenant-service uses `@kubernetes/client-node` with in-cluster authentication (ServiceAccount + ClusterRole for namespace CRUD). Each environment's ServiceAccount has its own ClusterRoleBinding.

### SSE Real-Time Streaming

The API Gateway exposes a Server-Sent Events endpoint for real-time event streaming. Clients can subscribe to specific event types or all events.

```bash
# Stream all events (dev environment)
curl -N http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/events/stream

# Stream only specific types
curl -N "http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/events/stream?types=created,updated"
```

The SSE endpoint subscribes to core NATS subjects directly (not JetStream consumers) for minimal latency. Each client connection creates its own NATS subscriptions, which are cleaned up on disconnect.

### NATS JetStream Retention

Both the `EVENTS` and `RESULTS` streams are configured with a limits-based retention policy:

| Stream | Subjects | Purpose |
|---|---|---|
| `EVENTS` | `events.>` | Ingested events from the API Gateway |
| `RESULTS` | `results.>` | Completion events published by the Event Processor |

| Setting | Value | Purpose |
|---|---|---|
| `retention` | `Limits` | Evict oldest messages when limits are reached |
| `max_age` | 7 days | Automatic expiry of old messages |
| `max_bytes` | 1 GB | Cap total stream storage |
| `max_deliver` | 5 | Messages that fail 5 times are dropped (DLQ candidate) |

The two-stream design avoids feedback loops (the Event Processor consuming its own results) while enabling independent fan-out. The `EVENTS` stream feeds event-processor and audit-writer consumers; the `RESULTS` stream feeds the webhook-dispatcher consumer.

### Shared Types Package

The `packages/shared/` package (`@yoizen/shared`) contains all cross-service types and constants:

- **Interfaces**: `EventEnvelope`, `EventResult`, `ProcessedEvent`, `EventMetadata`, `CompletionEvent`
- **Constants**: stream names (EVENTS, RESULTS), subject prefixes, consumer names, Redis key prefixes, TTL values, webhook retry config

All services (`api-gateway`, `event-processor`, `audit-service`, `webhook-service`) depend on this package to keep contracts in sync.

### Input Validation

The API Gateway validates all incoming event payloads at the HTTP boundary using `class-validator`:

| Field | Rules |
|---|---|
| `type` | Required string, max 128 chars, alphanumeric + `.`, `-`, `_` only |
| `payload` | Required non-empty object |
| `callbackUrl` | Optional valid URL (for webhook delivery of the processed result) |

Invalid requests are rejected with `400 Bad Request` and a descriptive error before reaching NATS.

## Prerequisites

- [minikube](https://minikube.sigs.k8s.io/docs/start/) >= 1.32
- [kubectl](https://kubernetes.io/docs/tasks/tools/) >= 1.28
- [Docker](https://docs.docker.com/get-docker/) (minikube driver)

## Quick Start

```bash
./bootstrap.sh
```

This script will:
1. Start minikube with profile `yoizen-arch` (6 CPUs, 16GB RAM)
2. Enable `metrics-server` addon
3. Install Knative Serving + Kourier networking layer
4. Deploy NATS JetStream, Redis, and PostgreSQL to all 4 `support-services-{env}` namespaces via Kustomize
5. Build service Docker images inside minikube
6. Deploy Knative Services to all 4 `platform-services-{env}` namespaces

## Project Structure

```
Arch/
├── bootstrap.sh                 # One-command setup
├── scripts/
│   └── smoke-test.sh            # E2E smoke tests against minikube
├── packages/
│   └── shared/                  # @yoizen/shared — cross-service types and constants
│       └── src/
│           ├── constants.ts     # Stream names, key prefixes, TTLs, retention config
│           ├── interfaces.ts    # EventEnvelope, EventResult, ProcessedEvent
│           └── index.ts         # Barrel export
├── infrastructure/
│   ├── base/                    # Kustomize base manifests (no hardcoded namespace)
│   │   ├── nats/                # NATS JetStream StatefulSet
│   │   ├── redis/               # Redis Deployment
│   │   └── postgres/            # PostgreSQL StatefulSet (audit store)
│   └── overlays/
│       └── local/               # Per-environment overlays
│           ├── namespaces.yaml  # All 8 namespace definitions
│           ├── local-base/      # Shared patches (resource limits)
│           ├── dev/             # namespace: support-services-dev
│           ├── qa/              # namespace: support-services-qa
│           ├── staging/         # namespace: support-services-staging
│           └── production/      # namespace: support-services-production
├── knative/
│   ├── serving/                 # Autoscaler ConfigMap
│   └── services/
│       ├── base/                # Service YAMLs (no hardcoded namespace)
│       ├── rbac/                # ClusterRole + per-env ClusterRoleBindings
│       └── overlays/
│           └── local/           # Per-environment overlays
│               ├── dev/         # namespace: platform-services-dev + env patches
│               ├── qa/          # namespace: platform-services-qa + env patches
│               ├── staging/     # namespace: platform-services-staging + env patches
│               └── production/  # namespace: platform-services-production + env patches
├── services/                    # Application source code
│   ├── api-gateway/             # NestJS + Fastify + Bun
│   │   └── src/modules/
│   │       ├── events/          # Event ingestion + SSE streaming
│   │       ├── audit/           # Audit proxy to audit-service
│   │       ├── tenants/         # Tenant proxy to tenant-service
│   │       └── health/          # Aggregated health check
│   ├── tenant-service/          # NestJS + Fastify + Bun + @kubernetes/client-node
│   │   └── src/modules/
│   │       ├── tenants/         # Environment-scoped namespace CRUD
│   │       └── health/          # K8s API connectivity check
│   ├── event-processor/         # NestJS + Fastify + Bun
│   │   └── src/
│   │       ├── handlers/        # Pluggable event handler registry
│   │       │   ├── event-handler.interface.ts
│   │       │   ├── event-type.decorator.ts
│   │       │   ├── handler-registry.ts
│   │       │   ├── created.handler.ts
│   │       │   ├── updated.handler.ts
│   │       │   ├── deleted.handler.ts
│   │       │   └── default.handler.ts
│   │       ├── pipeline/        # Enrichment pipeline (validation → enrichment → transform)
│   │       │   ├── pipeline-stage.interface.ts
│   │       │   ├── validation.stage.ts
│   │       │   ├── enrichment.stage.ts
│   │       │   ├── transform.stage.ts
│   │       │   ├── pipeline-runner.ts
│   │       │   └── pipeline.module.ts
│   │       └── modules/processor/
│   │           └── processor.service.ts
│   ├── audit-service/           # NestJS + Fastify + Bun
│   │   └── src/
│   │       ├── providers/       # NATS + PostgreSQL providers
│   │       │   ├── nats.provider.ts
│   │       │   └── postgres.provider.ts
│   │       └── modules/
│   │           ├── audit/       # NATS consumer + query API
│   │           │   ├── audit.service.ts
│   │           │   └── audit.controller.ts
│   │           └── health/
│   ├── webhook-service/         # NestJS + Fastify + Bun
│   │   └── src/
│   │       ├── providers/       # NATS provider (RESULTS stream consumer + publisher)
│   │       │   └── nats.provider.ts
│   │       └── modules/
│   │           ├── webhook/     # NATS consumer + HTTP callback dispatcher
│   │           │   ├── webhook.service.ts
│   │           │   └── webhook.module.ts
│   │           └── health/
│   └── cache-service/           # NestJS + Fastify + Bun
└── tests/
    └── e2e/                     # Cross-service end-to-end tests
```

## Manual Operations

### Apply infrastructure only

```bash
# All environments
kubectl apply -k infrastructure/overlays/local

# Single environment
kubectl apply -k infrastructure/overlays/local/dev
```

### Apply Knative services only

```bash
# All environments
kubectl apply -k knative/serving
kubectl apply -k knative/services/overlays/local

# Single environment
kubectl apply -k knative/serving
kubectl apply -k knative/services/overlays/local/dev
```

### Build images inside minikube

```bash
eval $(minikube docker-env -p yoizen-arch)
for svc in api-gateway event-processor cache-service audit-service webhook-service metrics-service tenant-service; do
  docker build -t "dev.local/${svc}:local" -f "services/${svc}/Dockerfile" .
done
```

### Check service status

```bash
# All environments
kubectl get ksvc --all-namespaces -l app.kubernetes.io/part-of=yoizen-arch

# Specific environment
kubectl get ksvc -n platform-services-dev
kubectl get pods -n platform-services-dev
kubectl get pods -n support-services-dev
```

### Access services

Start the minikube tunnel (required for Kourier LoadBalancer):

```bash
minikube tunnel -p yoizen-arch
```

Then use the Knative service URLs (replace `<ENV>` with `dev`, `qa`, `staging`, or `production`):

```bash
# Publish an event (dev environment)
curl -X POST http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/events \
  -H "Content-Type: application/json" \
  -d '{"type":"created","payload":{"name":"test"}}'

# Publish an event with webhook callback
curl -X POST http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/events \
  -H "Content-Type: application/json" \
  -d '{"type":"created","payload":{"name":"test"},"callbackUrl":"https://example.com/webhook"}'

# Get result
curl http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/results/<EVENT_ID>

# Stream events in real-time (SSE)
curl -N http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/events/stream

# Query audit log
curl "http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/audit/events?type=created&limit=10"

# Cache operations
curl http://cache-service.platform-services-dev.<MINIKUBE_IP>.sslip.io/cache/mykey
curl -X PUT http://cache-service.platform-services-dev.<MINIKUBE_IP>.sslip.io/cache/mykey \
  -H "Content-Type: application/json" \
  -d '{"value":{"data":"hello"},"ttl":300}'

# Create a tenant (only creates namespace in the targeted environment)
curl -X POST http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/tenants \
  -H "Content-Type: application/json" \
  -d '{"name":"acme"}'
# Creates: acme-dev-ns

# List tenants in this environment
curl http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/tenants

# Get tenant detail
curl http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/tenants/acme

# Delete tenant (removes namespace in this environment only)
curl -X DELETE http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/tenants/acme
```

### Local development (without K8s)

Each service can run standalone with local NATS and Redis:

```bash
# Start NATS, Redis, and PostgreSQL locally (Docker)
docker run -d --name nats -p 4222:4222 nats:2.10-alpine --jetstream
docker run -d --name redis -p 6379:6379 redis:7-alpine
docker run -d --name postgres -p 5432:5432 \
  -e POSTGRES_DB=yoizen -e POSTGRES_USER=yoizen -e POSTGRES_PASSWORD=yoizen-dev-password \
  postgres:17-alpine

# Run a service
cd services/api-gateway
bun install
bun run start:dev
```

## Testing

### Unit tests (per service)

Each service has unit tests with mocked dependencies under `services/<service>/test/unit/`:

```bash
cd services/api-gateway && bun test:unit
cd services/event-processor && bun test:unit
cd services/cache-service && bun test:unit
cd services/audit-service && bun test:unit
cd services/webhook-service && bun test:unit
```

### Integration tests (per service)

Per-service integration tests that require local NATS and/or Redis under `services/<service>/test/integration/`:

```bash
cd services/api-gateway && bun test:integration
cd services/event-processor && bun test:integration
cd services/cache-service && bun test:integration
cd services/audit-service && bun test:integration
cd services/webhook-service && bun test:integration
```

### E2E tests (full flow)

Cross-service end-to-end tests that validate the complete event pipeline live under `tests/e2e/`:

| Test file | What it covers |
|---|---|
| `flow.e2e.spec.ts` | POST event -> NATS -> Event Processor -> Redis -> GET result |
| `cache.e2e.spec.ts` | Cache Service CRUD, batch get, TTL expiration |
| `health.e2e.spec.ts` | Health endpoints across all three services |

**Run against the minikube cluster** (sets up port-forwards automatically):

```bash
./scripts/smoke-test.sh
```

**Run against local services** (assumes services running on ports 3000-3002):

```bash
cd tests/e2e
bun install
API_GATEWAY_URL=http://localhost:3000 \
EVENT_PROCESSOR_URL=http://localhost:3001 \
CACHE_SERVICE_URL=http://localhost:3002 \
bun test
```

**Run a specific test suite**:

```bash
./scripts/smoke-test.sh flow.e2e.spec.ts
```

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Networking layer | Kourier | ~10x less resources than Istio, sufficient for local/dev |
| Event transport | NATS JetStream (direct) | Lower latency than Knative Eventing abstraction, full control over streams/consumers |
| Event processing | Pluggable handler registry | New event types are added by creating a handler class -- no core changes needed |
| Enrichment pipeline | Ordered stages (ajv + metadata + transform) | Separates cross-cutting concerns from handler logic; stages are sorted once at startup for O(n) per-message cost |
| Audit persistence | PostgreSQL + postgres.js | Append-only writes + simple reads; raw SQL driver avoids ORM overhead |
| Multi-consumer fan-out | Independent durable consumers | Audit and processing consume the same stream independently at their own pace |
| Two-stream design | EVENTS + RESULTS | Separates ingested events from completion events, preventing feedback loops in the event-processor |
| Webhook retry | Exponential backoff (1s/5s/30s) | Balances retry urgency with target service recovery time; DLQ for permanent failures |
| SSE streaming | Core NATS subscriptions | Minimal latency for real-time push; per-client subscription lifecycle |
| Stream retention | Limits (7-day, 1GB) | Enables replay for new consumers while bounding resource usage |
| Input validation | class-validator at gateway | Rejects malformed payloads at the HTTP boundary before they reach NATS |
| Shared types | `@yoizen/shared` package | Single source of truth for cross-service interfaces and constants |
| Redis cache mode | No persistence, LRU | Pure cache behavior, no disk I/O overhead |
| HTTP framework | Fastify | 2-3x faster than Express for NestJS |
| Cache client | ioredis | Better pipelining, cluster support, and benchmark performance vs `redis` package |
| IaC format | Kustomize (base + per-env overlays) | Native to kubectl, zero external dependencies; namespace transformer avoids duplicating manifests |
| Multi-environment | 4 isolated env pairs (dev/qa/staging/production) | Each env gets its own NATS, Redis, Postgres, and full platform service stack |
| Tenant isolation | Environment-scoped via `PLATFORM_ENVIRONMENT` | Each tenant-service instance only manages namespaces for its own env, preventing cross-env leakage |
| NATS deployment | StatefulSet | Stable pod identity + PVCs for JetStream durability |
| PostgreSQL deployment | StatefulSet | Stable pod identity + PVC for durable audit data |

## Tech Stack

- **Runtime**: Bun 1.3
- **Framework**: NestJS 11 + Fastify
- **Language**: TypeScript 5 (strict mode)
- **Messaging**: NATS 2.10 + JetStream
- **Caching**: Redis 7 + ioredis
- **Database**: PostgreSQL 17 + postgres.js
- **Validation**: class-validator + class-transformer, ajv (pipeline payload schemas)
- **K8s Client**: @kubernetes/client-node (Tenant Service)
- **Orchestration**: Kubernetes (Minikube)
- **Serverless**: Knative Serving + Kourier
- **IaC**: Kustomize (base + per-environment overlays)
