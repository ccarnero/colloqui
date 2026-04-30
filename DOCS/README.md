# Platform Cluster

Serverless event-driven architecture running on Kubernetes (Minikube or OrbStack) with Knative Serving, NATS JetStream, Redis, PostgreSQL, and Temporal. Supports multi-environment deployment (dev, qa, staging, production) with per-environment isolation, multi-tenant namespace management with dedicated PostgreSQL per tenant, JWT authentication, dynamic service routing, workflow orchestration, job scheduling, and canary deployments.

## Architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster (Minikube or OrbStack)                            │
│                                                                       │
│  ┌─── knative-serving ─────────────────────────────────────────────┐  │
│  │  Kourier Ingress  ·  KPA Autoscaler  ·  sslip.io DNS           │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─── Per Environment (x4: dev, qa, staging, production) ──────────┐  │
│  │                                                                 │  │
│  │  ┌─ platform-services-{env} (Knative Services) ──────────────┐  │  │
│  │  │  api-gateway · auth-service · event-processor              │  │  │
│  │  │  audit-service · cache-service · webhook-service           │  │  │
│  │  │  metrics-service · tenant-service · scheduler-service      │  │  │
│  │  │  registry-service · workflow-api · workflow-worker          │  │  │
│  │  │  workflow-http-worker · adapter-service                    │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌─ support-services-{env} (StatefulSets / Deployments) ─────┐  │  │
│  │  │  NATS JetStream · Redis 7 · PostgreSQL 17 · Temporal       │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌─ {tenant}-{env}-ns (Per-Tenant Namespaces) ───────────────┐  │  │
│  │  │  PostgreSQL StatefulSet (dedicated per tenant)              │  │  │
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
# Minikube
kubectl apply -k infrastructure/overlays/local/dev
kubectl apply -k knative/services/overlays/local/dev

# OrbStack
kubectl apply -k infrastructure/overlays/orbstack/dev
kubectl apply -k knative/services/overlays/local/dev
```

### Components

| Component | Type | Description |
|---|---|---|
| **API Gateway** | Knative Service | HTTP entry point with JWT auth, input validation, SSE streaming, dynamic tenant routing, proxies to all downstream services |
| **Auth Service** | Knative Service | JWT token generation (client credentials + user login), user/client management, dynamic public routes, Redis-synced route cache |
| **Event Processor** | Knative Service | Subscribes to NATS JetStream, runs events through an enrichment pipeline (including adapter enrichment and forwarding stages), routes to a pluggable handler registry, writes results to Redis, publishes completion events |
| **Audit Service** | Knative Service | Independent NATS consumer that persists every event to per-tenant PostgreSQL. Exposes paginated query API |
| **Metrics Service** | Knative Service | Consumes `events.metrics` from NATS and stores metrics in per-tenant PostgreSQL |
| **Webhook Service** | Knative Service | Consumes completion events from RESULTS stream. Delivers HTTP callbacks with exponential backoff retry. When `adapterId` is present, uses adapter config for auth, headers, retries, and timeouts. Failed deliveries go to DLQ |
| **Cache Service** | Knative Service | CRUD API with L1 in-memory + L2 Redis cache-aside pattern |
| **Tenant Service** | Knative Service | Environment-scoped tenant namespace management. Provisions dedicated PostgreSQL StatefulSet per tenant |
| **Scheduler Service** | Knative Service | Multi-tenant job scheduling (cron, interval, one-time) with inline JS and Kubernetes Job executors |
| **Registry Service** | Knative Service | Knative-based service registry with route management, canary deployments, and traffic splitting |
| **Workflow API** | Knative Service | REST API for Temporal workflow management (start, status, list) |
| **Workflow Worker** | Knative Service | Temporal orchestrator worker executing JS functions and NATS service bus activities |
| **Adapter Service** | Knative Service | Manages multi-tenant HTTP adapter configurations (base URL, auth, headers, timeouts, retries) and their endpoints. Consumed via `AdapterClient` by workflow-http-worker, event-processor, and webhook-service |
| **Workflow HTTP Worker** | Knative Service | Temporal HTTP activity worker executing endpoint calls via `tracedFetch`; supports adapter-driven config resolution (auth, headers, retries, timeouts) |
| **NATS JetStream** | StatefulSet | Persistent event streaming backbone with 7-day retention. Streams: EVENTS, RESULTS, DLQ |
| **Redis** | Deployment | Pure cache (no persistence, LRU eviction) |
| **PostgreSQL** | StatefulSet | Shared database for auth, registry, and adapter services |
| **Temporal** | Deployment | Workflow execution engine with PostgreSQL backend and Web UI |

### Event Flow

1. Client sends `POST /events` to API Gateway with JWT Bearer token
2. Gateway authenticates the request, resolves tenant, validates the payload
3. Gateway publishes to NATS stream `EVENTS` on subject `events.<type>` (callback URL embedded in envelope)
4. If `callbackUrl` is provided, it is also stored in Redis under `callback:<eventId>`
5. Gateway returns `202 Accepted` with event ID
6. Event Processor consumes from durable consumer `event-processor`, runs the event through the enrichment pipeline, resolves a handler, processes the event, and writes the result to Redis
    - If `enrichAdapter` is present, the `AdapterEnrichmentStage` fetches data from the adapter endpoint and merges it into `payload._enriched`
    - If `forwardAdapter` is present, the `AdapterForwardStage` POSTs the payload to the adapter endpoint with exponential backoff retry
7. Event Processor publishes a completion event to the `RESULTS` stream (includes `adapterId` if present on the original envelope)
8. Audit Service independently consumes from `audit-writer` on EVENTS, persisting to per-tenant PostgreSQL
9. Metrics Service independently consumes `events.metrics`, persisting to per-tenant PostgreSQL
10. Webhook Service consumes from `webhook-dispatcher` on RESULTS. If a callback URL is present, it POSTs the result with exponential backoff retry. If `adapterId` is present, adapter config overrides default headers, auth, retry, and timeout settings
11. Client polls `GET /results/:id` or receives the result via webhook or SSE

### Authentication & Authorization

All API Gateway routes require JWT authentication unless marked as public. The platform supports two identity sources:

| Source | Grant | Token Scope |
|--------|-------|-------------|
| Platform User (email + password) | `POST /auth/login` | `platform` |
| API Client (client_id + client_secret) | `POST /auth/token` | `platform` or `tenant:<name>` |

Platform tokens grant full access. Tenant-scoped tokens are restricted to operations for that specific tenant. Dynamic public routes can be configured via `POST /auth/public-routes` and are synced to Redis with 30s in-memory cache in the gateway.

### Dynamic Routing

The API Gateway supports dynamic routing for tenant-registered services. Tenants register Knative services via the Registry Service and define route prefixes. The gateway polls `GET /routes` every 15 seconds, caching routes in a `Map<string, RouteEntry[]>` sorted by longest prefix. Non-platform requests are matched against this cache and proxied to the tenant's Knative service endpoint.

### Workflow Orchestration

Temporal-based workflow orchestration supports four action types:

| Action | Execution | Description |
|--------|-----------|-------------|
| `endpointCall` | Remote (workflow-http-worker) | HTTP request via `tracedFetch`; supports adapter-driven config resolution via `adapterId`/`endpointId` |
| `jsFunction` | Local (workflow-worker) | Inline JS evaluation |
| `serviceBusCall` | Local (workflow-worker) | NATS publish with tenant header |
| `branch` | Workflow-level | Parallel execution of sub-action branches |

Actions support `{{path.to.value}}` template resolution against the workflow execution context.

### Job Scheduling

The Scheduler Service provides multi-tenant job scheduling:

| Type | Expression | Example |
|------|-----------|---------|
| `cron` | Cron expression | `0 */5 * * *` |
| `interval` | Milliseconds | `60000` |
| `one-time` | ISO timestamp | `2025-01-01T00:00:00Z` |

Execution modes: `js-inline` (in-process), `js-k8s` (K8s Job with Bun), `docker` (K8s Job with custom image).

### Service Registry & Canary Deployments

The Registry Service manages tenant Knative services with full lifecycle support:

1. **Register**: deploy a container image as a Knative service in the tenant namespace
2. **Routes**: define path prefixes for API Gateway dynamic routing
3. **Canary**: progressive traffic splitting between stable and canary revisions
4. **Promote/Rollback**: finalize or revert canary deployments

### Tenant Management (Third-Level Isolation)

Each environment runs its own tenant-service scoped by `PLATFORM_ENVIRONMENT`. Creating a tenant provisions:

1. Kubernetes namespace `<tenant>-<env>-ns` with discovery labels
2. Dedicated PostgreSQL StatefulSet with pre-configured schema (events + metrics tables)
3. Services connect to per-tenant PostgreSQL at `postgres.<tenant>-<env>-ns.svc.cluster.local`

### Handler Registry

The Event Processor uses a pluggable handler pattern. Each event type maps to a dedicated handler class discovered automatically at startup via NestJS `DiscoveryService`.

| Handler | Event Type | Behavior |
|---|---|---|
| `CreatedHandler` | `created` | Marks event as processed |
| `UpdatedHandler` | `updated` | Marks event as processed |
| `DeletedHandler` | `deleted` | Marks event as processed |
| `DefaultHandler` | *(fallback)* | Processes if payload has content |

### Enrichment Pipeline

Before reaching the handler, every event passes through a middleware-style enrichment pipeline:

| Stage | Order | Behavior |
|---|---|---|
| `ValidationStage` | 10 | Validates payload against a registered JSON schema (ajv) |
| `EnrichmentStage` | 20 | Attaches `metadata.receivedAt`, `metadata.correlationId`, `metadata.source` |
| `AdapterEnrichmentStage` | 25 | Fetches data from adapter endpoint via `AdapterClient`, merges into `payload._enriched` (non-blocking on failure) |
| `TransformStage` | 30 | Runs registered payload transformers in sequence |
| `AdapterForwardStage` | 40 | POSTs payload to adapter endpoint with exponential backoff retry (non-blocking on failure) |

### NATS JetStream Streams

| Stream | Subjects | Purpose |
|---|---|---|
| `EVENTS` | `events.>` | Ingested events from the API Gateway |
| `RESULTS` | `results.>` | Completion events from the Event Processor |
| `DLQ` | `dlq.>` | Failed webhook deliveries |

| Setting | Value |
|---|---|
| `retention` | Limits |
| `max_age` | 7 days |
| `max_bytes` | 512 MB (EVENTS), 256 MB (RESULTS), 64 MB (DLQ) |
| `max_deliver` | 5 |

### Shared Types Package

The `packages/shared/` package (`@yoizen/shared`) contains all cross-service types and constants:

- **Event interfaces**: `EventEnvelope`, `EventResult`, `ProcessedEvent`, `CompletionEvent`, `MetricsPayload`
- **Auth interfaces**: `JwtPayload`, `TokenResponse`, `TokenScope`, `PublicRouteEntry`
- **Workflow interfaces**: `WorkflowDefinition`, `WorkflowAction`, `WorkflowExecutionContext`
- **Adapter interfaces**: `AdapterConfig`, `AdapterEndpointConfig`, `AdapterCache`, `ResolvedAdapterRequest`, `AdapterReference`
- **Adapter client**: `AdapterClient` (stale-while-revalidate Redis cache, OAuth2 token management, request resolution)
- **Constants**: stream/consumer names, Redis key prefixes, TTLs, webhook retry config, task queues, Knative API versions, `DEFAULT_ADAPTER_SERVICE_URL`

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | >= 1.28 | Cluster management |
| [Docker](https://docs.docker.com/get-docker/) | >= 24 | Image builds |
| [minikube](https://minikube.sigs.k8s.io/docs/start/) | >= 1.32 | Local cluster (Minikube path) |
| [OrbStack](https://orbstack.dev/) | >= 1.6 | Local cluster (OrbStack path) |

## Quick Start

### Minikube

```bash
./bootstrap.sh
```

This script will:
1. Start minikube with profile `yoizen-arch` (6 CPUs, memory auto-scales to
   Docker Desktop and stays below the 16GB cap)
2. Enable `metrics-server` addon
3. Install Knative Serving + Kourier networking layer
4. Deploy NATS JetStream, Redis, PostgreSQL, and Temporal to all 4 `support-services-{env}` namespaces
5. Build service Docker images inside minikube
6. Deploy Knative Services to all 4 `platform-services-{env}` namespaces

If you want to force a specific memory value, set `MINIKUBE_MEMORY_MB` before
running the bootstrap. Example:

```bash
MINIKUBE_MEMORY_MB=14336 ./bootstrap.sh dev
```

### OrbStack

1. Enable Kubernetes in OrbStack: **Settings → Kubernetes → Enable Kubernetes**
2. Run:

```bash
./bootstrap-orbstack.sh
```

This script will:
1. Switch kubectl context to `orbstack`
2. Install Knative Serving + Kourier networking layer
3. Deploy NATS JetStream, Redis, PostgreSQL, and Temporal using the `orbstack` overlay (StorageClass: `local-path`)
4. Build service Docker images (OrbStack shares the local Docker daemon with the cluster — no extra configuration needed)
5. Deploy Knative Services to all 4 `platform-services-{env}` namespaces

Deploy a single environment:

```bash
./bootstrap-orbstack.sh dev
```

> **Note on PVCs from other clusters**: if you apply manifests originally designed for Minikube, EKS, GKE, or AKS that hardcode a `storageClassName` (`standard`, `gp2`, `gp3`, `standard-rwo`, `managed-premium`), the OrbStack overlay registers those as aliases for `rancher.io/local-path` so PVCs bind correctly without modifying the original YAMLs.

## Project Structure

```
Arch/
├── bootstrap.sh                     # One-command setup (Minikube)
├── bootstrap-orbstack.sh            # One-command setup (OrbStack)
├── scripts/
│   └── smoke-test.sh                # E2E smoke tests against minikube
├── packages/
│   └── shared/                      # @yoizen/shared — cross-service types and constants
│       └── src/
│           ├── constants.ts          # Stream names, key prefixes, TTLs, task queues, Knative API
│           ├── interfaces.ts         # EventEnvelope, EventResult, ProcessedEvent, MetricsPayload
│           ├── auth.constants.ts     # JWT TTLs, public routes cache config
│           ├── auth.interfaces.ts    # JwtPayload, TokenResponse, TokenScope, PublicRouteEntry
│           ├── workflow.interfaces.ts # WorkflowDefinition, WorkflowAction, activity args
│           ├── adapter.interfaces.ts # AdapterConfig, AdapterEndpointConfig, AdapterCache, ResolvedAdapterRequest
│           ├── adapter-client.ts     # AdapterClient (SWR cache, OAuth2, request resolution)
│           └── index.ts              # Barrel export
├── infrastructure/
│   ├── base/                         # Kustomize base manifests
│   │   ├── nats/                     # NATS JetStream StatefulSet
│   │   ├── redis/                    # Redis Deployment
│   │   ├── postgres/                 # PostgreSQL StatefulSet
│   │   └── temporal/                 # Temporal Deployment + Service
│   └── overlays/
│       ├── local/                    # Minikube per-environment overlays
│       │   ├── namespaces.yaml       # All 8 namespace definitions
│       │   ├── local-base/           # Shared patches (resource limits)
│       │   ├── dev/                  # namespace: support-services-dev
│       │   ├── qa/                   # namespace: support-services-qa
│       │   ├── staging/              # namespace: support-services-staging
│       │   └── production/           # namespace: support-services-production
│       └── orbstack/                 # OrbStack per-environment overlays
│           ├── storage-class-compat.yaml  # Aliases: standard/gp2/gp3/… → local-path
│           ├── namespaces.yaml       # All 8 namespace definitions
│           ├── orbstack-base/        # Shared patches (resource limits + storageClassName)
│           ├── dev/
│           ├── qa/
│           ├── staging/
│           └── production/
├── knative/
│   ├── serving/                      # Autoscaler ConfigMap
│   └── services/
│       ├── base/                     # Service YAMLs
│       ├── rbac/                     # ClusterRole + per-env ClusterRoleBindings
│       └── overlays/
│           └── local/                # Per-environment overlays with env patches
├── services/                         # Application source code
│   ├── api-gateway/                  # NestJS + Fastify — HTTP entry point, auth, dynamic routing
│   ├── auth-service/                 # NestJS + Fastify — JWT auth, users, clients, public routes
│   ├── event-processor/              # NestJS + Fastify — NATS consumer, pipeline, handler registry
│   ├── audit-service/                # NestJS + Fastify — NATS consumer, per-tenant PostgreSQL
│   ├── webhook-service/              # NestJS + Fastify — NATS consumer, HTTP callback delivery
│   ├── cache-service/                # NestJS + Fastify — L1/L2 cache API
│   ├── metrics-service/              # NestJS + Fastify — NATS consumer, per-tenant PostgreSQL
│   ├── tenant-service/               # NestJS + Fastify — K8s namespace + PostgreSQL provisioning
│   ├── scheduler-service/            # NestJS + Fastify — Job scheduling (cron/interval/one-time)
│   ├── registry-service/             # NestJS + Fastify — Knative service registry + canary
│   ├── adapter-service/              # NestJS + Fastify — Multi-tenant HTTP adapter config + endpoints
│   ├── workflow-service/             # NestJS + Fastify + Temporal — Workflow API + worker
│   └── workflow-http-worker/         # Standalone Temporal worker — HTTP activities (adapter-aware)
└── tests/
    └── e2e/                          # Cross-service end-to-end tests
```

## Manual Operations

### Apply infrastructure only

```bash
# Minikube — all environments
kubectl apply -k infrastructure/overlays/local

# Minikube — single environment
kubectl apply -k infrastructure/overlays/local/dev

# OrbStack — all environments
kubectl apply -k infrastructure/overlays/orbstack

# OrbStack — single environment
kubectl apply -k infrastructure/overlays/orbstack/dev
```

### Apply Knative services only

```bash
# All environments (same overlay for both Minikube and OrbStack)
kubectl apply -k knative/serving
kubectl apply -k knative/services/overlays/local

# Single environment
kubectl apply -k knative/serving
kubectl apply -k knative/services/overlays/local/dev
```

### Build images (Minikube)

```bash
eval $(minikube docker-env -p yoizen-arch)
for svc in api-gateway auth-service event-processor cache-service audit-service webhook-service metrics-service tenant-service scheduler-service registry-service adapter-service workflow-service workflow-http-worker proxy-service; do
  docker build -t "dev.local/${svc}:local" -f "services/${svc}/Dockerfile" .
done
```

### Build images (OrbStack)

OrbStack >= 1.6 shares the local Docker daemon with the cluster — just build normally:

```bash
for svc in api-gateway auth-service event-processor cache-service audit-service webhook-service metrics-service tenant-service scheduler-service registry-service adapter-service workflow-service workflow-http-worker proxy-service; do
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

#### OrbStack

OrbStack exposes the local cluster through `127.0.0.1.sslip.io`, so no tunnel is required.

```bash
# Authenticate (get a token)
curl -X POST http://api-gateway.platform-services-dev.127.0.0.1.sslip.io/auth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"...","client_secret":"..."}'
```

For local localhost access to the frontends/API, you can also use:

```bash
./port-forward.sh dev
```

#### Minikube

Start the minikube tunnel (required for Kourier LoadBalancer):

```bash
minikube tunnel -p yoizen-arch
```

Then use the Knative service URLs:

```bash
# Authenticate (get a token)
curl -X POST http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/auth/token \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"...","client_secret":"..."}'

# Publish an event
curl -X POST http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/events \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-yoizen-tenant: acme" \
  -d '{"type":"created","payload":{"name":"test"}}'

# Get result
curl http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/results/<EVENT_ID> \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-yoizen-tenant: acme"

# Stream events (SSE)
curl -N http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/events/stream \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-yoizen-tenant: acme"

# Create a tenant
curl -X POST http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/tenants \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"name":"acme"}'

# Start a workflow
curl -X POST http://api-gateway.platform-services-dev.<MINIKUBE_IP>.sslip.io/workflows \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -H "x-yoizen-tenant: acme" \
  -d '{"name":"my-flow","application":"test","request":{},"actions":[...]}'
```

### Local development (without K8s)

Each service can run standalone with local infrastructure:

```bash
# Start NATS, Redis, PostgreSQL, and Temporal locally (Docker)
docker run -d --name nats -p 4222:4222 nats:2.10-alpine --jetstream
docker run -d --name redis -p 6379:6379 redis:7-alpine
docker run -d --name postgres -p 5432:5432 \
  -e POSTGRES_DB=yoizen -e POSTGRES_USER=yoizen -e POSTGRES_PASSWORD=yoizen-dev-password \
  postgres:17-alpine
docker run -d --name temporal -p 7233:7233 -p 8233:8233 \
  -e DB=postgresql -e POSTGRES_SEEDS=host.docker.internal \
  temporalio/auto-setup:latest

# Run a service
cd services/api-gateway
bun install
bun run start:dev
```

## Testing

### Unit tests (per service)

```bash
cd services/<service> && bun test:unit
```

### Integration tests (per service)

```bash
cd services/<service> && bun test:integration
```

### E2E tests (full flow)

```bash
# Against minikube
./scripts/smoke-test.sh

# Against local services
cd tests/e2e
bun install
API_GATEWAY_URL=http://localhost:3000 bun test
```

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Networking layer | Kourier | ~10x less resources than Istio, sufficient for local/dev |
| Event transport | NATS JetStream (direct) | Lower latency than Knative Eventing, full control over streams/consumers |
| Event processing | Pluggable handler registry | New event types added by creating a handler class — no core changes |
| Enrichment pipeline | Ordered stages (ajv + metadata + transform) | Separates cross-cutting concerns from handler logic |
| Two-stream design | EVENTS + RESULTS | Prevents feedback loops; enables independent fan-out |
| Authentication | JWT via `jose` (HS256) | Stateless, minimal overhead; argon2id for password storage |
| Tenant isolation | Per-tenant PostgreSQL StatefulSet | Full data isolation; provisioned by tenant-service on creation |
| Workflow engine | Temporal | Durable, retryable, language-agnostic workflow orchestration |
| Job scheduling | In-process engine + K8s Jobs | Lightweight for inline JS; K8s Jobs for isolated docker execution |
| Service registry | Knative + PostgreSQL | Leverages Knative for autoscaling; PostgreSQL for route/canary state |
| Dynamic routing | Gateway poll + prefix matching | Decoupled from registry; 15s eventual consistency is acceptable |
| HTTP framework | Fastify | 2-3x faster than Express for NestJS |
| Cache client | ioredis | Better pipelining, cluster support, and benchmark performance |
| IaC format | Kustomize | Native to kubectl, zero external dependencies |
| HTTP adapters | Shared `AdapterClient` with Redis SWR cache | Centralizes auth, headers, retries, and timeouts; stale-while-revalidate avoids blocking on cache miss |
| Multi-environment | 4 isolated env pairs | Each env gets its own NATS, Redis, Postgres, Temporal, and full service stack |

## Tech Stack

- **Runtime**: Bun 1.3
- **Framework**: NestJS 11 + Fastify
- **Language**: TypeScript 5 (strict mode)
- **Messaging**: NATS 2.10 + JetStream
- **Caching**: Redis 7 + ioredis
- **Database**: PostgreSQL 17 + postgres.js
- **Workflow**: Temporal + @temporalio/client + @temporalio/worker
- **Auth**: JWT via `jose` (HS256), `Bun.password` argon2id hashing
- **Validation**: class-validator + class-transformer, ajv (pipeline payload schemas)
- **K8s Client**: @kubernetes/client-node (Tenant, Scheduler, Registry services)
- **Orchestration**: Kubernetes (Minikube)
- **Serverless**: Knative Serving + Kourier
- **IaC**: Kustomize (base + per-environment overlays)
