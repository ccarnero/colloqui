# Workflow Service

A REST API and Temporal orchestration engine for multi-step workflow execution. Workflows are defined as sequences of actions (HTTP calls, inline JavaScript, NATS messaging, parallel branches, agent execution) with template-driven dynamic configuration. The service operates as two independent processes: a NestJS HTTP API server for workflow management and a standalone Temporal worker for orchestration and action execution.

## What is Workflow Service?

Workflow Service enables complex multi-step automation by composing actions into workflows. Each workflow step can call external endpoints, execute JavaScript, publish to message buses, branch on conditions, or invoke AI agents. Actions execute sequentially by default but can run in parallel via branch actions. All intermediate results are available via template resolution (`{{result.actionName.data}}`) for downstream actions to consume.

The service stores workflow definitions and execution history in **per-tenant Postgres instances** (one database per customer), not in a shared platform database. This ensures complete tenant isolation and allows each tenant to manage their own workflow data.

## Quick Start

### API Server

```bash
pnpm install

# Terminal 1: API server
bun run start:dev
```

Listens on port 3000 for HTTP requests.

### Orchestrator Worker

```bash
# Terminal 2: Temporal worker (separate terminal)
bun run start:worker:dev
```

Listens on Temporal server for orchestration tasks.

**Prerequisites**: Temporal server (`localhost:7233`), NATS (`nats://localhost:4222`), per-tenant Postgres instances.

## Local Development

### API Server Commands

```bash
# Start API server in development mode
bun run start:dev

# Start with debug logging
LOG_LEVEL=debug bun run start:dev

# Run tests
bun test test/unit
```

### Worker Commands

```bash
# Start worker in development mode
bun run start:worker:dev

# Start with debug logging
LOG_LEVEL=debug bun run start:worker:dev
```

### Health Check

```bash
# Check API server + Temporal connectivity
curl http://localhost:3000/health
```

Returns `200 OK` if Temporal connection is healthy.

## Architecture

### Dual-Process Design

The service runs as two independent processes sharing the same codebase and dependencies:

| Process | Entry Point | Port | Task Queue | Purpose |
|---------|-------------|------|-----------|---------|
| **API Server** | `src/main.ts` | 3000 | — | REST API for workflow CRUD and execution |
| **Orchestrator Worker** | `src/temporal/worker.ts` | — | `workflow-orchestrator` | Executes workflows + activities |

Both processes use the same NestJS module structure and dependency injection, but with different entrypoints:

```
API Server:
  NestJS bootstrap → Fastify adapter → REST endpoints
  Provides: /workflows (POST, GET, GET /:id)
  
Orchestrator Worker:
  Temporal worker bootstrap → register workflows + activities
  Executes: workflow orchestration, action dispatch
```

### Action Types

Workflows support 8 action activities, each with distinct execution semantics:

| Action | Task Queue | Scope | Description |
|--------|-----------|-------|-------------|
| `endpointCall` | `connector-runtime` (remote) | Single HTTP call | Call external endpoint with optional adapter config |
| `serviceCall` | `connector-runtime` (remote) | Single HTTP call | Call internal service (resolves via DNS) |
| `agentCall` | `workflow-orchestrator` (local) | AI agent execution | Invoke YoizenClaw agent with execution context |
| `jsFunction` | `workflow-orchestrator` (local) | Inline code | Execute arbitrary JavaScript code |
| `serviceBusCall` | `workflow-orchestrator` (local) | NATS publish | Publish event to NATS subject |
| `channelSend` | `workflow-orchestrator` (local) | Channel delivery | Send message to configured channel (email, SMS, etc.) |
| `branch` | — (workflow control) | Parallel execution | Execute multiple action lists concurrently |
| `conditional` | — (workflow control) | Conditional branch | Execute the first matching branch or an optional default branch |

### Workflow Definition and Execution Lifecycle

```
1. Client calls POST /workflows
   ↓
2. API validates and stores a workflow definition
   ↓
3. Client calls POST /workflows/:id/execute with { request, agentTimeoutSec? }
   ↓
4. API loads the definition and starts Temporal workflow runWorkflow on workflow-orchestrator
   ↓
5. Orchestrator worker executes actions:
   • Iterate sequentially by default
   • Resolve {{templates}} against execution context
   • Dispatch HTTP activities to connector-runtime and local activities to workflow-orchestrator
   • Store each action result for downstream templates
   ↓
6. Client queries GET /workflows/:id/executions/:executionId
   ↓
7. API reads the execution row, asks Temporal for current status/result, and syncs the row
```

`GET /workflows/:id` returns the saved definition metadata, not execution status. Use
`GET /workflows/:id/executions` to list runs for a definition and
`GET /workflows/:id/executions/:executionId` to inspect one run.

### Template Resolution

Actions support dynamic configuration via `{{path.to.value}}` template syntax. Templates are resolved at execution time against the `WorkflowExecutionContext`:

```
ExecutionContext = {
  workflow: {
    id,
    tenantId,
    name,
    startTime
  },
  request: {
    // original caller payload
  },
  results: {
    [actionName]: {
      status,
      data,
      error
    }
  }
}
```

**Template Examples**

```
// Reference request field
"url": "https://api.example.com/users/{{request.userId}}"

// Reference previous action result
"data": {
  "email": "{{results.fetchUser.data.email}}",
  "timestamp": "{{results.fetchUser.data.createdAt}}"
}

// Reference workflow metadata
"headers": {
  "x-workflow-id": "{{workflow.id}}",
  "x-tenant": "{{workflow.tenantId}}"
}

// Nested path resolution
"recipient": "{{results.validateEmail.data.email}}"
```

Templates support:
- Object navigation: `{{results.action.data.user.email}}`
- Array indexing: `{{results.users.data[0].name}}`
- Null coalescing: `{{results.fallback.data || 'default_value'}}`

## Action Type Examples

### endpointCall

Calls external HTTP endpoint with optional adapter-driven configuration.

```
{
  activity: "endpointCall",
  name: "fetchCustomer",
  args: {
    method: "GET",
    url: "https://api.crm.example.com/customers/{{request.customerId}}",
    headers: {
      "Authorization": "Bearer {{results.getToken.data.accessToken}}",
      "Accept": "application/json"
    },
    timeout: 30000
  }
}
```

Result stored as:
```
results.fetchCustomer = {
  status: 200,
  data: { id: 123, name: "Alice", email: "alice@example.com" },
  headers: { "content-type": "application/json" }
}
```

### serviceCall

Calls internal service via Kubernetes DNS. Identical to endpointCall but targets internal services.

```
{
  activity: "serviceCall",
  name: "auditLog",
  args: {
    service: "audit-service",
    path: "/events/log",
    method: "POST",
    data: {
      action: "customer.updated",
      customerId: "{{request.customerId}}",
      changes: "{{results.fetchCustomer.data}}"
    }
  }
}
```

### agentCall

Invokes a YoizenClaw AI agent for autonomous decision-making or complex reasoning.

```
{
  activity: "agentCall",
  name: "classifyIncident",
  args: {
    agentId: "incident-classifier",
    input: "{{results.parseTicket.data.description}}",
    context: {
      ticketId: "{{request.ticketId}}",
      customerHistory: "{{results.fetchCustomer.data}}"
    },
    timeout: 60000
  }
}
```

Result stored as:
```
results.classifyIncident = {
  status: "success",
  data: {
    classification: "URGENT",
    confidence: 0.95,
    reason: "Multiple priority indicators detected"
  }
}
```

### jsFunction

Executes arbitrary inline JavaScript code with access to execution context.

```
{
  activity: "jsFunction",
  name: "validateData",
  args: {
    code: `
      const email = context.results.fetchUser.data.email;
      const domain = email.split('@')[1];
      return {
        valid: domain.endsWith('.example.com'),
        domain: domain
      };
    `,
    timeout: 5000
  }
}
```

Result stored as:
```
results.validateData = {
  status: "success",
  data: {
    valid: true,
    domain: "example.com"
  }
}
```

### serviceBusCall

Publishes event to NATS subject with tenant header injection.

```
{
  activity: "serviceBusCall",
  name: "notifySlack",
  args: {
    subject: "events.notifications.slack",
    payload: {
      channel: "#incidents",
      message: "Incident {{request.ticketId}}: {{results.classifyIncident.data.classification}}",
      user: "{{results.fetchUser.data.email}}"
    }
  }
}
```

### channelSend

Sends a message via a configured channel account. `channel` is one of
`whatsapp` | `instagram` | `telegram` | `http` (see
`packages/shared/src/channel.interfaces.ts`) — there is no `email`/`sms`
channel. `args` requires `accountId`, `channel`, `provider`, `to`, `type`
(there is no `recipient`/`subject`/`body`).

```
{
  activity: "channelSend",
  name: "sendMessage",
  args: {
    accountId: "{{request.channelAccountId}}",
    channel: "telegram",
    provider: "telegram",
    to: "{{results.fetchUser.data.phone}}",
    type: "text",
    text: "Status: {{results.processRequest.data.status}}\nReference: {{workflow.id}}"
  }
}
```

### branch

Executes multiple action sequences in parallel, then waits for all to complete.

```
{
  activity: "branch",
  name: "parallelProcessing",
  enrichData1Branch: [
    {
      activity: "serviceCall",
      name: "enrichData1",
      args: { service: "service1", path: "/enrich", method: "POST", data: {...} }
    }
  ],
  enrichData2Branch: [
    {
      activity: "serviceCall",
      name: "enrichData2",
      args: { service: "service2", path: "/enrich", method: "POST", data: {...} }
    }
  ]
}
```

All branches execute concurrently; workflow waits for all to complete before proceeding:

```
results.parallelProcessing = ["enrichData1Branch", "enrichData2Branch"]
// Results produced inside each branch are merged back into context.results by action name.
```

### conditional

Runs the first matching conditional branch, or `default` when no branch matches.

```
{
  "activity": "conditional",
  "name": "routeByAmount",
  "branches": [
    {
      "label": "highValue",
      "condition": {
        "variable": "request.amount",
        "comparator": "gte",
        "value": "1000"
      },
      "actions": [
        {
          "activity": "agentCall",
          "name": "reviewOrder",
          "args": { "agentId": "risk-reviewer", "input": "{{request.orderId}}" }
        }
      ]
    }
  ],
  "default": [
    {
      "activity": "serviceBusCall",
      "name": "autoApprove",
      "args": {
        "subject": "orders.approved",
        "payload": { "orderId": "{{request.orderId}}" }
      }
    }
  ]
}
```

## REST API Reference

### Create Workflow Definition

```
POST /workflows
Content-Type: application/json
X-Yoizen-Tenant: acme

{
  "name": "processOrder",
  "application": "order-service",
  "actions": [
    {
      "activity": "endpointCall",
      "name": "fetchOrder",
      "args": { ... }
    },
    {
      "activity": "endpointCall",
      "name": "validatePayment",
      "args": { ... }
    }
  ]
}

Response (201 Created):
{
  "id": "wf_def_123",
  "name": "processOrder",
  "application": "order-service",
  "tenantId": "acme",
  "actions": [ ... ],
  "createdAt": "2026-05-11T10:30:00Z"
}
```

### Execute Workflow Definition

```
POST /workflows/:id/execute
Content-Type: application/json
X-Yoizen-Tenant: acme

{
  "request": {
    "orderId": "ORD-12345",
    "customerId": "CUST-789"
  },
  "agentTimeoutSec": 60
}

Response (202 Accepted):
{
  "executionId": "exec_456",
  "definitionId": "wf_def_123",
  "temporalWorkflowId": "acme:processOrder:k3j2h1g",
  "runId": "..."
}
```

### Get Workflow Definition

```
GET /workflows/:id
X-Yoizen-Tenant: acme

Response (200 OK): definition metadata, including actions, trigger, variables, and createdAt.
```

### List Definition Executions

```
GET /workflows/:id/executions?page=0&pageSize=20&status=COMPLETED
X-Yoizen-Tenant: acme
```

### Get Execution Status

```
GET /workflows/:id/executions/:executionId
X-Yoizen-Tenant: acme

Response (200 OK):
{
  "executionId": "exec_456",
  "definitionId": "wf_def_123",
  "temporalWorkflowId": "acme:processOrder:k3j2h1g",
  "status": "COMPLETED",
  "result": { ... },
  "createdAt": "2026-05-11T10:30:00Z"
}
```

### List Workflow Definitions

```
GET /workflows
X-Yoizen-Tenant: acme

Response (200 OK): an array of saved workflow definitions.
```

## Multi-Tenancy & Per-Tenant Databases

### Tenant Isolation

- **Tenant header**: `x-yoizen-tenant` in all requests
- **Workflow scope**: `{tenantId}:{workflowName}:{uniqueId}`
- **Database**: Each tenant's Postgres instance stores their own `workflow_definitions` and `workflow_executions` tables
- **No shared table**: Tables do not contain `tenant_id` column; database itself is the boundary

### Per-Tenant Postgres Connection

```
Tenant "acme" (dev) →
  Connection pool to postgres.acme-dev-ns.svc.cluster.local
  Executes: SELECT * FROM workflow_executions WHERE id = $1

Tenant "demo" (dev) →
  Connection pool to postgres.demo-dev-ns.svc.cluster.local
  Executes: SELECT * FROM workflow_executions WHERE id = $1
```

The `WorkflowTenantConnectionManager` maintains separate connection pools:

```
connections.ensureSchema(tenantId)
  ↓
Lookup pool for tenant
  ├─ [Hit] return existing pool
  └─ [Miss] create new pool to postgres.{tenantId}-dev-ns.svc.cluster.local
         ↓
         Register WORKFLOW_SCHEMA_SQL (idempotent CREATE TABLE IF NOT EXISTS)
         ↓
         Return pool
```

## Error Handling & Compensation

### Sequential Execution

Actions execute sequentially by default. If an action fails, the entire workflow fails and no subsequent actions execute.

```
Action 1: fetchUser → SUCCESS
Action 2: validatePayment → FAILURE (network timeout)
Action 3: sendConfirmation → SKIPPED (never executed)

Workflow status: FAILED
Result: error from validatePayment
```

### Retry Strategy

Local workflow-orchestrator activities receive up to 3 attempts with a 30s start-to-close timeout. HTTP activities on `connector-runtime` receive up to 5 attempts with 1s initial interval, 2x backoff, and a 30s maximum interval. Agent calls use a 15m start-to-close timeout, 30s heartbeat, and 3 attempts capped at a 60s interval:

```
Attempt 1: executeAction → Failure (timeout)
Attempt 2: executeAction → Failure (5xx error)
Attempt 3: executeAction → Failure (connection refused)

Workflow aborts (max retries exhausted)
Result: error from final attempt
```

### Branching Failure

Branch actions fail if **any** parallel branch fails:

```
Branch 1: serviceCall → SUCCESS
Branch 2: serviceCall → FAILURE (5xx)

Branch status: FAILED
Workflow aborts immediately (failure short-circuits)
```

### No Automatic Compensation

Workflow Service does not provide automatic compensation (rollback). If you need cleanup on failure, implement it explicitly:

```
Action 1: createResource → SUCCESS (resource ID: res_123)
Action 2: processResource → FAILURE
Action 3: rollback → { delete res_123 }

Branch on failure: if results.processResource.status === FAILED
  Execute: rollback action
```

## Scaling & Performance

### API Server Scaling

- **Type**: Knative Service (KPA-managed autoscaling)
- **Min replicas**: 1 (dev/qa), 2 (staging/prod)
- **Max replicas**: 5 (dev), 20 (staging/prod)
- **Scale-to-zero**: Enabled in non-production environments
- **Request routing**: Per-request load balancing

### Orchestrator Worker Scaling

- **Type**: Plain Deployment (Temporal pull-based worker, no inbound HTTP)
- **Replicas**: fixed 1 in developer mode (no autoscaling)
- **Concurrency**: 150 workflow tasks + 200 activity tasks per replica

### Temporal Timeouts

| Timeout | Value | Applied To |
|---------|-------|-----------|
| Workflow timeout | 10 minutes (`WORKFLOW_DEFAULT_TIMEOUT_MS`, `packages/shared/src/constants.ts`) | Entire workflow execution, wall-clock from `workflow.start` including schedule-to-start queue wait |
| Activity timeout | 30s | Local workflow-orchestrator activities |
| HTTP retry max interval | 30s | endpointCall/serviceCall on connector-runtime |
| Agent retry max interval | 60s | agentCall |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address:port |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
| `REDIS_HOST` | `localhost` | Redis host. **Required on the worker process** — `executeAgentCall` uses Redis for the distributed circuit breaker and as the `YoizenClawExecutionClient` status cache. Missing on the deployment causes every agentCall to fail with `MaxRetriesPerRequestError` / `REDIS_UNAVAILABLE`. |
| `REDIS_PORT` | `6379` | Redis port (worker only). |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `SERVICE_MODE` | `api` | Process mode: `api` or `worker` |

## Debugging Tips

### Check API Server Health

```bash
curl http://localhost:3000/health
```

Returns connectivity status for Temporal, NATS, and per-tenant Postgres instances.

### Enable Debug Logging

```bash
LOG_LEVEL=debug bun run start:dev
LOG_LEVEL=debug bun run start:worker:dev
```

Watch for:
- `[workflow-start]` — workflow creation
- `[action-execution]` — action dispatch and results
- `[template-resolution]` — template rendering
- `[branch-execution]` — parallel branch handling

### Monitor Temporal Web UI

Usually available at `http://localhost:8080`:
1. Navigate to "Workflows"
2. Filter by namespace (`default`)
3. Search by workflow ID: `acme:*` (tenant prefix)
4. Click workflow to see execution timeline and action results

### Common Issues

**Issue**: Workflow hangs indefinitely  
**Solution**: Check Temporal server connectivity. Enable debug logging to see where workflow is blocked.

**Issue**: Template resolution returns `undefined`  
**Solution**: Verify action names and result field names match template paths. Use debug logging to inspect execution context.

**Issue**: Per-tenant Postgres connection fails  
**Solution**: Verify tenant Postgres instance is running and accessible. Check `WorkflowTenantConnectionManager` logs for connection pool errors.

## Dependencies

| Service | Protocol | Purpose |
|---------|----------|---------|
| **Temporal Server** | gRPC | Workflow execution engine |
| **NATS** | TCP | Service bus activity publishes events |
| **connector-runtime** | Task queue | Executes endpointCall and serviceCall |
| **Per-tenant Postgres** | TCP | Stores workflow definitions and executions |
| **connector-admin** | HTTP | Resolves connector configs for connector-runtime |
| **agent-ai-service** | HTTP | Executes agentCall activities |

## Integration Points

### Called By

- **api-gateway**: Proxies workflow REST endpoints
- **External clients**: Any HTTP client can call workflow REST API
- **event-processor**: Can trigger workflows on events

### Calls To

- **Temporal Server**: Workflow orchestration
- **NATS**: Service bus activity publishes
- **connector-runtime**: Endpoint and service calls
- **Per-tenant Postgres**: Workflow storage
- **agent-ai-service**: Agent execution

## Further Reading

- [AGENTS.md](AGENTS.md) — Detailed architecture, worker configuration, database schema
- [Temporal Workflow Documentation](https://temporal.io/docs/concepts/what-is-a-workflow-definition)
- [Template Resolution Guide](../DOCS/workflows/patterns.md#template-resolution)
- [Connector Runtime Integration](../connector-runtime/README.md)
