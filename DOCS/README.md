# Platform Cluster

Serverless event-driven architecture running on Kubernetes (OrbStack) with Knative Serving, NATS JetStream, Redis, PostgreSQL, and Temporal. Single-node developer configuration with stable `dev.local` hostnames, no KEDA autoscaling, and one-command bring-up.

## Developer mode — quickstart

```bash
# OrbStack (recommended on macOS)
./bootstrap-orbstack-osx.sh          # bring up support + platform services
./bootstrap-orbstack-osx.sh --smoke  # same + readiness preflight at the end

# Iterate: rebuild only changed service images
./rebuild-changed.sh

# Readiness preflight (standalone)
bash scripts/smoke-test.sh
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
./setup-tenant.sh
```

`setup-tenant.sh` takes named flags (`--tenant-id`, `--email`, `--password`, `--api-url`, etc.), includes idempotency checks and a provisioning-status wait loop, and creates the tenant plus a tenant admin user only — no registry service, channel, or sample workflow. Override the gateway URL with `--api-url <url>`.

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

Older versions created a dedicated `SKB-INGESTION` stream whose `evt.*.…` subjects overlap the per-tenant ingress streams (`evt.<tenant>.>`), so tenant provisioning was rejected. Current code no longer creates that stream (the SKB worker consumes from the per-tenant `INGRESS-*` streams), but a cluster bootstrapped before the fix may still carry the orphaned stream. Delete the failed tenant and the orphaned stream, then re-provision:

```bash
curl -s -X DELETE $GW/api/tenants/acme -H "authorization: Bearer $TOKEN"
kubectl port-forward -n support-services-dev svc/nats 4222:4222 &
nats stream rm SKB-INGESTION -f -s nats://localhost:4222
./setup-tenant.sh
```

---

## Getting Started

**New to the platform?** Follow this reading order:

1. [Platform Architecture](./architecture/overview.md) — High-level ownership and service boundaries (20 min)
2. [Infrastructure and Deployment](./architecture/infrastructure.md) — Support services, overlays, and scaling (20 min)
3. [NATS and JetStream](./messaging/service-bus.md) — Canonical messaging topology (20 min)
4. [Workflow Engine](./workflows/engine.md) — Trigger bridge and action dispatch model (20 min)
5. [Agent Execution Flow](./agents/execution.md) — `agentCall` runtime lifecycle (15 min)
6. [UI Flows](./guides/ui-flows.md) — Console-to-backend flow mapping (15 min)
7. [Connector Runtime vs Workflow Service](./workflows/connector-vs-workflow.md) — Decision matrix and scenarios (30 min)
8. [Workflow Telegram Sequence](./channels/telegram-sequence.md) — Concrete end-to-end runtime flow (15 min)
9. [Common Patterns](./workflows/patterns.md) — Pseudocode recipes (20 min)
10. [Developer Onboarding Guide](./guides/onboarding.md) — Setup and day-to-day workflows (30 min)
11. Service READMEs:
   - [Connector Runtime](../services/connector-runtime/README.md) — Generic HTTP execution
   - [Connector Admin](../services/connector-admin/README.md) — Connector configuration API
   - [Workflow Service](../services/workflow-service/README.md) — Multi-step orchestration
   - [@yoizen/shared Package](../packages/shared/src/index.ts) — Types and constants

## Core Documentation

### Where truth lives

Three tiers, one rule each:

| Tier | Holds | Kind |
|---|---|---|
| [`AGENTS.md`](../AGENTS.md) (repo root) | The constitution — rules, binding styles, review standards. The ONLY agent file in the repo | Prescriptive |
| `services/*/README.md`, `packages/*/README.md` | Per-component truth: purpose, contracts, env vars, architecture, with `file:line` citations back to the code | Descriptive |
| `DOCS/**` | Cross-cutting contracts (messaging envelope, taxonomy), architecture, guides, ADRs | Mixed — see below |

**Descriptive docs are derived FROM the code; the code decides.** When a README
and the code disagree, the README is wrong. **Prescriptive docs record a design
the code must obey** — the envelope spec, the security MUSTs, `TAXONOMY.md`'s
classification rules. When those disagree with the code, the CODE is the bug and
the doc is not rewritten; the divergence is recorded as a numbered finding.

Per-component `AGENTS.md` files no longer exist — all 14 were absorbed into the
corresponding README and deleted (`manual-loops/architecture/docs-consistency.md`).
A resurrected one now fails the build.

### Enforcement (G0)

`scripts/checks/doc-code-guards.sh` runs 13 static guards, reports EVERY failure,
and exits non-zero if any guard failed — it is deliberately report-all, not
fail-fast, so one run surfaces the whole drift set (`fail()` accumulates into
`FAILURES`; `main()` exits on the total). Beyond the original K6/K7/K8/K9 set it
now enforces:

| Guard | Pins |
|---|---|
| **K6g** | No `services/*/AGENTS.md` or `packages/*/AGENTS.md` exists — the per-component agent file cannot come back. The root `AGENTS.md` is anchored out of both globs |
| **K9b** | Numeric claims in docs match generated reality (today: the golden row count stated in the tracking-ingester README and its spec vs the actual data rows of `golden/labeled.tsv`) |
| **K10** | Every relative `.md` link in `README.md`, `DOCS/**`, `services/*/README.md` and `packages/*/README.md` resolves. Fenced blocks and inline code spans are skipped; anchors resolve to the file part |
| **K11** | Every service whose source calls `resolveStorageEngine()` documents `DB_ENGINE`/`STORAGE_ENGINE` in its README. The service set is discovered from the code, not hardcoded |

`K6a`–`K6f`, `K7`, `K8` and `K9` (type-only DI imports) are described in
[doc-code validation tests](./guides/doc-code-validation-tests.md).

```bash
scripts/checks/doc-code-guards.sh       # quiet: failures only
scripts/checks/doc-code-guards.sh -v    # verbose: also prints PASS lines
```

### Service Architecture & Integration

| Document | Purpose | Audience |
|----------|---------|----------|
| [Platform Architecture](./architecture/overview.md) | High-level service boundaries and ownership model | All developers |
| [Infrastructure and Deployment](./architecture/infrastructure.md) | Support services, deployment models, overlays, and scaling | DevOps/Platform engineers |
| [NATS and JetStream](./messaging/service-bus.md) | Canonical messaging topology, subjects, and envelope contract | Backend/platform engineers |
| [Workflow Engine](./workflows/engine.md) | Trigger bridge, action dispatch, and task queue model | Automation developers |
| [Agent Execution Flow](./agents/execution.md) | `agentCall` lifecycle from workflow to runtime and back | Automation/AI developers |
| [Long-Running Agent Executions](./agents/long-running-executions.md) | The async submit/poll contract for agents that take minutes, the timeout budgets, the serial per-tenant consumer caveat, and how the e2e proves it | Feature implementers |
| [UI Flows](./guides/ui-flows.md) | Admin and messaging console flows mapped to backend services | Frontend/full-stack developers |
| [Connector Runtime vs Workflow Service](./workflows/connector-vs-workflow.md) | Decision matrix and when to use each service with scenario walkthroughs, including invoking connectors directly from hosted-service code via `connectors.invoke()` | Feature implementers |
| [Workflow Telegram Sequence](./channels/telegram-sequence.md) | Concrete Telegram inbound flow with hosted + agent branches | All developers |
| [Common Patterns](./workflows/patterns.md) | Practical pseudocode recipes for 10 common use cases | All developers |
| [Developer Onboarding Guide](./guides/onboarding.md) | Setup, navigation, common tasks, debugging, testing | New team members |
| [Service Architecture Diagrams](./architecture/overview.md) | Visual reference for service boundaries, data flow, scaling, and multi-tenancy patterns (diagrams folded into overview) | All developers |
| [Adapter Tools](./agents/adapter-tools.md) | Connector tooling and helper references | Feature implementers |
| [AGENTS.md](../AGENTS.md) | The repository constitution — rules, binding styles, review standards | All contributors |

### Specialized Documentation

| Folder | Contents |
|--------|----------|
| [`skb/`](./skb/) | Structured Knowledge Base subsystem — [architecture](./skb/architecture.md), [API](./skb/api.md), [runbook](./skb/runbook.md), [security](./skb/security.md) |
| [`runbooks/`](./runbooks/) | Operations — [Temporal](./runbooks/temporal.md), [storage engines](./runbooks/storage-engines.md); historical migration runbooks archived at [`runbooks/archive/`](./runbooks/archive/) |
| [`adr/`](./adr/) | Architecture decision records — [RAG system](./adr/rag-system.md), [variable system](./adr/variable-system.md), [agent improvements](./adr/agent-architecture-improvements.md), [connector-runtime separation](./adr/connector-runtime-separation.md), [tenant Postgres model](./adr/tenant-postgres-model.md), [Temporal + NATS](./adr/temporal-and-nats.md). The `D<n>` ↔ ADR relationship is explained in [decision-log.md](./architecture/decision-log.md) |
| [`reference/`](./reference/) | Technical references — [AI SDK](./reference/ai-sdk.md) |

### New Documentation Folders

| Folder | Contents |
|--------|----------|
| [`messaging/`](./messaging/) | Messaging layer — service bus topology, envelope contract, claim-check, ingress bridge |
| [`channels/`](./channels/) | Channel integration — Telegram sequence, channel-service pipeline, Instagram, Meta provider pattern |
| [`agents/`](./agents/) | Agent runtime — execution flow, long-running executions (`agents/long-running-executions.md`), adapter tools, memory management (`agents/memory.md`), scheduled jobs (`agents/jobs.md`) |

### Service READMEs

| Service | Purpose | Type |
|---------|---------|------|
| [API Gateway](../services/api-gateway/README.md) | External HTTP entry point and proxy layer | Core service |
| [Auth Service](../services/auth-service/README.md) | JWT issuance, platform users, tenant users, clients, and public routes | Core service |
| [Tenant Service](../services/tenant-service/README.md) | Tenant lifecycle, namespace/data provisioning, and per-tenant stream setup | Core service |
| [Connector Runtime](../services/connector-runtime/README.md) | Standalone Temporal worker for high-concurrency HTTP execution with connector-driven config | Core service |
| [Connector Admin](../services/connector-admin/README.md) | Multi-tenant HTTP connector configuration API (base URL, auth, headers, timeouts, retries) | Core service |
| [Workflow Service](../services/workflow-service/README.md) | REST API + Temporal orchestrator for multi-step workflows with state management | Core service |
| [Channel Service](../services/channel-service/README.md) | Channel accounts, ingress/egress, auto-reply, usage reads | Core service |
| [Audit Service](../services/audit-service/README.md) | Four independent audit trails per tenant + causal-chain reads | Core service |
| [Registry Service](../services/registry-service/README.md) | Knative service registry, routes, canary deployments | Core service |
| [Proxy Service](../services/proxy-service/README.md) | Generic / ySocial / yFlow HTTP passthrough | Core service |
| [Cache Service](../services/cache-service/README.md) | Two-tier L1 `Map` + L2 Redis cache API | Core service |
| [Usage Aggregator](../services/usage-aggregator-service/README.md) | Channel + connector usage rows from the bus | Core service |
| [Tracking Ingester](../services/tracking-ingester-service/README.md) | Bus→Postgres message tracking and chain/run/payload reads | Core service |
| [Provisioning Service](../services/provisioning-service/README.md) | Declarative manifest apply + secrets broker | Core service |
| [Admin Console](../services/admin-console/README.md) | Angular operator console | Frontend |
| [Agent Admin Service](../services/agent-admin-service/README.md) | Agent/job/config, skills, MCP servers, knowledge bases, SKB | AI service |
| [Agent Memory Service](../services/agent-memory-service/README.md) | Long-term agent memory and retrieval backend | AI service |
| [Agent Scheduler Service](../services/agent-scheduler-service/README.md) | Cron/interval scheduler for agent jobs | AI service |
| [Agent AI Service](../services/agent-ai-service/README.md) | AI agent runtime and LLM/tool execution | AI service |
| [AI Agent Gateway](../services/ai-agent-gateway/README.md) | Async execution gateway for agent runtime requests | AI service |

### Package READMEs

| Package | Purpose |
|---------|---------|
| [`@yoizen/shared`](../packages/shared/README.md) | Cross-service types, constants, schema DDL, `AdapterClient`, circuit breaker |
| [`@yoizen/database`](../packages/database/README.md) | Postgres/Mongo/Redis/NATS plumbing, per-tenant connections, durable-consumer semantics (`DEFAULT_ACK_WAIT_MS`) |
| [`@yoizen/observability`](../packages/observability/README.md) | Logging, tracing, metrics, and the api/worker bootstrap split |
| [`@yoizen/testing`](../packages/testing/README.md) | Shared Mongo/postgres.js test doubles |
| [`@yoizen/angular-shared`](../packages/angular-shared/README.md) | Angular console auth layer (interceptors, guard, `BaseAuthService`) |

For the build/rollout inventory, treat [`../services.conf`](../services.conf)
as the source of truth. It includes `agent-memory-service` and
`agent-scheduler-service` in addition to the core platform services.

### Samples and examples

Runnable examples live in three tiers under the repo root, each with one reason
to exist: [`sdk/examples/`](../sdk/examples/README.md) (SDK API-surface
examples), [`integrations/`](../integrations/README.md) (end-to-end platform
feature references, provisioned declaratively through the SDK), and
[`demos/`](../demos/README.md) (commercial showcases). See
`sdk/README.md` "Samples & examples" for the same map from the SDK's side.

## Architecture Overview

### Focused Runtime Sequences

- [`channels/telegram-sequence.md`](./channels/telegram-sequence.md) — concrete Telegram inbound flow split into shared ingress plus two execution branches: simple hosted service call and YoizenClaw `agentCall`.

```
┌───────────────────────────────────────────────────────────────────────┐
│  Kubernetes Cluster (OrbStack)                                        │
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
│  │  │  agent-admin-service · agent-ai-service · ai-agent-gateway │  │  │
│  │  │  agent-memory-service · agent-scheduler-service            │  │  │
│  │  │  usage-aggregator-service · proxy-service · admin-console  │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌─ support-services-{env} (StatefulSets / Deployments) ─────┐  │  │
│  │  │  NATS JetStream · Redis 7 · PostgreSQL 17 · Temporal       │  │  │
│  │  └────────────────────────────────────────────────────────────┘  │  │
│  │                                                                 │  │
│  │  ┌─ {tenant}-{env}-ns (Per-Tenant Namespaces) ───────────────┐  │  │
│  │  │  postgres ExternalName → shared CNPG (tier: shared)        │  │  │
│  │  │  PostgreSQL StatefulSet (tier: dedicated only)             │  │  │
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
# OrbStack
kubectl apply -k infrastructure/overlays/orbstack/dev
kubectl apply -k knative/services/overlays/local/postgres-dev   # or mongo-dev with STORAGE_ENGINE=mongo
```

### Components

| Component | Type | Description |
|---|---|---|
| **API Gateway** | Knative Service | HTTP entry point with JWT auth, input validation, SSE streaming, dynamic tenant routing, proxies to all downstream services |
| **Auth Service** | Knative Service | JWT token generation (client credentials + user login), user/client management, dynamic public routes, Redis-synced route cache |
| **Audit Service** | Knative Service | Independent NATS consumer that persists every event to per-tenant PostgreSQL. Exposes paginated query API |
| **Cache Service** | Knative Service | CRUD API with L1 in-memory + L2 Redis cache-aside pattern |
| **Channel Service** | Knative Service | Multi-tenant messaging channel configuration and inbound webhook ingress |
| **Tenant Service** | Knative Service | Environment-scoped tenant namespace management. Provisions PostgreSQL (shared CNPG logical DB for `shared` tier, StatefulSet for `dedicated` tier) and NATS streams |
| **Registry Service** | Knative Service | Knative-based service registry with route management, canary deployments, and traffic splitting |
| **Workflow Service** | Knative Service | REST API + Temporal orchestrator for multi-step workflows (start, status, list) |
| **Workflow Worker** | Deployment (plain, fixed replicas) | Temporal orchestrator worker executing JS functions and NATS service bus activities |
| **Connector Admin** | Knative Service | Manages multi-tenant HTTP connector configurations (base URL, auth, headers, timeouts, retries) and their endpoints. Consumed via `AdapterClient` by `connector-runtime` |
| **Connector Runtime** | Deployment (plain, fixed replicas) | Generic Temporal HTTP execution worker for `endpointCall` and `serviceCall`; uses `tracedFetch`, connector resolution, response caching, and internal service mirror lookup |
| **Agent Admin Service** | Knative Service | Authoring API for AI agents/workflows (config-only persistence) |
| **Agent Memory Service** | Knative Service | Per-agent conversation/long-term memory storage and retrieval |
| **Agent Scheduler Service** | Knative Service | Schedules and dispatches recurring/one-off agent jobs |
| **AI Agent Gateway** | Knative Service | Stateless inbound bridge that fans out execution requests to the platform-tier `agent-ai-service` Knative Service |
| **Agent AI Service** | Knative Service | Platform-tier agent execution runtime (single deployment shared across all tenants) |
| **Usage Aggregator Service** | Knative Service | Aggregates per-tenant usage events into the usage Postgres |
| **Proxy Service** | Knative Service | Egress proxy for tenant-bound HTTP traffic |
| **Admin Console** | Knative Service | Angular admin UI |
| **NATS JetStream** | StatefulSet | Persistent event streaming backbone with 7-day retention. Per-tenant streams: `INGRESS-<tenant>` (`evt.<tenant>.>`), `DLQ-<tenant>` (`dlq.<tenant>.>`), `PAYLOAD-<tenant>` Object Store (claim-check). Platform-level: `GATEWAY_AUDIT`, `PLATFORM_TENANTS`. Legacy global: `DLQ` (`dlq.webhook`) |
| **Redis** | Deployment | Pure cache (no persistence, LRU eviction) |
| **PostgreSQL** | StatefulSet | Shared database for auth, registry, and connector services |
| **Temporal** | Deployment | Workflow execution engine with PostgreSQL backend and Web UI |

### Event Flow

Two-stage webhook ingress feeds durable per-tenant consumers; Temporal handles orchestration and egress:

1. **Webhook ingress**: API Gateway authenticates the request, resolves the tenant, and publishes a `webhook_received` envelope to `INGRESS-<tenant>` (`evt.<tenant>.api-gateway.messaging.…`) — returns `202 Accepted` immediately
2. **Signature verification + canonical event**: channel-service's durable consumer reads from `INGRESS-<tenant>`, verifies the provider signature, and re-publishes a normalized `ChannelEnvelope` back to `INGRESS-<tenant>` (`evt.<tenant>.channel-service.messaging.…`)
3. **Durable fan-out**: all services attach durable consumers to `INGRESS-<tenant>` — audit-service persists every event to per-tenant PostgreSQL; workflow-triggers starts Temporal workflows; usage-aggregator records usage; agent-ai-service drives AI executions
4. **Orchestration**: Temporal workers (`workflow-service-worker`) execute JS functions locally and dispatch HTTP/agent activities to `connector-runtime` via the `connector-runtime` task queue
5. **Egress**: channel-service publishes outbound messages (e.g. Telegram replies) back through the provider API
6. **Claim-check**: payloads above 256 KB are stored in `PAYLOAD-<tenant>` Object Store; the consumer middleware resolves them transparently before the handler is called

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

Temporal-based workflow orchestration supports eight action types:

| Action | Execution | Description |
|--------|-----------|-------------|
| `endpointCall` | Remote (`connector-runtime`) | HTTP request via `tracedFetch`; supports connector-driven config resolution via `adapterId`/`endpointId` |
| `serviceCall` | Remote (`connector-runtime`) | Internal service call resolved against the registry mirror |
| `jsFunction` | Local (workflow-worker) | Inline JS evaluation |
| `serviceBusCall` | Local (workflow-worker) | NATS publish with tenant header |
| `channelSend` | Local (workflow-worker) | Outbound channel message via channel-service |
| `agentCall` | Remote (`connector-runtime`) | HTTP call to `agent-ai-service` chat endpoint |
| `branch` | Workflow-level | Parallel execution of sub-action branches |
| `conditional` | Workflow-level | Evaluates branches in order; first match executes |

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
2. PostgreSQL: shared-tier tenants get a logical database on the shared CNPG cluster with an `ExternalName` Service named `postgres` in the tenant namespace; dedicated-tier tenants get a per-tenant StatefulSet
3. NATS ingress stream (`INGRESS-<TENANT>`) ensured before any runtime consumers attach
4. Services connect to tenant PostgreSQL at `postgres.<tenant>-<env>-ns.svc.cluster.local`

### NATS JetStream Streams

| Stream / Bucket | Subjects | Purpose |
|---|---|---|
| `INGRESS-<tenant>` | `evt.<tenant>.>` | Canonical per-tenant event bus (producers: api-gateway, channel-service, registry-service, agent-admin-service, ai-agent-gateway) |
| `DLQ-<tenant>` | `dlq.<tenant>.>` | Per-tenant dead letters and post-processing |
| `PAYLOAD-<tenant>` | Object Store | Claim-check storage for large payloads (>256 KB); TTL 7 days, max 512 MB |
| `GATEWAY_AUDIT` | `audit.gateway.>` | API Gateway per-request audit trail |
| `PLATFORM_TENANTS` | `platform.tenant.>` | Tenant lifecycle provisioning messages (workqueue) |
| `DLQ` | `dlq.webhook` | Legacy global DLQ for webhook delivery failures (no slim-stack producer; retained for ops replay) |

| Setting | Value |
|---|---|
| `retention` | Limits |
| `max_age` | 7 days (free tier) |
| `max_bytes` | 256 MB per ingress stream (free tier); 512 MB Object Store |
| `max_deliver` | 5 |

### Shared Types Package

The `packages/shared/` package (`@yoizen/shared`) contains all cross-service types and constants:

- **Event interfaces**: `EventEnvelope`, `EventTransport`, `EventData`, `ChannelEnvelope`, `WebhookIngressEnvelope`
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
| [OrbStack](https://orbstack.dev/) | >= 1.6 | Local cluster |

## Quick Start

### OrbStack

1. Enable Kubernetes in OrbStack: **Settings → Kubernetes → Enable Kubernetes**
2. Run:

```bash
./bootstrap-orbstack-osx.sh
```

This script will:
1. Switch kubectl context to `orbstack`
2. Install Knative Serving + Kourier networking layer
3. Deploy NATS JetStream, Redis, PostgreSQL, and Temporal using the `orbstack` overlay (StorageClass: `local-path`)
4. Build service Docker images (OrbStack shares the local Docker daemon with the cluster — no extra configuration needed)
5. Deploy Knative Services to `platform-services-dev`

> **Note on PVCs from other clusters**: if you apply manifests originally designed for Minikube, EKS, GKE, or AKS that hardcode a `storageClassName` (`standard`, `gp2`, `gp3`, `standard-rwo`, `managed-premium`), the OrbStack overlay registers those as aliases for `rancher.io/local-path` so PVCs bind correctly without modifying the original YAMLs.

## Project Structure

```
Arch/
├── bootstrap-orbstack-osx.sh        # One-command setup (OrbStack)
├── scripts/
│   └── smoke-test.sh                # kubectl readiness preflight for all Knative services and Deployments
├── packages/
│   └── shared/                      # @yoizen/shared — cross-service types and constants
│       └── src/
│           ├── constants.ts          # Stream names, key prefixes, TTLs, task queues, Knative API
│           ├── interfaces.ts         # EventEnvelope, EventTransport, EventData
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
│       ├── local/                    # Minikube overlays (dev-only)
│       │   ├── namespaces.yaml       # Namespace definitions
│       │   ├── local-base/           # Shared patches (resource limits)
│       │   └── dev/                  # namespace: support-services-dev
│       └── orbstack/                 # OrbStack overlays (dev-only)
│           ├── storage-class-compat.yaml  # Aliases: standard/gp2/gp3/… → local-path
│           ├── namespaces.yaml       # Namespace definitions
│           ├── orbstack-base/        # Shared patches (resource limits + storageClassName)
│           └── dev/
├── knative/
│   ├── serving/                      # Autoscaler ConfigMap
│   └── services/
│       ├── base/                     # Service YAMLs
│       ├── rbac/                     # ClusterRole + per-env ClusterRoleBindings
│       └── overlays/
│           └── local/                # dev overlay with env patches
├── services/                          # Application source code
│   ├── api-gateway/                   # NestJS + Fastify — HTTP entry point, auth, dynamic routing
│   ├── auth-service/                  # NestJS + Fastify — JWT auth, users, clients, public routes
│   ├── audit-service/                 # NestJS + Fastify — NATS consumer, per-tenant PostgreSQL
│   ├── cache-service/                 # NestJS + Fastify — L1/L2 cache API
│   ├── channel-service/               # NestJS + Fastify — Messaging channel config + inbound webhooks
│   ├── tenant-service/                # NestJS + Fastify — K8s namespace + PostgreSQL + NATS provisioning
│   ├── registry-service/              # NestJS + Fastify — Knative service registry + canary
│   ├── connector-admin/               # NestJS + Fastify — Multi-tenant HTTP connector config + endpoints
│   ├── connector-runtime/             # Standalone Temporal worker — generic HTTP execution (connector-aware)
│   ├── workflow-service/              # NestJS + Fastify + Temporal — Workflow API + worker
│   ├── usage-aggregator-service/      # NestJS + Fastify — Per-tenant usage aggregation
│   ├── proxy-service/                 # NestJS + Fastify — Tenant egress proxy
│   ├── admin-console/                 # Angular admin UI
│   ├── agent-admin-service/           # NestJS + Fastify — Agent authoring API
│   ├── agent-memory-service/          # NestJS + Fastify — Per-agent conversation/long-term memory
│   ├── agent-scheduler-service/       # NestJS + Fastify — Multi-tenant agent job scheduling
│   ├── ai-agent-gateway/              # NestJS + Fastify — Stateless inbound bridge to agent-ai-service
│   └── agent-ai-service/              # NestJS + Fastify — Platform-tier agent execution runtime (Knative Service)
└── setup-tenant.sh                    # Create tenant + admin user (named flags, idempotent)
```

## Manual Operations

### Apply infrastructure only

```bash
kubectl apply -k infrastructure/overlays/orbstack/dev
```

### Apply Knative services only

```bash
kubectl apply -k knative/serving
kubectl apply -k knative/services/overlays/local/dev
```

### Build images (OrbStack)

OrbStack >= 1.6 shares the local Docker daemon with the cluster — just build normally:

```bash
for svc in api-gateway auth-service audit-service cache-service channel-service tenant-service registry-service connector-admin connector-runtime workflow-service usage-aggregator-service proxy-service agent-admin-service agent-memory-service agent-scheduler-service ai-agent-gateway agent-ai-service; do
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

### Readiness preflight (full cluster)

```bash
# Against the running cluster
bash scripts/smoke-test.sh
```

The smoke test is a kubectl-based readiness preflight — it checks that all Knative services and plain Deployments are ready. It does not execute HTTP-level tests.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Networking layer | Kourier | ~10x less resources than Istio, sufficient for local/dev |
| Event transport | NATS JetStream (direct) | Lower latency than Knative Eventing, full control over streams/consumers |
| Event processing | Pluggable handler registry | New event types added by creating a handler class — no core changes |
| Enrichment pipeline | Ordered stages (ajv + metadata + transform) | Separates cross-cutting concerns from handler logic |
| Per-tenant stream design | `INGRESS-<tenant>` + `DLQ-<tenant>` + `PAYLOAD-<tenant>` | Full tenant isolation; prevents subject overlap; claim-check keeps envelopes slim |
| Authentication | JWT via `jose` (HS256) | Stateless, minimal overhead; argon2id for password storage |
| Tenant isolation | Per-tenant logical DB on shared CNPG (`shared` tier) or dedicated StatefulSet (`dedicated` tier) | Logical isolation covers most tenants; physical isolation available on demand |
| Workflow engine | Temporal | Durable, retryable, language-agnostic workflow orchestration |
| Job scheduling | In-process Temporal + K8s Jobs | Lightweight for inline JS; K8s Jobs for isolated docker execution |
| Service registry | Knative + PostgreSQL | Leverages Knative for autoscaling; PostgreSQL for route/canary state |
| Dynamic routing | Gateway poll + prefix matching | Decoupled from registry; 15s eventual consistency is acceptable |
| HTTP framework | Fastify | 2-3x faster than Express for NestJS |
| Cache client | ioredis | Better pipelining, cluster support, and benchmark performance |
| IaC format | Kustomize | Native to kubectl, zero external dependencies |
| HTTP adapters | Shared `AdapterClient` with Redis SWR cache | Centralizes auth, headers, retries, and timeouts; stale-while-revalidate avoids blocking on cache miss |
| Developer mode | Single `dev` environment only | qa/staging/production overlays removed; KEDA removed in favor of fixed-replica Deployments for workers |

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
- **Orchestration**: Kubernetes (OrbStack)
- **Serverless**: Knative Serving + Kourier
- **IaC**: Kustomize (base + per-environment overlays)
