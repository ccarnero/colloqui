# Platform Cluster

Serverless event-driven architecture running on Kubernetes (Minikube or OrbStack) with Knative Serving, NATS JetStream, Redis, PostgreSQL, and Temporal. Single-node developer configuration with stable `dev.local` hostnames, no KEDA autoscaling, and one-command bring-up.

## Developer mode — quickstart

```bash
# OrbStack (recommended on macOS)
./bootstrap-orbstack-osx.sh          # bring up support + platform services
./bootstrap-orbstack-osx.sh --smoke  # same + run smoke tests at the end

# Minikube
./bootstrap-minikube.sh              # bring up (requires: sudo minikube tunnel in parallel)

# Iterate: rebuild only changed service images
./rebuild-changed.sh

# Smoke test (standalone)
ADMIN_EMAIL=admin@yoizen.test ADMIN_PASSWORD=admin bash scripts/smoke-test.sh
```

Bootstrap writes `/etc/hosts` entries — no extra DNS setup needed:

```
# Access after bootstrap:
http://api-gateway.platform-services-dev.dev.local
http://admin-console.platform-services-dev.dev.local
```

Optional storage engine: `STORAGE_ENGINE=mongo ./bootstrap-orbstack-osx.sh`

Tilt is an optional hot-reload layer — see the `Tiltfile` header.

## Create a tenant & run a workflow

Once the cluster is up and the `/etc/hosts` block is in place, provision a tenant and exercise a workflow end-to-end.

### Requirements

- A running dev cluster (see the quickstart above). The API gateway resolves to `http://api-gateway.platform-services-dev.dev.local`.
- `curl`, `jq`, and `kubectl` on your `PATH`. Optional: the `nats` CLI (`brew install nats-io/nats-tools/nats`) for the stream-cleanup workaround below.
- Platform admin credentials (defaults): `admin@yoizen.io` / `yoizen-admin-change-me`.

### Provision the `acme` tenant

```bash
ADMIN_EMAIL=admin@yoizen.io ADMIN_PASSWORD=yoizen-admin-change-me \
  ./tests/stress/scripts/provision.sh
```

Defaults to `TENANT_NAME=acme`; creates the tenant plus a registry service, a Telegram channel, and a sample workflow. Override with `TENANT_NAME=<slug>` or point at a different gateway with `API_GATEWAY_URL=`.

### Run a workflow in a tenant

Direct-execute a `jsFunction` workflow (no channel required). Tenant-scoped calls carry **both** `Authorization: Bearer` and `x-yoizen-tenant`:

```bash
GW=http://api-gateway.platform-services-dev.dev.local
TOKEN=$(curl -s $GW/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@yoizen.io","password":"yoizen-admin-change-me"}' | jq -r .access_token)

# create (tenant-scoped → needs x-yoizen-tenant)
WID=$(curl -s -X POST $GW/api/workflows -H "authorization: Bearer $TOKEN" \
  -H 'x-yoizen-tenant: acme' -H 'content-type: application/json' \
  -d '{"name":"hello","application":"test","actions":[{"activity":"jsFunction","name":"greet","args":{"code":"(ctx)=>({greeting:\"hi\"})"}}]}' | jq -r .id)

# execute → poll until COMPLETED
EID=$(curl -s -X POST $GW/api/workflows/$WID/execute -H "authorization: Bearer $TOKEN" \
  -H 'x-yoizen-tenant: acme' -H 'content-type: application/json' -d '{"request":{}}' | jq -r .executionId)

curl -s $GW/api/workflows/$WID/executions/$EID \
  -H "authorization: Bearer $TOKEN" -H 'x-yoizen-tenant: acme' | jq
```

A `"status": "COMPLETED"` confirms the whole chain: gateway → workflow-service → Temporal → workflow-worker → per-tenant Postgres.

> **Tenant routes:** tenant *creation* uses `Authorization: Bearer` only (tenant routes are `@SkipTenant`); every tenant-*scoped* call (workflows, channels) needs **both** the Bearer token and `x-yoizen-tenant: <tenant>`.

### Troubleshooting: `provisioning failed: subjects overlap with an existing stream`

The global `SKB-INGESTION` JetStream stream (`evt.*.…`) overlaps a tenant's per-tenant ingress stream (`evt.<tenant>.>`), so the second one to be created is rejected. Delete the failed tenant and the colliding stream, then re-provision:

```bash
curl -s -X DELETE $GW/api/tenants/acme -H "authorization: Bearer $TOKEN"
kubectl port-forward -n support-services-dev svc/nats 4222:4222 &
nats stream rm SKB-INGESTION -f -s nats://localhost:4222
ADMIN_EMAIL=admin@yoizen.io ADMIN_PASSWORD=yoizen-admin-change-me ./tests/stress/scripts/provision.sh
```

---

## Getting Started

**New to the platform?** Follow this reading order:

1. [01 Platform Architecture](./01-ARCHITECTURE.md) — High-level ownership and service boundaries (20 min)
2. [02 Infrastructure and Deployment](./02-INFRASTRUCTURE.md) — Support services, overlays, and scaling (20 min)
3. [03 NATS and JetStream](./03-NATS-JETSTREAM.md) — Canonical messaging topology (20 min)
4. [04 Workflow Engine](./04-WORKFLOW-ENGINE.md) — Trigger bridge and action dispatch model (20 min)
5. [05 Agent Execution Flow](./05-AGENT-EXECUTION-FLOW.md) — `agentCall` runtime lifecycle (15 min)
6. [06 UI Flows](./06-UI-FLOWS.md) — Console-to-backend flow mapping (15 min)
7. [07 Connector Runtime vs Workflow Service](./07-CONNECTOR-RUNTIME-VS-WORKFLOW-SERVICE.md) — Decision matrix and scenarios (30 min)
8. [08 Workflow Telegram Sequence](./08-WORKFLOW-TELEGRAM-SEQUENCE.md) — Concrete end-to-end runtime flow (15 min)
9. [09 Common Patterns](./09-COMMON-PATTERNS.md) — Pseudocode recipes (20 min)
10. [10 Developer Onboarding Guide](./10-DEVELOPER-ONBOARDING.md) — Setup and day-to-day workflows (30 min)
11. Service READMEs:
   - [Connector Runtime](../services/connector-runtime/README.md) — Generic HTTP execution
   - [Connector Admin](../services/connector-admin/README.md) — Connector configuration API
   - [Workflow Service](../services/workflow-service/README.md) — Multi-step orchestration
   - [@yoizen/shared Package](../packages/shared/README.md) — Types and constants

## Core Documentation

### Service Architecture & Integration

| Document | Purpose | Audience |
|----------|---------|----------|
| [01 Platform Architecture](./01-ARCHITECTURE.md) | High-level service boundaries and ownership model | All developers |
| [02 Infrastructure and Deployment](./02-INFRASTRUCTURE.md) | Support services, deployment models, overlays, and scaling | DevOps/Platform engineers |
| [03 NATS and JetStream](./03-NATS-JETSTREAM.md) | Canonical messaging topology, subjects, and envelope contract | Backend/platform engineers |
| [04 Workflow Engine](./04-WORKFLOW-ENGINE.md) | Trigger bridge, action dispatch, and task queue model | Automation developers |
| [05 Agent Execution Flow](./05-AGENT-EXECUTION-FLOW.md) | `agentCall` lifecycle from workflow to runtime and back | Automation/AI developers |
| [06 UI Flows](./06-UI-FLOWS.md) | Admin and messaging console flows mapped to backend services | Frontend/full-stack developers |
| [07 Connector Runtime vs Workflow Service](./07-CONNECTOR-RUNTIME-VS-WORKFLOW-SERVICE.md) | Decision matrix and when to use each service with scenario walkthroughs | Feature implementers |
| [08 Workflow Telegram Sequence](./08-WORKFLOW-TELEGRAM-SEQUENCE.md) | Concrete Telegram inbound flow with hosted + agent branches | All developers |
| [09 Common Patterns](./09-COMMON-PATTERNS.md) | Practical pseudocode recipes for 10 common use cases | All developers |
| [10 Developer Onboarding Guide](./10-DEVELOPER-ONBOARDING.md) | Setup, navigation, common tasks, debugging, testing | New team members |
| [11 Service Architecture Diagrams](./11-SERVICE-ARCHITECTURE-DIAGRAM.md) | Visual reference for service boundaries, data flow, scaling, and multi-tenancy patterns | All developers |
| [12 Adapter Tools](./12-adapter-tools.md) | Connector tooling and helper references | Feature implementers |
| [13 Review](./13-REVIEW.md) | Code review standards and checklist | All contributors |
| [14 Deployment Architecture](./14-DEPLOYMENT-ARCHITECTURE.md) | Legacy deep-dive details for Kustomize and KEDA | DevOps/Platform engineers |

### Service READMEs

| Service | Purpose | Type |
|---------|---------|------|
| [Connector Runtime](../services/connector-runtime/README.md) | Standalone Temporal worker for high-concurrency HTTP execution with connector-driven config | Core service |
| [Connector Admin](../services/connector-admin/README.md) | Multi-tenant HTTP connector configuration API (base URL, auth, headers, timeouts, retries) | Core service |
| [Workflow Service](../services/workflow-service/README.md) | REST API + Temporal orchestrator for multi-step workflows with state management | Core service |
| [@yoizen/shared Package](../packages/shared/README.md) | Cross-service types, interfaces, constants, and `AdapterClient` | Shared library |

## Architecture Overview

### Focused Runtime Sequences

- [`08-WORKFLOW-TELEGRAM-SEQUENCE.md`](./08-WORKFLOW-TELEGRAM-SEQUENCE.md) — concrete Telegram inbound flow split into shared ingress plus two execution branches: simple hosted service call and YoizenClaw `agentCall`.

```
┌───────────────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster (Minikube or OrbStack)                            │
│                                                                       │
│  ┌─── knative-serving ─────────────────────────────────────────────┐  │
│  │  Kourier Ingress  ·  KPA Autoscaler  ·  dev.local DNS          │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ┌─── Developer mode (single env: dev) ────────────────────────────┐  │
│  │                                                                 │  │
│  │  ┌─ platform-services-{env} (Knative Services) ──────────────┐  │  │
│  │  │  api-gateway · auth-service · audit-service                │  │  │
│  │  │  cache-service · channel-service · tenant-service          │  │  │
│  │  │  registry-service · workflow-service · workflow-worker     │  │  │
│  │  │  connector-runtime · connector-admin                       │  │  │
│  │  │  agent-admin-service · ai-agent-gateway     │  │  │
│  │  │  usage-aggregator-service · proxy-service · admin-console  │  │  │
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

**Developer mode uses only the `dev` environment.** The qa/staging/production overlays and the `cloud/` overlay tree were removed from the repository to keep the developer configuration minimal.

| Environment | Support Namespace | Platform Namespace |
|-------------|-------------------|--------------------|
| dev | `support-services-dev` | `platform-services-dev` |

Manual kustomize apply (use the bootstrap scripts instead for day-to-day work):

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
| **Audit Service** | Knative Service | Independent NATS consumer that persists every event to per-tenant PostgreSQL. Exposes paginated query API |
| **Cache Service** | Knative Service | CRUD API with L1 in-memory + L2 Redis cache-aside pattern |
| **Channel Service** | Knative Service | Multi-tenant messaging channel configuration and inbound webhook ingress |
| **Tenant Service** | Knative Service | Environment-scoped tenant namespace management. Provisions dedicated PostgreSQL StatefulSet and per-tenant `agent-ai-service` Knative Service |
| **Registry Service** | Knative Service | Knative-based service registry with route management, canary deployments, and traffic splitting |
| **Workflow Service** | Knative Service | REST API + Temporal orchestrator for multi-step workflows (start, status, list) |
| **Workflow Worker** | Knative Service | Temporal orchestrator worker executing JS functions and NATS service bus activities |
| **Connector Admin** | Knative Service | Manages multi-tenant HTTP connector configurations (base URL, auth, headers, timeouts, retries) and their endpoints. Consumed via `AdapterClient` by `connector-runtime` |
| **Connector Runtime** | Knative Service (KEDA-scaled) | Generic Temporal HTTP execution worker for `endpointCall` and `serviceCall`; uses `tracedFetch`, connector resolution, response caching, and internal service mirror lookup |
| **Agent Admin Service** | Knative Service | Authoring API for AI agents/workflows (config-only persistence; runtime is per-tenant) |
| **AI Agent Gateway** | Knative Service | Stateless inbound bridge that fans out execution requests to the per-tenant `agent-ai-service` Knative Service |
| **Agent AI Service** | Knative Service (per-tenant) | Per-tenant agent execution runtime auto-provisioned by `tenant-service` into the tenant namespace |
| **Usage Aggregator Service** | Knative Service | Aggregates per-tenant usage events into the usage Postgres |
| **Proxy Service** | Knative Service | Egress proxy for tenant-bound HTTP traffic |
| **Admin Console** | Knative Service | Angular admin UI |
| **NATS JetStream** | StatefulSet | Persistent event streaming backbone with 7-day retention. Streams: EVENTS, RESULTS, DLQ |
| **Redis** | Deployment | Pure cache (no persistence, LRU eviction) |
| **PostgreSQL** | StatefulSet | Shared database for auth, registry, and connector services |
| **Temporal** | Deployment | Workflow execution engine with PostgreSQL backend and Web UI |

### Event Flow

The slim stack centres on Temporal-driven workflow execution and per-tenant
agent runtimes. Event ingestion is now a thin path that hands off to those
engines:

1. Client sends `POST /events` to API Gateway with a JWT Bearer token
2. Gateway authenticates the request, resolves tenant, and validates the payload
3. Gateway publishes the envelope to NATS JetStream (`EVENTS` stream) and returns `202 Accepted` with the event ID
4. Audit Service independently consumes EVENTS and persists every event to per-tenant PostgreSQL
5. Trigger consumers (workflow-service, agent-ai-service) consume the events they care about and start Temporal workflows or agent executions
6. Workflow activities run on `workflow-service-worker` (orchestration) and `connector-runtime` (HTTP execution against `connector-admin`-managed connectors)
7. Completion events are published back to NATS (`RESULTS` stream) and clients can fetch the result via the gateway or receive it via SSE

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
| `endpointCall` | Remote (`connector-runtime`) | HTTP request via `tracedFetch`; supports connector-driven config resolution via `adapterId`/`endpointId` |
| `serviceCall` | Remote (`connector-runtime`) | Internal service call resolved against the registry mirror |
| `jsFunction` | Local (workflow-worker) | Inline JS evaluation |
| `serviceBusCall` | Local (workflow-worker) | NATS publish with tenant header |
| `branch` | Workflow-level | Parallel execution of sub-action branches |

Actions support `{{path.to.value}}` template resolution against the workflow execution context.

### Service Registry & Canary Deployments

The Registry Service manages tenant Knative services with full lifecycle support:

1. **Register**: deploy a container image as a Knative service in the tenant namespace
2. **Routes**: define path prefixes for API Gateway dynamic routing
3. **Canary**: progressive traffic splitting between stable and canary revisions
4. **Promote/Rollback**: finalize or revert canary deployments

### Tenant Management (Third-Level Isolation)

Each environment runs its own tenant-service scoped by `PLATFORM_ENVIRONMENT`. Creating a tenant provisions:

1. Kubernetes namespace `<tenant>-<env>-ns` with discovery labels
2. Dedicated PostgreSQL StatefulSet with pre-configured tenant schema
3. Per-tenant `agent-ai-service` Knative Service applied right after Postgres readiness
4. Services connect to per-tenant PostgreSQL at `postgres.<tenant>-<env>-ns.svc.cluster.local`

### NATS JetStream Streams

| Stream | Subjects | Purpose |
|---|---|---|
| `EVENTS` | `events.>` | Ingested events from the API Gateway |
| `RESULTS` | `results.>` | Completion events emitted by workflows and runtimes |
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
- **Constants**: stream/consumer names, Redis key prefixes, TTLs, task queues (`CONNECTOR_RUNTIME_TASK_QUEUE`, `WORKFLOW_ORCHESTRATOR_TASK_QUEUE`), Knative API versions

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
├── services/                          # Application source code
│   ├── api-gateway/                   # NestJS + Fastify — HTTP entry point, auth, dynamic routing
│   ├── auth-service/                  # NestJS + Fastify — JWT auth, users, clients, public routes
│   ├── audit-service/                 # NestJS + Fastify — NATS consumer, per-tenant PostgreSQL
│   ├── cache-service/                 # NestJS + Fastify — L1/L2 cache API
│   ├── channel-service/               # NestJS + Fastify — Messaging channel config + inbound webhooks
│   ├── tenant-service/                # NestJS + Fastify — K8s namespace + PostgreSQL + agent-ai-service provisioning
│   ├── registry-service/              # NestJS + Fastify — Knative service registry + canary
│   ├── connector-admin/               # NestJS + Fastify — Multi-tenant HTTP connector config + endpoints
│   ├── connector-runtime/             # Standalone Temporal worker — generic HTTP execution (connector-aware)
│   ├── workflow-service/              # NestJS + Fastify + Temporal — Workflow API + worker
│   ├── workflow-http-worker/          # Temporal worker — high-concurrency HTTP execution
│   ├── usage-aggregator-service/      # NestJS + Fastify — Per-tenant usage aggregation
│   ├── proxy-service/                 # NestJS + Fastify — Tenant egress proxy
│   ├── admin-console/                 # Angular admin UI
│   ├── agent-admin-service/      # NestJS + Fastify — YoizenClaw authoring API
│   ├── ai-agent-gateway/    # NestJS + Fastify — Stateless inbound bridge to per-tenant runtimes
│   └── agent-ai-service/            # TypeScript — Per-tenant agent execution runtime (provisioned per tenant)
└── tests/
    └── e2e/                           # Cross-service end-to-end tests
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
for svc in api-gateway auth-service audit-service cache-service channel-service tenant-service registry-service connector-admin connector-runtime workflow-service workflow-http-worker usage-aggregator-service proxy-service agent-admin-service ai-agent-gateway; do
  docker build -t "dev.local/${svc}:local" -f "services/${svc}/Dockerfile" .
done
```

### Build images (OrbStack)

OrbStack >= 1.6 shares the local Docker daemon with the cluster — just build normally:

```bash
for svc in api-gateway auth-service audit-service cache-service channel-service tenant-service registry-service connector-admin connector-runtime workflow-service workflow-http-worker usage-aggregator-service proxy-service agent-admin-service ai-agent-gateway; do
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
pnpm install
bun run start:dev
```

## Testing

### Unit tests (per service)

```bash
cd services/<service> && bun run test:unit
```

### Integration tests (per service)

```bash
cd services/<service> && bun run test:integration
```

### E2E tests (full flow)

```bash
# Against minikube
./scripts/smoke-test.sh

# Against local services
cd tests/e2e
pnpm install
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
- **K8s Client**: @kubernetes/client-node (Tenant, Registry services)
- **Orchestration**: Kubernetes (Minikube)
- **Serverless**: Knative Serving + Kourier
- **IaC**: Kustomize (base + per-environment overlays)
