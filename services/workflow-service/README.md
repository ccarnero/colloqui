# Workflow Service

Class: descriptive
Summary: The workflow REST API and Temporal orchestration engine: the action union, trigger consumer, execution projector, status toggle and the two-process deployment.

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
  Provides: /workflows (full table below) + /health

Orchestrator Worker:
  Temporal worker bootstrap → register workflows + activities
  Executes: workflow orchestration, action dispatch
```

Every route on `WorkflowsController` (`@Controller("workflows")`), in
declaration order:

| Method | Path | Notes |
|---|---|---|
| `POST` | `/workflows` | Create a definition |
| `PUT` | `/workflows/:id` | Replace a definition |
| `PATCH` | `/workflows/:id/status` | Enable/disable — see "Per-Tenant Enable/Disable" |
| `GET` | `/workflows` | List definitions |
| `GET` | `/workflows/summary` | Definition summary ranked by execution count |
| `GET` | `/workflows/executions/counts` | Execution counts across definitions |
| `GET` | `/workflows/executions` | Tenant-wide execution list |
| `GET` | `/workflows/:id` | One definition's metadata |
| `DELETE` | `/workflows/:id` | Soft-delete (`deleted_at`) |
| `POST` | `/workflows/:id/execute` | Start a run |
| `GET` | `/workflows/:id/executions` | Runs of one definition |
| `GET` | `/workflows/:id/executions/:executionId` | One run's status/result |
| `GET` | `/workflows/:id/correlation-ids` | Correlation ids of a definition's runs (the `definitionId → correlationIds[]` hop tracking-ingester's `/node-stats` and `/node-runs` expect the caller to make) |

`GET /health` lives on its own `@Controller()` and takes no tenant header.
The three `summary` / `executions/counts` / `executions` literals are declared
before `@Get(":id")`; the in-file comments call this shadowing avoidance,
which is defensive rather than load-bearing on the Fastify adapter (its router
prefers static segments over parametric ones regardless of order).

### Action Types

`WorkflowAction` (`packages/shared/src/workflow.interfaces.ts`) is a **9-member**
union — the `activity` discriminant values below are the complete set:

| Action | Task Queue | Scope | Description |
|--------|-----------|-------|-------------|
| `endpointCall` | `connector-runtime` (remote) | Single HTTP call | Call external endpoint with optional connector config |
| `serviceCall` | `connector-runtime` (remote) | Single HTTP call | Call a tenant-registered service, resolved by `serviceId`/`serviceSlug` through the internal-adapter mirror, falling back to registry-service |
| `mcpCall` | `connector-runtime` (remote) | MCP tool call | Invoke one tool (`toolName`) on a registered MCP server (`serverId`) |
| `agentCall` | `workflow-orchestrator` (local) | AI agent execution | Invoke a YoizenClaw agent with execution context |
| `jsFunction` | `workflow-orchestrator` (local) | Inline code | Execute arbitrary JavaScript code |
| `serviceBusCall` | `workflow-orchestrator` (local) | NATS publish | Publish an event to a NATS subject |
| `channelSend` | `workflow-orchestrator` (local) | Channel delivery | Send a message through a configured channel account (`whatsapp` \| `instagram` \| `telegram` \| `http` — there is no email/SMS channel) |
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
    }
  }
}
```

`EndpointCallArgs` is `{ method, url, adapterId?, endpointId?, params?, data?,
headers? }` — there is no per-action `timeout` or `retries` field; the retry
chain comes from the connector's own `timeoutMs`/`maxRetries`/`retryBackoffMs`,
and the raw (no-`adapterId`) branch is a fixed 30 s single attempt.

Result stored as:
```
results.fetchCustomer = {
  status: 200,
  data: { id: 123, name: "Alice", email: "alice@example.com" },
  headers: { "content-type": "application/json" }
}
```

### serviceCall

Calls a service the TENANT registered in registry-service. `ServiceCallArgs` is
`{ serviceId, serviceSlug?, method, path, data?, headers?, endpointId? }` —
`serviceId` is the `registered_services` row id (a UUID, never the slug), and
there is no `service` field and no `timeout`. `serviceSlug` is pre-populated by
workflow-service at start time so connector-runtime can hit the internal-adapter
mirror in one hop.

```
{
  activity: "serviceCall",
  name: "auditLog",
  args: {
    serviceId: "0f4c…-uuid",
    serviceSlug: "echo-service",
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
    message: "{{results.parseTicket.data.description}}",
    conversationId: "{{request.ticketId}}",
    context: [
      { role: "user", content: "{{results.fetchCustomer.data}}" }
    ]
  }
}
```

`AgentCallArgs` is `{ agentId, message, conversationId?, customerName?,
userId?, channel?, context?, variables? }` — the prompt field is `message`
(not `input`), `context` is an ARRAY of `AgentCallContextEntry`, and there is
no per-action `timeout`. The per-run agent budget is the
`agentTimeoutSec` field on `POST /workflows/:id/execute` (see below), bounded
by `AGENT_CALL_TIMEOUT_MS` inside `agent-call.activity.ts`.

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
    `
  }
}
```

`JsFunctionArgs` has exactly ONE field, `code`. There is no `timeout` — the
bound is the activity's Temporal `startToCloseTimeout`.

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
      args: { serviceId: "…-uuid-1", serviceSlug: "service1", path: "/enrich", method: "POST", data: {...} }
    }
  ],
  enrichData2Branch: [
    {
      activity: "serviceCall",
      name: "enrichData2",
      args: { serviceId: "…-uuid-2", serviceSlug: "service2", path: "/enrich", method: "POST", data: {...} }
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

## Step-Event Telemetry

Beyond the run-level `execution_completed` event, every workflow run also emits
`execution_started` and, per action/condition, step-level telemetry. All events
in this family ride the same envelope/subject shape as `execution_completed`:
`evt.<tenant>.workflow-service.workflow.internal.native.<kind>.v1`, `producer:
"workflow-service"`, `domain: "workflow"` (`TAXONOMY.md` rule 19 — deliberately
kind-agnostic: it matches on producer+domain only, so no new classifier rule
was needed for these kinds; golden rows seq1312-1319). Publisher functions
live alongside `publishExecutionCompletedEvent` in
`src/temporal/activities/execution-completed-publisher.activity.ts`; there is
NO second publish path.

### Kinds

| Kind | When | Payload |
|------|------|---------|
| `execution_started` | Emitted once from `runWorkflow` (via the `publishExecutionStartedEvent` activity) before the first action runs; also fires when a run later fails, since it is emitted unconditionally at start | `executionId`, `workflowId`, `runId`, `workflowName?` |
| `action_started` / `action_completed` | Emitted around each executed action (via `publishActionStartedEvent`/`publishActionCompletedEvent`) | `executionId`, `actionIndex` (0-based position within its own action list — top-level, a `branch` sub-list, or a `conditional` branch/default list; NOT globally unique across nesting), `actionType`, `actionName`, `branch?` (nested labels compose, e.g. `"approved/pathA"`), `connectorId?`, `agentId?`, and on `action_completed` only: `status` (`ok\|failed\|skipped`) + `errorClass?` (class name only, never a stack trace) |
| `condition_evaluated` | Emitted once per `conditional` node EXIT (via `publishConditionEvaluatedEvent`) | `{ expression, evaluatedValue, branchTaken, cases }` — `evaluatedValue` is truncated to 256 chars with `truncated: true` when clipped; `branchTaken` is the matched case label, `"default"` when the default branch ran, or `null` for an if-without-else evaluating false. Untaken branches emit NOTHING — a skipped branch's actions never execute, so they never publish `action_started`/`action_completed` either. |

`actionType` is the REAL `WorkflowAction.activity` discriminant from
`@yoizen/shared`: `endpointCall | mcpCall | jsFunction | serviceBusCall |
serviceCall | channelSend | agentCall | branch | conditional`. There is no
separate `fork`/`join`/`http_call` kind — `branch` doubles as the fork marker,
and a fork's own `action_completed` (fired after its `Promise.all()` resolves)
IS the join point; there is no explicit `join` step in the codebase.

### Causal contract

`action_started`, `action_completed`, and `condition_evaluated` are SIBLING
hops off the run's `execution_started` event — `causation_id` is ALWAYS the
run's `execution_started` envelope id, NEVER the preceding step event
(`action_completed` does not chain off its own `action_started`;
`condition_evaluated` does not chain off the preceding action). This keeps
`transport.depth` CONSTANT across every step event of a run, equal to
`execution_started.depth + 1`, regardless of `action_index` or nesting.

Depth math (`MAX_DEPTH_BY_CATEGORY.internal_service = 5`,
`packages/shared/src/envelope.utils.ts`): trigger depth 0-2 → `execution_started`
= trigger + 1 = 1-3 → step events = `execution_started` + 1 = 2-4, comfortably
under the ceiling. A chained (step-to-step) design was rejected because depth
would grow per action instead of staying constant — see `TAXONOMY.md` rule 19
note for the authoritative record of this decision.

### Volume cap

Step events are capped at 100 per run (`STEP_EVENT_CAP`), enforced by
`reserveStepEmission` — a synchronous, race-safe reservation (read + mutate in
one call) so concurrent fork branches cannot both observe budget and both emit
past the cap. Once the cap would be exceeded, exactly ONE truncated marker
fires instead of further step events: an `action_completed` with
`actionType: "truncated"` and `status: "skipped"`. Measured end-to-end: the
e2e workflow multiplies from 3 baseline events (`execution_requested`-style
run events) to 13 events per run with step telemetry enabled (~4.3x).

### Spans free ride

Because every step kind follows the `_started`/`_completed` naming pair,
`tracking.tracked_event_spans` derives per-step `duration_ms` with ZERO
changes to its pairing SQL. Measured live: `agentCall` 1345ms, `jsFunction`
73ms.

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

## Per-Tenant Enable/Disable (`status`)

Each workflow definition carries a per-tenant `status` column:

```sql
status TEXT NOT NULL DEFAULT 'enabled' CHECK (status IN ('enabled', 'disabled'))
```

Rows created before this column existed (or any row where the value is missing) are
treated as `enabled` — the default preserves existing behavior. `status` is
independent of `deleted_at`: a soft-deleted definition and a disabled definition are
different states and both columns coexist on the row.

### Toggle endpoint

```
PATCH /workflows/:id/status
Content-Type: application/json
X-Yoizen-Tenant: acme

{ "status": "disabled" }

Response (200 OK):
{
  "id": "wf_def_123",
  "name": "processOrder",
  "status": "disabled",
  "terminated": 2
}
```

- Setting `status: "disabled"` first persists the toggle, then terminates every
  currently running Temporal execution of that definition for the tenant (via
  `WorkflowsService.terminateRunningExecutions`, matched by the
  `${tenantId}:${definitionName}:` workflow id prefix on the tenant's `TenantId`
  search attribute). The response includes the `terminated` count. A per-execution
  termination failure does not stop the rest of the sweep; failures are logged and do
  not fail the request.
- Setting `status: "enabled"` only flips the toggle — it never starts or touches
  executions. The response omits `terminated`.
- Both directions are idempotent (re-setting the same status is a no-op beyond the
  write).
- Unknown `id` returns `404 Not Found`.
- Proxied 1:1 through `api-gateway` at the same path/shape.

### Block point: new executions

`WorkflowsService.executeWorkflow` is the single choke point checked by both entry
points that can start a new execution. After the target definition is loaded, if
`definition.status === WorkflowStatus.DISABLED` the call is rejected before any
Temporal workflow is started:

- **HTTP** (`POST /workflows/:id/execute`): responds `409 Conflict` with body:

  ```json
  {
    "statusCode": 409,
    "error": "Conflict",
    "code": "WORKFLOW_DISABLED",
    "message": "Workflow 'wf_def_123' is disabled for tenant 'acme' and cannot be executed",
    "workflowId": "wf_def_123",
    "tenantId": "acme"
  }
  ```

  The block is logged at `warn` with the workflow id and tenant.

- **Trigger path** (`TriggerConsumerService`): the same `executeWorkflow` call is
  used to start trigger-fired runs. When it throws the `WORKFLOW_DISABLED` conflict,
  the consumer recognizes the `code` on the error body and acks the message instead
  of nacking it — a disabled workflow does not retry-loop the trigger event. This is
  logged at `warn` with tenant, workflow, and trigger type.

Already-running executions are unaffected by the block point; those are stopped by
the termination sweep triggered from `updateWorkflowStatus`, not by
`executeWorkflow`.

### Read endpoints echo `status`

`GET /workflows` and `GET /workflows/:id` include the persisted `status` field on
each definition. Clients (the admin console in particular) treat a missing `status`
as `enabled` for legacy rows, so the read side MUST project the column — an earlier
regression dropped it from the list/get mapping and disabled workflows rendered as
enabled in the console after a reload, while executions were still correctly
blocked. Covered by regression tests in `test/unit/workflows.service.spec.ts`
("listWorkflows/getWorkflow includes the persisted status").

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

`knative/services/base/workflow-service-api.yaml` is the ONLY manifest — this
repo carries a single developer-mode config; there is no qa/staging/prod
overlay to compare against.

- **Type**: Knative Service (KPA-managed autoscaling)
- **Min replicas**: `1` (`autoscaling.knative.dev/min-scale`)
- **Max replicas**: `15` (`autoscaling.knative.dev/max-scale`)
- **Scale-to-zero**: NOT enabled — min-scale 1 keeps a replica warm
- **Image**: `dev.local/workflow-service:local`

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
| `LOG_LEVEL` | `info` | Read by the shared `PinoLoggerService` (`packages/observability/src/logger.ts`), not by `src/config.ts` |
| `SERVICE_MODE` | `api` | Process mode: `api` or `worker` |
| `DB_ENGINE` | `postgres` | Repository engine for definitions/executions: `postgres` or `mongo`; falls back to `STORAGE_ENGINE`, throws on any other value (`resolveStorageEngine`, `packages/database/src/engine.ts`, read by `workflowServiceConfig.dbEngine`). Does NOT affect Temporal's own store |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | — | Read by `WorkflowTenantConnectionManager` against each tenant's own Postgres; platform-level `POSTGRES_HOST`/`_PORT`/`_DB` are deliberately NOT consumed — `src/config.ts` declares no Postgres settings at all and says so in its header comment |
| `REGISTRY_SERVICE_URL` | `http://registry-service.platform-services-dev.svc.cluster.local` | Service lookup for `serviceCall` (`workflowServiceConfig.registryServiceUrl`; trailing slashes are stripped) |
| `REGISTRY_LOOKUP_TIMEOUT_MS` | `5000` | Bound on that registry lookup (`registryLookupTimeoutMs`) |
| `SERVICE_SLUG_CACHE_TTL_MS` | `3600000` (1 h) | TTL of the `serviceId → slug` cache (`serviceSlugCacheTtlMs`) |

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
- **This service's own `TriggerConsumerService`**
  (`src/modules/triggers/trigger-consumer.service.ts`): fires trigger-bound
  definitions off the tenant's JetStream traffic. There is no separate
  `event-processor` service — no `services/event-processor` directory exists
  and nothing under `services/` registers that name.

### Calls To

- **Temporal Server**: Workflow orchestration
- **NATS**: Service bus activity publishes
- **connector-runtime**: Endpoint and service calls
- **Per-tenant Postgres**: Workflow storage
- **agent-ai-service**: Agent execution

## Activity Idempotency Contract

Temporal retries activities aggressively. The 2026-05-22 stress run
(`post-mortem/POST-MORTEM.md`) observed five cases of *"Activity not found on
completion … workflow execution already completed"*, proving an activity CAN
finish on the worker side after Temporal has already started a retry. **Every
activity in this service must therefore be idempotent under retry and double
completion.**

| Activity | Idempotency strategy |
|---|---|
| `executeChannelSend` (`src/temporal/activities/channel-send.activity.ts`) | Sets `Nats-Msg-Id` from the envelope's `idempotencykey` (`:159`); JetStream's `duplicate_window` collapses retries (`:45`) |
| `publishExecutionCompletedEvent` and its siblings (`src/temporal/activities/execution-completed-publisher.activity.ts`) | `Nats-Msg-Id = sha256:canonical(payload)` (`:81`), set on every publish path (`:186`, `:321`, `:491`, `:656`) |
| `executeServiceBusCall` (`src/temporal/activities/service-bus.activity.ts`) | `Nats-Msg-Id = args.dedupKey` when supplied, else a derived hash (`deriveDedupKey`, `:63`, applied `:98-99`, `msgID` `:120`). Publishes through JetStream to keep the dedup contract, falling back to core NATS only when the subject has no stream (`:109`) |
| `executeAgentCall` (`src/temporal/activities/agent-call.activity.ts`) | `executionId = "<runId>:<activityId>"` from `Context.current().info` (`deriveStableExecutionId`, `:241-255`), so every retry of the same invocation collapses inside the `duplicate_window` |
| `executeJsFunction` (`src/temporal/activities/js-function.activity.ts:13`) | The activity itself is pure — `new Function(...)`. Any side effect the USER's JS performs is the author's responsibility and must be keyed on a stable identifier from `context`. **Contract documented, not enforced.** |

Known gap, recorded in the code rather than hidden: `submitExecution` still
computes `requestedAt` per call, so `executeAgentCall`'s `Nats-Msg-Id` hash
drifts by milliseconds between attempts. JetStream's default two-minute
`duplicate_window` covers every retry observed in the post-mortem (seconds
apart), and the stable `executionId` collapses the duplicate in the common case
(`agent-call.activity.ts:294-304`).

When adding an activity: identify the side effect, pick a dedup key that does
NOT change across retries (`runId + activityId`, an envelope idempotency key, a
content hash), prefer server-side dedup (`Nats-Msg-Id`, `INSERT … ON CONFLICT`)
over client-side bookkeeping, and add a row to the table above.

`executeAgentCall` also heartbeats every 15 s so Temporal knows a multi-minute
LLM call is still alive (`agent-call.activity.ts:267-270`).

## Storage engine

Workflow **definitions and executions** support both Postgres (default) and
Mongo through repository adapters — `workflows.mongo.repository.ts`,
`executions.mongo.repository.ts`, `tenant-connection-manager.mongo.ts` — selected
by `DB_ENGINE` via `resolveStorageEngine()` (`workflowServiceConfig.dbEngine`). **Temporal
itself stays on its own dedicated Postgres regardless of this setting.**

`src/config.ts` deliberately declares no platform Postgres settings: workflow
data is per-tenant, so only `POSTGRES_USER` / `POSTGRES_PASSWORD` are read, to
authenticate against each tenant's own instance. `POSTGRES_HOST` / `_PORT` /
`_DB` are no longer consumed — `src/config.ts`'s own header comment records
this.

### Execution projector buffering

`ExecutionProjectorService`
(`src/modules/executions-projector/execution-projector.service.ts`) partitions
its in-memory buffer by `tenantId`, parsed from the canonical subject
(`:190-193`), and emits one `UPDATE … FROM (unnest(...))` per tenant on flush
(`:76-77`). A database failure for one tenant therefore does not NAK sibling
tenants' batches.

## Further Reading

- Detailed worker configuration and database schema: the sections above
- [Temporal Workflow Documentation](https://temporal.io/docs/concepts/what-is-a-workflow-definition)
- [Template Resolution Guide](../../DOCS/workflows/patterns.md#pattern-6-template-resolution--variable-substitution)
- [Connector Runtime Integration](../connector-runtime/README.md)
