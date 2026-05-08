# Workflow Service

A REST API and Temporal orchestration engine for multi-step workflow execution. Workflows are defined as sequences of actions (HTTP calls, inline JavaScript, NATS messaging, parallel branches, agent execution) with template-driven dynamic configuration. The service operates as two independent processes: a NestJS HTTP API server for workflow management and a standalone Temporal worker for orchestration and action execution.

## What is Workflow Service?

Workflow Service enables complex multi-step automation by composing actions into workflows. Each workflow step can call external endpoints, execute JavaScript, publish to message buses, branch on conditions, or invoke AI agents. Actions execute sequentially by default but can run in parallel via branch actions. All intermediate results are available via template resolution (`{{result.actionName.data}}`) for downstream actions to consume.

The service stores workflow definitions and execution history in **per-tenant Postgres instances** (one database per customer), not in a shared platform database. This ensures complete tenant isolation and allows each tenant to manage their own workflow data.

## Quick Start

### API Server

```bash
bun install

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

Workflows support 8 action types, each with distinct execution semantics:

| Action | Task Queue | Scope | Description |
|--------|-----------|-------|-------------|
| `endpointCall` | `http-adapter` (remote) | Single HTTP call | Call external endpoint with optional adapter config |
| `serviceCall` | `http-adapter` (remote) | Single HTTP call | Call internal service (resolves via DNS) |
| `agentCall` | `workflow-orchestrator` (local) | AI agent execution | Invoke YoizenClaw agent with execution context |
| `jsFunction` | `workflow-orchestrator` (local) | Inline code | Execute arbitrary JavaScript code |
| `serviceBusCall` | `workflow-orchestrator` (local) | NATS publish | Publish event to NATS subject |
| `channelSend` | `workflow-orchestrator` (local) | Channel delivery | Send message to configured channel (email, SMS, etc.) |
| `branch` | — (workflow control) | Parallel execution | Execute multiple action lists concurrently |
| `sleep` | — (workflow control) | Delay | Pause workflow for specified duration |

### Workflow Execution Lifecycle

```
1. Client calls POST /workflows
   ↓
2. API validates DTO (WorkflowDefinition, actions, request)
   ↓
3. API calls temporal.workflow.start('runWorkflow', {
     tenantId,
     workflowId: {tenantId}:{name}:{nanoid()},
     definition,
     request
   })
   ↓
4. Temporal queues workflow on workflow-orchestrator task queue
   ↓
5. Orchestrator worker picks up workflow
   ↓
6. runWorkflow() executes:
   • Iterate over actions sequentially
   • For each action:
     - Resolve {{templates}} against execution context
     - Dispatch to appropriate task queue (http-adapter or local)
     - Await result
     - Store in results map for downstream actions
   ↓
7. Return final result to Temporal
   ↓
8. Client calls GET /workflows/:id to query status
   ↓
9. API queries Temporal: workflow.getHandle(id).describe()
   ↓
10. Return { status, result, execution_time }
```

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
  type: "endpointCall",
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
  type: "serviceCall",
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
  type: "agentCall",
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
  type: "jsFunction",
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
  type: "serviceBusCall",
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

Sends message via configured channel (email, SMS, Slack, etc.).

```
{
  type: "channelSend",
  name: "emailNotification",
  args: {
    channel: "email",
    recipient: "{{results.fetchUser.data.email}}",
    subject: "Your request has been processed",
    body: "Status: {{results.processRequest.data.status}}\nReference: {{workflow.id}}"
  }
}
```

### branch

Executes multiple action sequences in parallel, then waits for all to complete.

```
{
  type: "branch",
  name: "parallelProcessing",
  args: {
    branches: [
      [
        {
          type: "serviceCall",
          name: "enrichData1",
          args: { service: "service1", path: "/enrich", method: "POST", data: {...} }
        }
      ],
      [
        {
          type: "serviceCall",
          name: "enrichData2",
          args: { service: "service2", path: "/enrich", method: "POST", data: {...} }
        }
      ]
    ]
  }
}
```

All branches execute concurrently; workflow waits for all to complete before proceeding:

```
results.parallelProcessing = {
  status: "success",
  data: [
    { enrichData1: { status: 200, data: {...} } },
    { enrichData2: { status: 200, data: {...} } }
  ]
}
```

### sleep

Pauses workflow execution for a specified duration.

```
{
  type: "sleep",
  name: "waitForWebhook",
  args: {
    duration: 30000  // 30 seconds
  }
}
```

## REST API Reference

### Start Workflow

```
POST /workflows
Content-Type: application/json
X-Yoizen-Tenant: acme

{
  "name": "processOrder",
  "application": "order-service",
  "request": {
    "orderId": "ORD-12345",
    "customerId": "CUST-789"
  },
  "actions": [
    {
      "type": "endpointCall",
      "name": "fetchOrder",
      "args": { ... }
    },
    {
      "type": "endpointCall",
      "name": "validatePayment",
      "args": { ... }
    }
  ]
}

Response (202 Accepted):
{
  "workflowId": "acme:processOrder:k3j2h1g",
  "status": "RUNNING",
  "startTime": "2026-05-11T10:30:00Z"
}
```

### Get Workflow Status

```
GET /workflows/:workflowId
X-Yoizen-Tenant: acme

Response (200 OK):
{
  "workflowId": "acme:processOrder:k3j2h1g",
  "status": "COMPLETED",
  "result": {
    "status": 200,
    "data": { "orderId": "ORD-12345", "processed": true }
  },
  "startTime": "2026-05-11T10:30:00Z",
  "endTime": "2026-05-11T10:30:45Z",
  "executionTime": 45000
}
```

### List Workflows

```
GET /workflows
X-Yoizen-Tenant: acme

Response (200 OK):
{
  "workflows": [
    {
      "workflowId": "acme:processOrder:k3j2h1g",
      "name": "processOrder",
      "status": "COMPLETED",
      "startTime": "2026-05-11T10:30:00Z"
    }
  ],
  "total": 1
}
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

Each action receives up to 3 attempts with 30s start-to-close timeout:

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

- **Type**: Plain Deployment + KEDA
- **Min replicas**: 1
- **Max replicas**: 3
- **KEDA scaler**: Monitors `workflow-orchestrator` task queue depth
- **Cooldown**: 300s (prevents flapping)
- **Concurrency**: 100 workflow tasks + 50 activity tasks per replica

### Temporal Timeouts

| Timeout | Value | Applied To |
|---------|-------|-----------|
| Workflow timeout | 24 hours | Entire workflow execution |
| Activity timeout | 30s | Each individual action |
| Retry timeout | 1 minute | Between retry attempts |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address:port |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `NATS_URL` | `nats://localhost:4222` | NATS server URL |
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
| **http-adapter** | Task queue | Executes endpointCall and serviceCall |
| **Per-tenant Postgres** | TCP | Stores workflow definitions and executions |
| **adapter-service** | HTTP | Resolves adapter configs for serviceCall (via http-adapter) |
| **yoizenclaw-runtime** | HTTP | Executes agentCall activities |

## Integration Points

### Called By

- **api-gateway**: Proxies workflow REST endpoints
- **External clients**: Any HTTP client can call workflow REST API
- **event-processor**: Can trigger workflows on events

### Calls To

- **Temporal Server**: Workflow orchestration
- **NATS**: Service bus activity publishes
- **http-adapter**: Endpoint and service calls
- **Per-tenant Postgres**: Workflow storage
- **yoizenclaw-runtime**: Agent execution

## Further Reading

- [AGENTS.md](AGENTS.md) — Detailed architecture, worker configuration, database schema
- [Temporal Workflow Documentation](https://temporal.io/docs/concepts/what-is-a-workflow-definition)
- [Template Resolution Guide](../DOCS/COMMON-PATTERNS.md#template-resolution)
- [HTTP Adapter Integration](../http-adapter/README.md)
