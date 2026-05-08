# Developer Onboarding Guide

Welcome to the Yoizen platform! This guide walks you through understanding and working with the refactored HTTP Adapter and Workflow Service architecture.

## Start Here: Reading Order

1. **[This guide]** — You are here
2. [Service Architecture Diagrams](./SERVICE-ARCHITECTURE-DIAGRAM.md) — Visual overview
3. [HTTP Adapter vs Workflow Service](./HTTP-ADAPTER-VS-WORKFLOW-SERVICE.md) — Decision guide
4. [Common Patterns](./COMMON-PATTERNS.md) — Practical recipes
5. [HTTP Adapter README](../services/http-adapter/README.md) — Detailed service docs
6. [Workflow Service README](../services/workflow-service/README.md) — Orchestration docs
7. [@yoizen/shared Package](../packages/shared/README.md) — Type reference

**Estimated time**: 2-3 hours for complete understanding

---

## 30-Second Overview

The Yoizen platform executes automated workflows and HTTP integrations:

**HTTP Adapter** — Standalone Temporal worker that executes HTTP requests at high concurrency (200 parallel). Used for single HTTP calls or as an activity within workflows.

**Workflow Service** — REST API + Temporal orchestrator that chains HTTP calls, JavaScript, messaging, and AI agents into multi-step workflows with state management.

Both services are multi-tenant and store data in per-tenant Postgres instances.

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
bun install

# Start local Temporal server (via docker-compose or OrbStack)
./bootstrap-orbstack.sh dev

# Verify services are accessible
curl http://localhost:8080    # Temporal Web UI
curl http://localhost:4222    # NATS
curl http://localhost:6379    # Redis
```

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
  
HTTP_ADAPTER_TASK_QUEUE = "http-adapter"
  ↓ http-adapter worker listens here
  ↓ Executes: HTTP endpoint calls, service calls
```

Each queue scales independently based on task depth (via KEDA).

### Adapter-Driven Configuration

Adapters are reusable configurations for external APIs:

```
Adapter: crm-adapter
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
- Centralized configuration (adapter-service)
- Cached in Redis for performance
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

### Navigating HTTP Adapter

```
services/http-adapter/
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

### Task 1: Run HTTP Adapter Locally

```bash
cd services/http-adapter

# Install dependencies
bun install

# Start worker
bun run start:dev

# In another terminal, check health
curl http://localhost:3000

# See logs
tail -f logs/worker.log
```

**What's running**:
- Temporal worker on `http-adapter` task queue
- Health server on port 3000
- Connected to local Temporal broker

### Task 2: Run Workflow Service Locally

```bash
cd services/workflow-service

# Install dependencies
bun install

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
  "request": { "data": "test" },
  "actions": [
    {
      "type": "jsFunction",
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
- Connected to local Temporal, NATS, and per-tenant Postgres

### Task 3: Add a New Action Type

Workflow Service supports 8 action types. To add a 9th:

1. **Define interface** in `packages/shared/src/workflow.interfaces.ts`:
   ```typescript
   interface MyActionAction {
     type: "myAction"
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
     | ... (7 existing types)
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

### Task 4: Add a New Adapter Integration

Adapters are managed by `adapter-service`, but to use one in HTTP Adapter:

1. **Create adapter** in adapter-service:
   ```bash
   POST /adapters
   {
     "name": "my-api-adapter",
     "baseUrl": "https://api.example.com",
     "auth": { "type": "bearer", "token": "..." },
     "endpoints": [
       { "id": "getUser", "path": "/users/{id}" },
       ...
     ]
   }
   ```

2. **Call from workflow** with adapter ID:
   ```typescript
   {
     type: "endpointCall",
     name: "fetchData",
     args: {
       adapterId: "my-api-adapter",
       endpointId: "getUser",
       params: { id: "123" }
     }
   }
   ```

3. **Test locally**:
   ```bash
   curl -X POST http://localhost:3000/workflows \
     -H "x-yoizen-tenant: local-test" \
     -d '{ "actions": [{ "type": "endpointCall", "adapterId": "my-api-adapter", ... }] }'
   ```

### Task 5: Query Workflows in Temporal Web UI

1. Open http://localhost:8080 (Temporal Web UI)
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
# HTTP Adapter
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
# HTTP Adapter
curl http://localhost:3000

# Workflow Service API
curl http://localhost:3000/health

# Check Temporal connectivity
curl http://localhost:7233/health
```

### Inspect Adapter Cache

```bash
# Connect to Redis
redis-cli

# List adapter cache keys
KEYS "adapter:*"

# Get specific adapter config
GET "adapter:acme:crm-adapter"

# Delete cache (force refresh)
DEL "adapter:acme:crm-adapter"
```

### Monitor Task Queue Depth

```bash
# In Temporal Web UI: Task Queues tab
# Or via tctl CLI:
tctl taskqueue describe -t http-adapter
tctl taskqueue describe -t workflow-orchestrator
```

### Test HTTP Adapter Activity Directly

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
cd services/http-adapter
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
| HTTP call via http-adapter | 50-150ms |
| Workflow with 1 action | 100-300ms |
| Workflow with 3 actions | 300-600ms |
| Parallel branch (2 branches) | 150-300ms (concurrent) |

### Scaling for Production

**HTTP Adapter**:
- Max 200 concurrent activities per replica
- KEDA scales 1-20 replicas based on task queue depth
- For 1000 req/sec: 5-10 replicas recommended

**Workflow Service**:
- API: Knative scales 1-20 based on request concurrency
- Worker: KEDA scales 1-3 based on task queue depth
- For 100 workflows/sec: 2-3 replicas recommended

---

## Architecture Decision Records (ADRs)

### Why HTTP Adapter is Separate

**Decision**: Renamed `workflow-http-worker` to `http-adapter` and made it a generic HTTP execution service.

**Rationale**:
- HTTP calls are high-concurrency, network-bound (200 parallel)
- Workflow orchestration is low-concurrency, CPU-bound (100 workflows)
- Separate task queues allow independent scaling
- Generic HTTP service reusable outside workflows (event processors, webhooks)

**Tradeoff**: Two-hop dispatch (workflow → http-adapter) adds latency vs. direct HTTP calls

**Mitigation**: For latency-sensitive integrations, call http-adapter directly instead of via workflow

### Why Per-Tenant Postgres

**Decision**: Each tenant gets their own Postgres instance, not a shared platform database.

**Rationale**:
- Complete tenant isolation (no cross-tenant data leakage)
- Tenant database can scale independently
- Tenant can manage their own database (backups, migrations)
- Simpler access control (tenant access = database access)

**Tradeoff**: More database instances to manage, complex connection pooling

**Mitigation**: Connection pooling via `WorkflowTenantConnectionManager`, Postgres provided by tenant-service

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
| How do I use the workflow service? | [Workflow Service README](../services/workflow-service/README.md) |
| What are the action types? | [Common Patterns](./COMMON-PATTERNS.md) |
| How do I debug a failing workflow? | [Debugging Tips](./DEVELOPER-ONBOARDING.md#debugging-tips) |
| What's the HTTP Adapter? | [HTTP Adapter README](../services/http-adapter/README.md) |
| How do I add a new service? | [Deployment Architecture](./DEPLOYMENT-ARCHITECTURE.md#adding-a-new-service) |
| What types should I use? | [@yoizen/shared](../packages/shared/README.md) |

---

## Further Reading

- [Temporal Documentation](https://temporal.io/docs) — Workflow orchestration concepts
- [NATS Documentation](https://docs.nats.io) — Message broker
- [Bun Documentation](https://bun.sh/docs) — JavaScript runtime
- [NestJS Documentation](https://docs.nestjs.com) — Framework for API servers
- [Kustomize User Guide](https://kubectl.docs.kubernetes.io/guides/introduction/kustomize/) — K8s config management
