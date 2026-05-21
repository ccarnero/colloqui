# Connector Runtime vs Workflow Service: Integration Patterns

A practical guide for developers choosing between `connector-runtime` and `workflow-service` for their use cases, with decision matrices, scenario walkthroughs, and example implementations.

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
  auth: OAuth2 bearer token
  ↓
tracedFetch to https://crm.example.com/api/customers/123
  with Authorization header
  ↓
Return { status: 200, body: {...customer data...} }
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
console.log(result.body.email)
```

**Benefits**:
- ✅ Low latency (direct activity dispatch)
- ✅ High concurrency (200 concurrent activities per replica)
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
- **State management**: All results stored in execution context
- **Pseudocode**:

```
// Client
POST http://workflow-service/workflows
{
  name: "processOrder",
  application: "order-service",
  request: { orderId: "ORD-123" },
  actions: [
    {
      type: "endpointCall",
      name: "fetchOrder",
      args: {
        method: "GET",
        url: "https://api.crm.example.com/orders/{{request.orderId}}",
        adapterId: "crm-adapter",
        endpointId: "getOrder"
      }
    },
    {
      type: "endpointCall",
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
      type: "branch",
      name: "parallelNotifications",
      args: {
        branches: [
          [
            {
              type: "serviceBusCall",
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
          [
            {
              type: "serviceCall",
              name: "updateInventory",
              args: {
                service: "inventory-service",
                path: "/items/update",
                method: "POST",
                data: {
                  items: "{{results.fetchOrder.data.items}}"
                }
              }
            }
          ]
        ]
      }
    },
    {
      type: "jsFunction",
      name: "generateReceipt",
      args: {
        code: `
          return {
            orderId: context.request.orderId,
            transactionId: context.results.validatePayment.data.transactionId,
            timestamp: new Date().toISOString()
          }
        `
      }
    }
  ]
}

// Response (202 Accepted)
{
  workflowId: "acme:processOrder:abc123",
  status: "RUNNING"
}

// Query result
GET http://workflow-service/workflows/acme:processOrder:abc123
{
  workflowId: "acme:processOrder:abc123",
  status: "COMPLETED",
  result: {
    status: 200,
    data: {
      orderId: "ORD-123",
      transactionId: "txn_xyz",
      timestamp: "2026-05-11T10:30:00Z"
    }
  }
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
- ✗ Workflow step timeout (30s per activity)
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
- **Standalone**: Direct call to yoizenclaw-runtime
- **Pseudocode**:

```
// In workflow definition
{
  type: "agentCall",
  name: "classifyIncident",
  args: {
    agentId: "incident-classifier-v2",
    input: "{{results.parseTicket.data.description}}",
    context: {
      previousTickets: "{{results.fetchHistory.data}}",
      customerId: "{{request.customerId}}",
      timestamp: "{{workflow.startTime}}"
    },
    timeout: 60000,
    systemPrompt: "You are an expert incident classifier. Respond with JSON: {classification, confidence, reason}"
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
  type: "branch",
  name: "routeByClassification",
  args: {
    branches: [
      [
        {
          type: "serviceBusCall",
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
    ]
  }
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
// 2. After cooldown (60s): try one test request
// 3. If test succeeds: circuit closes
// 4. If test fails: circuit reopens
```

### Workflow Service: Explicit Retry Action

For workflows, retry via branch + sleep:

```
{
  type: "jsFunction",
  name: "retryWithBackoff",
  args: {
    code: `
      let attempts = 0;
      while (attempts < 3) {
        try {
          const result = await context.executeActivity('endpointCall', {...});
          return result;
        } catch (e) {
          attempts++;
          if (attempts < 3) {
            await context.sleep(Math.pow(2, attempts) * 1000);
          } else {
            throw e;
          }
        }
      }
    `
  }
}
```

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

**Scaling Numbers**:

| Component | Concurrency | Max Throughput | Latency |
|-----------|-------------|----------------|---------|
| **Connector Runtime** | 200 activities/replica | 200 req/sec (1 replica) | 20-50ms |
| **Workflow Worker** | 100 workflows/replica | 50 workflows/sec (1 replica) | 100-300ms |
| **Workflow API** | Knative KPA | 500 req/sec (5 replicas) | 10-100ms |

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
  Cache: Redis SWR (300s TTL, 60s stale window)

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
  actions: [
    {
      type: "endpointCall",
      name: "fetchUserCRM",
      args: {
        adapterId: "crm-connector",
        endpointId: "getUser",
        params: { userId: "{{request.userId}}" }
      }
    },
    {
      type: "endpointCall",
      name: "fetchUserHistory",
      args: {
        adapterId: "analytics-connector",
        endpointId: "getUserEvents",
        params: { userId: "{{request.userId}}", limit: 100 }
      }
    },
    {
      type: "jsFunction",
      name: "mergeData",
      args: {
        code: `
          return {
            user: context.results.fetchUserCRM.data,
            history: context.results.fetchUserHistory.data
          }
        `
      }
    }
  ]
}
```

**Benefit**: State management + connector integration

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
  type: "agentCall",
  name: "classifyRequest",
  args: {
    agentId: "request-classifier",
    input: "{{results.parseRequest.data.content}}",
    context: {
      metadata: "{{results.fetchMetadata.data}}"
    }
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

- [Connector Runtime README](../services/connector-runtime/README.md) — Detailed runtime worker
- [Connector Admin README](../services/connector-admin/README.md) — Connector configuration API
- [Workflow Service README](../services/workflow-service/README.md) — Orchestration details
- [Platform Architecture](./01-ARCHITECTURE.md) — Visual high-level overview
- [Workflow Engine](./04-WORKFLOW-ENGINE.md) — Trigger and action execution internals
- [Common Patterns](./09-COMMON-PATTERNS.md) — Pseudocode recipes
- [@yoizen/shared Package](../packages/shared/README.md) — Type reference
