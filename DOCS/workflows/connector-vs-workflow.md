# Connector Runtime vs Workflow Service: Integration Patterns

Class: descriptive
Summary: When to reach for connector-runtime and when for workflow-service, with decision matrices and worked scenarios using the canonical action schemas.

A practical guide for developers choosing between `connector-runtime` and `workflow-service` for their use cases, with decision matrices, scenario walkthroughs, and example implementations.

> **Schema note**: the JSON action payloads below use the canonical `activity`/`args` shapes
> from `packages/shared/src/workflow.interfaces.ts` (`EndpointCallArgs`, `ServiceCallArgs`,
> `AgentCallArgs`, `ChannelSendArgs`, `BranchAction`, `ConditionalAction`). A few pseudocode
> snippets illustrate direct Temporal-client activity dispatch (`client.activity.executeEndpointCall(...)`)
> outside the `workflow-service` JSON API and may show illustrative fields like `retries`/`timeout`
> that the real `EndpointCallArgs`/`ServiceCallArgs` do not have — the actual per-attempt timeout
> and retry count are fixed by the Temporal activity policy (30s, 5 attempts), not settable per-call.

> **Calling a connector directly from code (not a workflow)?** This guide covers
> Temporal-orchestrated dispatch (`workflow-service`) and direct Temporal-client
> `executeEndpointCall`. If the caller is hosted-service *code* (not a workflow) and needs
> the same governed pipe (breaker, cache, audit event) without touching Temporal at all, use
> the SDK's `connectors.invoke()` instead — sync (inline result) or async (202 + webhook/
> polling). See `sdk/README.md` "connectors.invoke()" and
> `services/connector-runtime/README.md` "Three entrypoints, one deployable" /
> "HTTP Invoke Facade".

## Quick Decision Matrix

| Need | Use Connector Runtime | Use Workflow Service | Use Agent Call |
|------|------------------|----------------------|-----------------|
| Single HTTP call | ✅ Direct | ✓ Overkill | ✗ No |
| Multi-step orchestration | ✗ No | ✅ Yes | ✗ No |
| Conditional branching | ✗ No | ✅ Yes | ✗ No |
| State management across steps | ✗ No | ✅ Yes | ✗ No |
| AI-driven decision making | ✗ No | ✓ Via agent call | ✅ Yes |
| Async notification | ✗ No | ✅ Via service bus | ✗ No |
| High-throughput HTTP | ✅ Yes | ✓ Via connector-runtime | ✗ No |
| Connector-driven config | ✅ Yes | ✓ Via connector-runtime | ✗ No |
| Simple message delivery | ✗ No | ✓ Via channel send | ✗ No |

---

## Scenario 1: Direct HTTP Call (No Orchestration)

### When to Use Connector Runtime Directly

**Characteristics**:
- Single HTTP request
- No state needed from other services
- No branching or conditional logic
- High throughput expected
- May use connector-driven config

### Example: Real-Time CRM Lookup

A channel-service receives a message and needs to enrich it with customer data from the CRM without waiting for workflow results.

```
HTTP Request
  ↓
connector-runtime executeEndpointCall
  ├─ adapterId: "crm-connector"
  ├─ endpointId: "getCustomer"
  ├─ params: { customerId: "123" }
  ↓
connector-admin resolves:
  baseUrl: https://crm.example.com/api
  endpoint path: /customers/{customerId}
  auth: bearer token (from the connector's authConfig)
  ↓
tracedFetch to https://crm.example.com/api/customers/123
  with Authorization header
  ↓
Return { status: 200, data: {...customer data...} }
```

**Usage Pattern**:
- **Called by**: any Temporal client (typically `workflow-service-worker` via `endpointCall`/`serviceCall` activities)
- **No workflow**: Direct activity dispatch to the `connector-runtime` task queue
- **Pseudocode**:

```
// Temporal client
const client = new Temporal.Client()
const handle = client.workflow.getHandle(workflowId)

// Dispatch endpointCall activity directly
const result = await handle.result()  // If already running
// OR dispatch to connector-runtime queue directly
const result = await client.activity.executeEndpointCall({
  method: "GET",
  url: "https://api.crm.example.com/customers/123",
  adapterId: "crm-connector",
  endpointId: "getCustomer",
  params: { customerId: "123" }
})

// Use result
console.log(result.data.email)
```

**Benefits**:
- ✅ Low latency (direct activity dispatch)
- ✅ High concurrency (400 concurrent activities per replica, `maxConcurrentActivityTaskExecutions`)
- ✅ Automatic retries and circuit breaker
- ✅ Connector config caching in Redis (SWR via `AdapterClient`)
- ✅ Built-in OpenTelemetry instrumentation

**Limitations**:
- ✗ No state management across calls
- ✗ No branching or conditional logic
- ✗ No built-in retry scheduling (only immediate retries)

---

## Scenario 2: Multi-Step Orchestration (Workflow)

### When to Use Workflow Service

**Characteristics**:
- Multiple steps with sequential or parallel execution
- Results from one step feed into next
- Conditional branching based on results
- State management across steps
- Need for durable execution (survives process restarts)

### Example: Order Processing Workflow

```
Workflow: processOrder
  ↓
1. fetchOrder → Call CRM via adapter
   Result: { orderId, customerId, amount }
  ↓
2. validatePayment → Call payment API
   Uses: {{results.fetchOrder.data.amount}}
   Result: { valid, transactionId }
  ↓
3. Branch [Parallel]:
   a) notifyCustomer → NATS publish
      Uses: {{results.fetchOrder.data.customerId}}
   b) updateInventory → Call inventory service
      Uses: {{results.fetchOrder.data.items}}
  ↓
4. logEvent → Inline JavaScript
   Uses: {{results.validatePayment.data.transactionId}}
  ↓
5. Return final result
```

**Usage Pattern**:
- **Called by**: External HTTP client via workflow-service REST API
> Current API split: `POST /workflows` creates or stores the definition only. Run it with
> `POST /workflows/:id/execute`, then query one execution with
> `GET /workflows/:id/executions/:executionId` or list executions with
> `GET /workflows/:id/executions` (paginated: `{ items, total, page, pageSize }`, query
> params `page`/`pageSize`/`sort`). `POST /workflows` answers **201**,
> `POST /workflows/:id/execute` answers **202**, `DELETE /workflows/:id` answers **204**.

- **State management**: All results stored in execution context
- **Pseudocode**:

```
// Client
POST http://workflow-service/workflows
{
  name: "processOrder",
  application: "order-service",
  actions: [
    {
      activity: "endpointCall",
      name: "fetchOrder",
      args: {
        method: "GET",
        url: "https://api.crm.example.com/orders/{{request.orderId}}",
        adapterId: "crm-adapter",
        endpointId: "getOrder"
      }
    },
    {
      activity: "endpointCall",
      name: "validatePayment",
      args: {
        method: "POST",
        url: "https://payment.example.com/validate",
        data: {
          amount: "{{results.fetchOrder.data.amount}}",
          currency: "USD"
        }
      }
    },
    {
      activity: "branch",
      name: "parallelNotifications",
      notifyCustomerBranch: [
        {
          activity: "serviceBusCall",
          name: "notifyCustomer",
          args: {
            subject: "events.notifications",
            payload: {
              customerId: "{{results.fetchOrder.data.customerId}}",
              orderId: "{{request.orderId}}",
              status: "confirmed"
            }
          }
        }
      ],
      updateInventoryBranch: [
        {
          activity: "serviceCall",
          name: "updateInventory",
          args: {
            serviceId: "3f9b6c2e-...-registered-service-uuid",
            method: "POST",
            path: "/items/update",
            data: {
              items: "{{results.fetchOrder.data.items}}"
            }
          }
        }
      ]
    },
    {
      activity: "jsFunction",
      name: "generateReceipt",
      args: {
        code: `
          (context) => ({
            orderId: context.request.orderId,
            transactionId: context.results.validatePayment.data.transactionId,
            timestamp: new Date().toISOString()
          })
        `
      }
    }
  ]
}

// `serviceCall.args.serviceId` is the UUID of a row in `registered_services`
// (never the slug). `workflow-service` pre-resolves it to `args.serviceSlug`
// at start time so the connector-runtime activity can hit the internal-adapter
// mirror in O(1); when the mirror misses (or `serviceSlug` is absent), it
// falls back to a legacy `registry-service` lookup + Knative in-cluster DNS.

// Response (201 Created): workflow definition persisted
{
  id: "wf_def_123",
  name: "processOrder",
  application: "order-service",
  tenantId: "acme",
  actions: [ ... ],
  createdAt: "2026-05-11T10:30:00Z"
}

// Start an execution from the saved definition
POST http://workflow-service/workflows/wf_def_123/execute
{
  request: { orderId: "ORD-123" }
}

// Response (202 Accepted): execution started
{
  executionId: "exec_456",
  definitionId: "wf_def_123",
  temporalWorkflowId: "acme:processOrder:abc123",
  runId: "..."
}

// Query execution status/result
GET http://workflow-service/workflows/wf_def_123/executions/exec_456
{
  executionId: "exec_456",
  definitionId: "wf_def_123",
  status: "COMPLETED",
  result: { ... }
}
```

**Benefits**:
- ✅ Sequential & parallel execution
- ✅ Template resolution (dynamic configuration)
- ✅ State management across steps
- ✅ Durable execution (survives process restarts)
- ✅ Branching and conditional logic
- ✅ Temporal Web UI for monitoring
- ✅ Per-tenant Postgres for audit trail

**Limitations**:
- ✗ Higher latency (queued orchestration)
- ✗ Per-activity start-to-close ceiling: 30 s for `endpointCall`/`serviceCall`/`mcpCall`/`jsFunction`/`serviceBusCall`/`channelSend` — `agentCall` is the exception at 15 min with a 30 s heartbeat
- ✗ No automatic compensation (manual rollback)
- ✗ Temporal dependency required

---

## Scenario 3: AI-Driven Decision Making (Agent Call)

### When to Use Agent Call

**Characteristics**:
- Need autonomous decision-making or reasoning
- Complex analysis that benefits from LLM capabilities
- Can be part of larger workflow or standalone
- Requires context from previous steps

### Example: Incident Classification in Workflow

```
Workflow: classifyAndRoute Incident
  ↓
1. parseTicket → JavaScript
   Extract: description, priority, category
  ↓
2. fetchHistory → Call support DB
   Result: previous tickets from customer
  ↓
3. classifyIncident → Agent call
   Input: {{results.parseTicket.data.description}}
   Context: {{results.fetchHistory.data}}
   Uses: Incident Classifier Agent
   Result: { classification, confidence, reason }
  ↓
4. Branch [Based on classification]:
   if "URGENT" → Escalate
   if "BUG" → Route to engineering
   else → Queue for support
```

**Usage Pattern**:
- **In workflow**: Use `agentCall` action type
- **Standalone**: Direct call to agent-ai-service
- **Pseudocode**:

```
// In workflow definition
// Note: `AgentCallArgs` (packages/shared/src/workflow.interfaces.ts) requires
// `agentId` + `message` (not `input`); there is no `timeout` or `systemPrompt`
// field — the system prompt is configured on the agent itself in agent-admin-service.
// Optional `context` is prior chat turns: `{ sender: "customer" | "agent", content }[]`.
// The other optional fields are `conversationId`, `customerName`, `userId`, `channel`.
//
// DO NOT set `variables` in the args: `runWorkflow` dispatches
// `{ ...resolvedArgs, variables: context.variables }`, so whatever you wrote is
// overwritten by the engine's own five-scope `VariableResolutionContext`
// (`system`/`workflow`/`previous`/`node`/`request`). Reference workflow data with
// `{{...}}` templates in `message`/`context` instead.
{
  activity: "agentCall",
  name: "classifyIncident",
  args: {
    agentId: "incident-classifier-v2",
    message: "{{results.parseTicket.data.description}}",
    context: [
      { sender: "customer", content: "{{results.fetchHistory.data.lastMessage}}" }
    ]
  }
}

// Result
{
  status: "success",
  data: {
    classification: "URGENT",
    confidence: 0.98,
    reason: "Customer reported complete system outage affecting production"
  }
}

// Next action can branch on result
{
  activity: "conditional",
  name: "routeByClassification",
  branches: [
    {
      label: "urgent",
      condition: {
        variable: "results.classifyIncident.data.classification",
        comparator: "eq",
        value: "URGENT"
      },
      actions: [
        {
          activity: "serviceBusCall",
          name: "escalateUrgent",
          args: {
            subject: "events.escalations",
            payload: {
              ticketId: "{{request.ticketId}}",
              classification: "{{results.classifyIncident.data.classification}}"
            }
          }
        }
      ]
    }
  ]
}
```

**Benefits**:
- ✅ Autonomous reasoning and decision-making
- ✅ Context-aware analysis
- ✅ Complex classification without explicit rules
- ✅ Can be combined with workflow for orchestration
- ✅ LLM-backed intelligence

**Limitations**:
- ✗ Higher latency (LLM API call)
- ✗ Non-deterministic results (may vary)
- ✗ Requires trained agents (setup cost)
- ✗ Cost per invocation

---

## Scenario 4: Error Handling & Retry Strategy

### Connector Runtime: Immediate Retries

```
Request 1: Network timeout
  ↓ [Exponential backoff 1s]
Request 2: 5xx error
  ↓ [Exponential backoff 2s]
Request 3: 5xx error
  ↓ [Exponential backoff 4s]
Request 4: 5xx error
  ↓ [Max retries exceeded]
Circuit breaker opens
  ↓
Fail with 503 Service Unavailable
```

**Pseudocode**:

```
// connector-runtime handles retries automatically
const result = await executeEndpointCall({
  method: "GET",
  url: "https://unstable-api.example.com/data",
  retries: 3,           // Max 3 retries
  timeout: 30000        // 30s per attempt
})

// Circuit breaker prevents hammering
// On repeated failures:
// 1. Fail fast (503)
// 2. After cooldown (30s, HTTP_BREAKER_COOLDOWN_MS): try one test request
// 3. If test succeeds: circuit closes
// 4. If test fails: circuit reopens
```

### Workflow Service: Activity-Level Retry Policy

For `endpointCall` and `serviceCall`, Temporal's activity retry policy handles retries automatically. The workflow-service configures them as follows: max 5 attempts, 1 s initial interval, 2× backoff coefficient, 30 s maximum interval. This covers one full circuit-breaker cooldown window (30 s in `connector-runtime`).

The `jsFunction` activity sandbox (`new Function()`) does NOT have access to Temporal or NATS APIs. Code inside a `jsFunction` action cannot call activities, sleep for Temporal-durable delays, or publish events directly. Use a `branch` or `conditional` action to sequence retry logic across multiple `endpointCall` steps, or rely on the built-in activity retry policy.

---

## Scenario 5: Performance & Scaling Considerations

### When Connector Runtime Outperforms Workflow

```
Use case: Real-time CRM enrichment
  Requirements: <100ms latency, 1000 req/sec throughput

  Option A: Workflow Service
    ├─ API request → queue on orchestrator
    ├─ Worker picks up (wait ~50ms)
    ├─ Workflow dispatch to connector-runtime (10ms)
    ├─ connector-runtime picks up (wait ~30ms)
    ├─ Execute HTTP call (20ms)
    ├─ Return result (10ms)
    └─ Total: ~120ms (FAILS latency SLA)

  Option B: Direct Connector Runtime
    ├─ Dispatch to connector-runtime queue (5ms)
    ├─ connector-runtime picks up (wait ~10ms)
    ├─ Execute HTTP call (20ms)
    ├─ Return result (5ms)
    └─ Total: ~40ms (PASSES latency SLA)
```

**Scaling Numbers** (approximate — subject to deployment config):

| Component | Concurrency (configured) | Notes |
|-----------|--------------------------|-------|
| **Connector Runtime** | 400 activities/replica (`maxConcurrentActivityTaskExecutions`, `services/connector-runtime/src/worker.ts`) | Pure I/O worker. **Not a Knative Service** — `knative/services/base/connector-runtime.yaml` is a plain `apps/v1` `Deployment` (`replicas: 1`, RollingUpdate), as are its `connector-runtime-http` and `connector-runtime-invoke` siblings: a Temporal/JetStream pull worker has no inbound HTTP for the KPA to scale on. Scale it by replica count. |
| **Workflow Worker** | 200 activity tasks, 150 workflow tasks per replica (`services/workflow-service/src/temporal/worker.ts`) | Also a plain Deployment (`workflow-worker.yaml`); orchestration overhead adds latency relative to direct dispatch |
| **Workflow API** | Knative KPA, base `min-scale: 1` / `max-scale: 15` (`knative/services/base/workflow-service-api.yaml`) | Stateless REST endpoint. The dev overlay pins every ksvc to `min = max = 1`, so in developer mode there is exactly one replica. |

**Recommendation**:
- Use **Connector Runtime directly** for: Real-time, high-throughput, low-latency needs
- Use **Workflow Service** for: Complex orchestration, state management, monitoring, audit trail

---

## Scenario 6: Connector-Driven Configuration

### Both Services Support Connector Config

```
Connector Runtime:
  Caller provides: adapterId, endpointId, optional params
  Service resolves: URL, auth, headers, timeout, retries (via connector-admin)
  Cache: Redis stale-while-revalidate in the shared `AdapterClient`
    soft TTL 60s  (DEFAULT_CACHE_TTL_S — when a refresh is attempted)
    hard TTL 300s (soft x STALE_MULTIPLIER = 5 — how long stale data
                   stays servable if connector-admin is down)
    negative cache 10s (NEGATIVE_CACHE_TTL_S, so a new mirror propagates fast)

Workflow Service (via connector-runtime):
  endpointCall action with adapterId/endpointId
  Same resolution pipeline
  Template variables in params: {{request.field}}
```

**Comparison**:

| Aspect | Connector Runtime | Workflow Service |
|--------|--------------|------------------|
| **Connector config resolution** | Direct | Via endpointCall action |
| **Caching strategy** | Redis SWR | Same (connector-runtime caches) |
| **Caller provides** | Minimal (adapterId + endpointId) | Workflow definition |
| **Use case** | "Call CRM endpoint" | "Multi-step integration" |

---

## Performance Checklist

Before choosing a service, consider:

### Use Connector Runtime If:
- [ ] Single HTTP request per operation
- [ ] Sub-100ms latency required
- [ ] >100 requests/second throughput needed
- [ ] Connector-driven config simplifies integration
- [ ] No state management needed

### Use Workflow Service If:
- [ ] Multiple sequential steps
- [ ] State needed across steps
- [ ] Branching or conditional logic
- [ ] Durability required (survive crashes)
- [ ] Audit trail important
- [ ] Monitoring via Temporal Web UI valuable

### Use Agent Call If:
- [ ] Complex decision-making needed
- [ ] Reasoning / analysis important
- [ ] Context-aware response required
- [ ] Classification or recommendation needed
- [ ] Can tolerate 100-500ms latency

---

## Common Patterns

### Pattern 1: Workflow that Calls Connector Runtime

```
POST /workflows
{
  name: "enrichUserData",
  application: "crm",
  actions: [
    {
      activity: "endpointCall",
      name: "fetchUserCRM",
      args: {
        adapterId: "crm-connector",
        endpointId: "getUser",
        params: { userId: "{{request.userId}}" }
      }
    },
    {
      activity: "endpointCall",
      name: "fetchUserHistory",
      args: {
        adapterId: "analytics-connector",
        endpointId: "getUserEvents",
        params: { userId: "{{request.userId}}", limit: 100 }
      }
    },
    {
      activity: "jsFunction",
      name: "mergeData",
      args: {
        code: `
          (context) => ({
            user: context.results.fetchUserCRM.data,
            history: context.results.fetchUserHistory.data
          })
        `
      }
    }
  ]
}
```

**Benefit**: State management + connector integration


### Pattern 1b: Conditional Workflow Branch

Use `activity: "conditional"` when one of several action lists should run based on runtime
context. Comparators are `eq`, `neq`, `gt`, `lt`, `gte`, `lte`, `contains`, `exists`, and
`notExists`.

```
{
  activity: "conditional",
  name: "routeByAmount",
  branches: [
    {
      label: "highValue",
      condition: { variable: "request.amount", comparator: "gte", value: "1000" },
      actions: [
        {
          activity: "agentCall",
          name: "reviewOrder",
          args: { agentId: "risk-reviewer", message: "{{request.orderId}}" }
        }
      ]
    }
  ],
  default: [
    {
      activity: "serviceBusCall",
      name: "autoApprove",
      args: { subject: "orders.approved", payload: { orderId: "{{request.orderId}}" } }
    }
  ]
}
```

### Pattern 2: Connector Runtime with Retry Logic

```
// Caller (Temporal client)
const result = await client.activity.executeEndpointCall({
  method: "POST",
  url: "https://api.example.com/process",
  adapterId: "processor-connector",
  endpointId: "asyncJob",
  data: { jobId: "123" },
  retries: 5,
  timeout: 60000
})
```

**Benefit**: High-throughput with built-in resilience

### Pattern 3: Agent Classification in Workflow

```
{
  activity: "agentCall",
  name: "classifyRequest",
  args: {
    agentId: "request-classifier",
    // Fold prior-step data into the message; `variables` in args is
    // overwritten by the engine (see Scenario 3).
    message: "{{results.parseRequest.data.content}} | meta: {{results.fetchMetadata.data}}"
  }
}
```

**Benefit**: Intelligence + orchestration

---

## Decision Tree

```
START: Need to make an HTTP request?
  ├─ YES: Single request with no orchestration?
  │   ├─ YES: Use Connector Runtime directly
  │   │   └─ Rationale: Low latency, high concurrency
  │   └─ NO: Multiple steps or branching?
  │       ├─ YES: Use Workflow Service
  │       │   └─ Rationale: State management, durable execution
  │       └─ NO: AI/reasoning needed?
  │           ├─ YES: Use Agent Call (in workflow or standalone)
  │           │   └─ Rationale: Autonomous intelligence
  │           └─ NO: Review requirements
  └─ NO: Are you doing something else?
      └─ Refer to @yoizen/shared package interfaces
```

---

## Further Reading

- [Connector Runtime README](../../services/connector-runtime/README.md) — Detailed runtime worker
- [Connector Admin README](../../services/connector-admin/README.md) — Connector configuration API
- [Workflow Service README](../../services/workflow-service/README.md) — Orchestration details
- [Platform Architecture](../architecture/overview.md) — Visual high-level overview
- [Workflow Engine](./engine.md) — Trigger and action execution internals
- [Common Patterns](./patterns.md) — Pseudocode recipes
- [@yoizen/shared Package](../../packages/shared/src/index.ts) — Type reference
