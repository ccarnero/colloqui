# Developer Onboarding Guide

Welcome to the Yoizen platform! This guide walks you through understanding and working with the slim-stack `connector-runtime` and `workflow-service` architecture.

## Start Here: Reading Order

1. **[This guide]** — You are here
2. [Platform Architecture](../architecture/overview.md) — High-level system map
3. [NATS and JetStream](../messaging/service-bus.md) — Messaging topology and envelope contract
4. [Workflow Engine](../workflows/engine.md) — Trigger bridge and action dispatch
5. [Agent Execution Flow](../agents/execution.md) — `agentCall` runtime lifecycle
6. [UI Flows](./ui-flows.md) — Console-to-backend flow mapping
7. [Connector Runtime vs Workflow Service](../workflows/connector-vs-workflow.md) — Decision guide
8. [Common Patterns](../workflows/patterns.md) — Practical recipes
9. [Connector Runtime README](../../services/connector-runtime/README.md) — Detailed service docs
10. [Connector Admin README](../../services/connector-admin/README.md) — Connector configuration API
11. [Workflow Service README](../../services/workflow-service/README.md) — Orchestration docs
12. [@yoizen/shared Package](../../packages/shared/src/index.ts) — Type reference

**Estimated time**: 2-3 hours for complete understanding

---

## 30-Second Overview

The Yoizen platform executes automated workflows and HTTP integrations:

**Connector Runtime** — Standalone Temporal worker that executes HTTP requests at high concurrency (200 parallel). Used for single HTTP calls or as an activity within workflows.

**Connector Admin** — REST API that owns multi-tenant connector configurations (base URL, auth, headers, timeouts, retries) consumed by `connector-runtime`.

**Workflow Service** — REST API + Temporal orchestrator that chains HTTP calls, JavaScript, messaging, and AI agents into multi-step workflows with state management.

All services are multi-tenant and store data in per-tenant Postgres instances.

---

## Prerequisites

### Required Knowledge

- **TypeScript/JavaScript** — Services written in Bun/TypeScript
- **Docker** — All services containerized
- **Kubernetes basics** — Deployed on K8s with Kustomize
- **REST APIs** — Both services expose HTTP endpoints
- **Temporal concepts** — Workflow orchestration engine (read: [What is Temporal?](https://temporal.io/))

### Development Environment Setup

```bash
# Clone repository
git clone <repo-url>
cd platform-cluster

# Install dependencies
pnpm install

# Bring up the full dev cluster (OrbStack — recommended on macOS)
./bootstrap-orbstack-osx.sh

# Bootstrap writes /etc/hosts — verify services are accessible
curl http://api-gateway.platform-services-dev.dev.local/health
```

Access:
- API Gateway: `http://api-gateway.platform-services-dev.dev.local`
- Admin Console: `http://admin-console.platform-services-dev.dev.local`
- Temporal UI: `kubectl port-forward -n support-services-dev svc/temporal-ui 8233:80`
- Grafana: `kubectl port-forward -n support-services-dev svc/grafana 3001:3000`

---

## Core Concepts

### Multi-Tenancy

Every request includes a tenant identifier in the `x-yoizen-tenant` header:

```bash
curl -H "x-yoizen-tenant: acme" \
  http://localhost:3000/workflows
```

**Why multi-tenant?**
- Each customer (tenant) has isolated data
- Workflows, adapters, and audit logs stored in tenant's own database
- NATS subjects include tenant ID
- No cross-tenant data leakage possible

**Implementation**:
- **Header**: `x-yoizen-tenant` propagated through all layers
- **Database**: Each tenant has Postgres instance at `postgres.{tenantId}-{env}-ns.svc.cluster.local`
- **Temporal**: Search attribute `TenantId` used to query tenant workflows
- **Cache**: Redis keys prefixed with tenant scope

### Temporal Task Queues

Services register Temporal workers on specific task queues:

```
WORKFLOW_ORCHESTRATOR_TASK_QUEUE = "workflow-orchestrator"
  ↓ workflow-service-worker listens here
  ↓ Executes: workflow orchestration, local activities

CONNECTOR_RUNTIME_TASK_QUEUE = "connector-runtime"
  ↓ connector-runtime worker listens here
  ↓ Executes: HTTP endpoint calls, service calls
```

Each queue scales independently. In developer mode all workers run at a fixed replica count of 1.

### Connector-Driven Configuration

Connectors are reusable configurations for external APIs (managed by `connector-admin`):

```
Connector: crm-connector
├── baseUrl: https://crm.example.com/api
├── auth: OAuth2 client credentials
├── headers: { "X-API-Key": "..." }
├── timeout: 45000
├── retries: 3
└── endpoints:
    ├── getCustomer: GET /customers/{id}
    ├── createLead: POST /leads
    └── updateAccount: PUT /accounts/{id}
```

**Benefits**:
- Centralized configuration (`connector-admin`)
- Cached in Redis for performance (`AdapterClient` SWR)
- Reusable across workflows
- Decouples caller from implementation details

---

## Exploring the Codebase

### Service Structure

Each service follows this pattern:

```
services/{service}/
├── README.md                    # Start here
├── AGENTS.md                    # Architecture details
├── package.json                 # Bun dependencies
├── src/
│   ├── main.ts                  # NestJS bootstrap (if API server)
│   ├── temporal/
│   │   ├── workflows.ts         # Workflow definitions
│   │   ├── activities/          # Activity implementations
│   │   └── worker.ts            # Temporal worker bootstrap
│   └── modules/                 # NestJS modules (if API server)
└── test/
    └── unit/                    # Unit tests
```

### Navigating Connector Runtime

```
services/connector-runtime/
├── README.md
├── src/
│   ├── worker.ts               # Main entry: Temporal worker + health server
│   ├── activities/
│   │   ├── endpoint-call.activity.ts     # HTTP execution
│   │   ├── service-call.activity.ts      # Internal service calls
│   │   └── _shared/
│   │       ├── adapter-client.provider.ts  # AdapterClient (Redis cache)
│   │       ├── breaker.ts                # Circuit breaker
│   │       ├── http-call-with-retry.ts   # Retry logic
│   │       └── metrics.ts                # Metrics collection
```

**Key files to understand**:
1. `worker.ts` — How Temporal worker is set up
2. `endpoint-call.activity.ts` — HTTP execution logic
3. `_shared/adapter-client.provider.ts` — Adapter resolution

### Navigating Workflow Service

```
services/workflow-service/
├── README.md
├── src/
│   ├── main.ts                  # NestJS + Fastify bootstrap
│   ├── temporal/
│   │   ├── workflows.ts         # runWorkflow definition
│   │   ├── activities/          # Local activities
│   │   └── worker.ts            # Temporal worker bootstrap
│   ├── modules/
│   │   ├── workflows/           # Workflow REST API
│   │   └── health/              # Health checks
│   └── providers/
│       ├── temporal.provider.ts  # Temporal client setup
│       └── tenant-connection-manager.ts  # Per-tenant DB pools
```

**Key files to understand**:
1. `temporal/workflows.ts` — Workflow orchestration engine
2. `modules/workflows/workflows.controller.ts` — REST API endpoints
3. `providers/tenant-connection-manager.ts` — Multi-tenancy

### Shared Package

```
packages/shared/
├── src/
│   ├── index.ts                 # Barrel export
│   ├── constants.ts             # Temporal queues, NATS streams, Redis keys
│   ├── interfaces.ts            # Event types
│   ├── workflow.interfaces.ts   # Workflow action types
│   ├── http-execution.interfaces.ts  # HTTP request/response types
│   ├── adapter.interfaces.ts    # Adapter configuration types
│   ├── auth.interfaces.ts       # JWT and token types
│   ├── adapter-client.ts        # Runtime adapter resolution
│   └── [other files...]
```

**Most important files**:
1. `constants.ts` — All service constants (read this first)
2. `workflow.interfaces.ts` — All action types
3. `http-execution.interfaces.ts` — HTTP shapes

---

## Common Development Tasks

### Task 1: Run Connector Runtime Locally

```bash
cd services/connector-runtime

# Install dependencies
pnpm install

# Start worker
bun run start:dev

# In another terminal, check health
curl http://localhost:3000

# See logs
tail -f logs/worker.log
```

**What's running**:
- Temporal worker on `connector-runtime` task queue
- Health server on port 3000
- Connected to local Temporal broker

### Task 2: Run Workflow Service Locally

```bash
cd services/workflow-service

# Install dependencies
pnpm install

# Terminal 1: API server
bun run start:dev

# Terminal 2: Worker (in parallel)
bun run start:worker:dev

# Terminal 3: Test
curl -X POST http://localhost:3000/workflows \
  -H "x-yoizen-tenant: acme" \
  -H "Content-Type: application/json" \
  -d @- <<EOF
{
  "name": "testWorkflow",
  "application": "test",
  "actions": [
    {
      "activity": "jsFunction",
      "name": "hello",
      "args": {
        "code": "return { message: 'Hello World' }"
      }
    }
  ]
}
EOF
```

**What's running**:
- NestJS API server on port 3000
- Temporal orchestrator worker on `workflow-orchestrator` queue
- Connected to local Temporal, NATS, and tenant Postgres (shared CNPG logical DB for `shared`-tier tenants)

### Task 3: Add a New Action Type

Workflow Service supports 8 action types (`endpointCall`, `serviceCall`, `jsFunction`, `serviceBusCall`, `channelSend`, `agentCall`, `branch`, `conditional`). To add a 9th:

1. **Define interface** in `packages/shared/src/workflow.interfaces.ts`:
   ```typescript
   interface MyActionAction {
     activity: "myAction"
     name: string
     args: {
       param1: string
       param2?: number
     }
   }
   ```

2. **Add to union** in same file:
   ```typescript
   type WorkflowAction = 
     | EndpointCallAction
      | ... (6 existing types)
     | MyActionAction  // New
   ```

3. **Implement activity** in `services/workflow-service/src/temporal/activities/my-action.activity.ts`:
   ```typescript
   export const executeMyAction = async (args: MyActionAction["args"]) => {
     // Your logic here
     return { result: "success" }
   }
   ```

4. **Export from barrel** in `src/temporal/activities/index.ts`:
   ```typescript
   export { executeMyAction } from "./my-action.activity"
   ```

5. **Add case to switch** in `src/temporal/workflows.ts`:
   ```typescript
   case "myAction":
     result = await executeMyAction(action.args)
     break
   ```

6. **Update README** with action documentation

### Task 4: Add a New Connector Integration

Connectors are managed by `connector-admin` and consumed by `connector-runtime`:

1. **Create connector** in `connector-admin` (proxied by the gateway as `/api/connectors`):
   ```bash
   POST /api/connectors
   {
     "name": "my-api-connector",
     "baseUrl": "https://api.example.com",
     "auth": { "type": "bearer", "token": "..." },
     "endpoints": [
       { "id": "getUser", "path": "/users/{id}" },
       ...
     ]
   }
   ```

2. **Call from workflow** with the connector ID:
   ```typescript
   {
     activity: "endpointCall",
     name: "fetchData",
     args: {
       adapterId: "my-api-connector",
       endpointId: "getUser",
       params: { id: "123" }
     }
   }
   ```

3. **Test locally**:
   ```bash
   curl -X POST http://localhost:3000/workflows \
     -H "x-yoizen-tenant: local-test" \
     -d '{ "name": "connector-smoke", "application": "onboarding", "actions": [{ "activity": "endpointCall", "name": "fetchData", "args": { "adapterId": "my-api-connector", "endpointId": "getUser" } }] }'
   ```

### Task 5: Query Workflows in Temporal Web UI

1. Run `kubectl port-forward -n support-services-dev svc/temporal-ui 8233:80`
2. Open http://localhost:8233 (Temporal Web UI)
2. Go to "Workflows" tab
3. Select namespace (default `default`)
4. Search by workflow ID: `{tenantId}:*` (e.g., `acme:*`)
5. Click workflow to see:
   - Execution timeline
   - Action results
   - Errors and retries

---

## Debugging Tips

### Enable Debug Logging

```bash
# Connector Runtime
LOG_LEVEL=debug bun run start:dev

# Workflow Service
LOG_LEVEL=debug bun run start:dev   # API
LOG_LEVEL=debug bun run start:worker:dev  # Worker
```

Watch for:
- `[adapter-client]` — Adapter config resolution
- `[http-call]` — HTTP execution and retries
- `[template-resolution]` — Template variable substitution
- `[circuit-breaker]` — Circuit breaker state changes
- `[workflow-execute]` — Action execution

### Check Service Health

```bash
# Connector Runtime
curl http://localhost:3000

# Workflow Service API
curl http://localhost:3000/health

# Check Temporal connectivity
curl http://localhost:7233/health
```

### Inspect Connector Cache

```bash
# Connect to Redis
redis-cli

# List connector cache keys
KEYS "adapter:*"

# Get specific connector config
GET "adapter:acme:crm-connector"

# Delete cache (force refresh)
DEL "adapter:acme:crm-connector"
```

### Monitor Task Queue Depth

```bash
# In Temporal Web UI: Task Queues tab
# Or via tctl CLI:
tctl taskqueue describe -t connector-runtime
tctl taskqueue describe -t workflow-orchestrator
```

### Test Connector Runtime Activity Directly

```bash
# Use Temporal CLI to dispatch activity
tctl workflow execute \
  --wf-type runWorkflow \
  --wf-id test-123 \
  --input '{...}'
```

---

## Testing

### Unit Tests

```bash
cd services/connector-runtime
bun test test/unit    # Run all unit tests
bun test              # Run with coverage
```

### Integration Tests

```bash
cd services/workflow-service
# Note: No in-service integration tests; use local bootstrap instead
# Run against local services:
bun run start:dev &
bun run start:worker:dev &
# Then run workflow via HTTP
curl -X POST http://localhost:3000/workflows ...
```

### Manual Testing via REST

```bash
# Start workflow
WF_ID=$(curl -s -X POST http://localhost:3000/workflows \
  -H "x-yoizen-tenant: test-tenant" \
  -d '...' | jq -r '.workflowId')

# Poll for result
curl http://localhost:3000/workflows/$WF_ID \
  -H "x-yoizen-tenant: test-tenant"

# List all workflows
curl http://localhost:3000/workflows \
  -H "x-yoizen-tenant: test-tenant"
```

---

## Performance & Scaling

### Local Development Performance

| Operation | Expected Time |
|-----------|----------------|
| HTTP call via connector-runtime | 50-150ms |
| Workflow with 1 action | 100-300ms |
| Workflow with 3 actions | 300-600ms |
| Parallel branch (2 branches) | 150-300ms (concurrent) |

### Scaling (Developer Mode)

Developer mode runs all Deployments at a fixed **1 replica** (no KEDA, no
scale-to-zero). All Knative Services are pinned to `minScale: 1, maxScale: 1`.

For future production deployments:
- **Connector Runtime**: max 200 concurrent activities per replica; KEDA can scale 1-20 based on task queue depth.
- **Workflow Service API**: Knative request-based autoscaling; Worker would use KEDA.
- KEDA ScaledObjects are not currently in the codebase — they would need to be re-added for production scale.

---

## Architecture Decision Records (ADRs)

### Why connector-runtime is separate

**Decision**: Split connector configuration (`connector-admin`) from connector execution (`connector-runtime`).

**Rationale**:
- Configuration ownership and execution have very different scaling profiles: `connector-admin` is a low-volume CRUD API, while `connector-runtime` is a network-bound, high-concurrency Temporal worker (200 parallel).
- Separate task queues allow `connector-runtime` to scale independently via KEDA without affecting the admin API.
- The runtime exposes generic HTTP execution activities (`endpointCall`, `serviceCall`) that are reusable by any Temporal client, not just the workflow service.
- `connector-admin` owns multi-tenant config + credentials and the registry-driven internal-sync surface; keeping that out of the worker minimises blast radius for execution-side incidents.

**Tradeoff**: Two-hop dispatch (workflow → `connector-runtime` → external HTTP) adds latency vs. inline HTTP calls.

**Mitigation**: For latency-sensitive integrations, call `connector-runtime` directly via Temporal client instead of going through `workflow-service`.

### Tenant Postgres Model

**Decision**: Two-tier isolation model — `shared` tier uses a logical database on the shared CloudNativePG cluster (`postgres-shared`), accessed via an `ExternalName` Service in the tenant namespace; `dedicated` tier gets a per-tenant Postgres StatefulSet.

**Rationale**:
- `shared` tier: low operational overhead for most tenants; connection pooling via CNPG's built-in pooler
- `dedicated` tier: full physical isolation for tenants that require it (compliance, scaling, custom extensions)
- In both cases each tenant sees a `postgres` ExternalName or direct Service in their own namespace — application code is identical

**Tradeoff**: Dedicated-tier tenants add a StatefulSet per tenant; shared-tier tenants have logical (not physical) isolation

**Mitigation**: Connection management via `TenantConnectionManager`; provisioning orchestrated by `tenant-service`

### Why Temporal + NATS (not just Kafka/Event Bus)

**Decision**: Use Temporal for orchestration + NATS for events (not a single message queue).

**Rationale**:
- Temporal provides durable orchestration, retries, timeouts
- NATS provides low-latency event distribution
- Clean separation: Temporal = control flow, NATS = data flow

**Tradeoff**: Two systems to operate and monitor

**Mitigation**: Standard topology, automated via bootstrap scripts

---

## Next Steps

1. **Read the architecture diagrams** — 15 minutes
2. **Run services locally** — 30 minutes
3. **Create a test workflow** — 15 minutes
4. **Explore the code** — 1 hour
5. **Make a small change** (add logging, fix a bug) — 30 minutes

Once comfortable, pick a task from the issues backlog and contribute!

---

## Getting Help

| Question | Resource |
|----------|----------|
| How do I use the workflow service? | [Workflow Service README](../../services/workflow-service/README.md) |
| What are the action types? | [Common Patterns](../workflows/patterns.md) |
| How do I debug a failing workflow? | [Debugging Tips](#debugging-tips) |
| What's the Connector Runtime? | [Connector Runtime README](../../services/connector-runtime/README.md) |
| Where do I configure connectors? | [Connector Admin README](../../services/connector-admin/README.md) |
| How do I add a new service? | [Infrastructure and Deployment](../architecture/infrastructure.md#add-a-new-service-checklist) |
| What types should I use? | [@yoizen/shared](../../packages/shared/src/index.ts) |

---

## Further Reading

- [Temporal Documentation](https://temporal.io/docs) — Workflow orchestration concepts
- [NATS Documentation](https://docs.nats.io) — Message broker
- [Bun Documentation](https://bun.sh/docs) — JavaScript runtime
- [NestJS Documentation](https://docs.nestjs.com) — Framework for API servers
- [Kustomize User Guide](https://kubectl.docs.kubernetes.io/guides/introduction/kustomize/) — K8s config management
