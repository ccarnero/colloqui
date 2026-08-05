# Common Patterns & Recipes

Class: descriptive
Summary: Worked recipes for the nine WorkflowAction kinds, with the field names and template variables the engine actually resolves.

Practical pseudocode examples for common use cases with `connector-runtime` and `workflow-service`.

> **Field name note**: The real `WorkflowAction` schema uses `activity` (not `type`) to identify the action kind. The recipes below use pseudo-JSON; in actual API payloads write `"activity": "endpointCall"` etc. See `packages/shared/src/workflow.interfaces.ts` for the canonical type definitions.

> **Available action kinds** (the whole `WorkflowAction` union, one dispatch `case` each in `services/workflow-service/src/temporal/workflows.ts`): `endpointCall`, `serviceCall`, `mcpCall`, `jsFunction`, `serviceBusCall`, `channelSend`, `agentCall`, `branch`, `conditional`.

> **Template scopes are exactly what `WorkflowExecutionContext` holds.** A `{{...}}`
> path that does not resolve is replaced with an **empty string**, silently
> (`resolvePath` returns `""` for any missing segment) — a typo never fails a run, it
> just injects nothing. The root keys are `workflow`, `request`, `results`,
> `variables`, and the optional `causal` / `executionId`. Critically,
> `context.workflow` carries only **`name`**, **`tenant`**, **`application`** (plus
> `agentTimeoutMs` when the definition sets it): there is **no** `workflow.id`,
> `workflow.tenantId`, `workflow.startTime`, `workflow.endTime` or
> `workflow.channelAccountId`. Use `{{workflow.tenant}}`, and pass ids/timestamps
> through `{{request.*}}` or compute them in a `jsFunction`.

> **`serviceCall` args note**: `args.serviceId` is the UUID of a row in `registered_services`
> (never a service name/slug). `workflow-service` pre-resolves it to `args.serviceSlug` at
> workflow start so the `connector-runtime` activity can hit the internal-adapter mirror
> directly; on a mirror miss it falls back to a legacy `registry-service` lookup. See
> `packages/shared/src/workflow.interfaces.ts` (`ServiceCallArgs`).

> **Lifecycle note**: workflow definitions are created with `POST /workflows` and contain `name`, `application`, and `actions`. Executions are started separately with `POST /workflows/:id/execute` and the body is only `{ "request": { ... } }`; the actions below reference that execution request via `{{request.*}}`.

> **`endpointCall`/`serviceCall` result shape note**: the real activity result is
> `{ status: number, data: unknown, headers: Record<string, string> }`
> (`IHttpCallResult` in `services/connector-runtime/src/activities/_shared/http-call-with-retry.ts`,
> plus an optional `cacheResult`). There is no `body`, `duration` or `retriesUsed` field —
> read the payload as `result.data`, and in templates as `{{results.<name>.data.…}}`.
> On the request side, `EndpointCallArgs`/`ServiceCallArgs` have no `timeout`/`retries`
> fields: per-attempt timeout and retry count are fixed by the Temporal activity policy
> (30 s, 5 attempts), not settable per-action. Pattern 1 shows `timeout`/`retries` only as
> illustrative pseudocode for direct Temporal-client dispatch outside the workflow JSON API —
> do not copy those two into a real `POST /workflows` action.

## Pattern 1: Simple HTTP Call via Connector Runtime

**Use case**: Single HTTP request, no orchestration needed.

**When to use**:
- Real-time data enrichment
- Single API call response
- High throughput, low latency required

**Recipe**:

```
// Temporal client dispatches activity directly
client = TemporalClient(address: "localhost:7233")

result = client.activity.executeEndpointCall({
  method: "GET",
  url: "https://api.crm.example.com/contacts/123",
  timeout: 30000,
  retries: 3
})

// Response — IHttpCallResult, exactly these three fields
{
  status: 200,
  data: {
    id: "123",
    name: "Alice",
    email: "alice@example.com"
  },
  headers: { "content-type": "application/json" }
}

// Use result immediately
console.log(result.data.email)  // "alice@example.com"
```

---

## Pattern 2: Adapter-Driven HTTP Call

**Use case**: Call external API using centralized adapter configuration.

**Benefits**:
- Configuration managed in `connector-admin`
- Cached in Redis
- Reusable across multiple workflows
- Auth handled transparently

**Recipe**:

```
// Workflow calls adapter-configured endpoint
client = TemporalClient()

result = client.activity.executeEndpointCall({
  adapterId: "crm-adapter",    // Adapter ID
  endpointId: "getContact",     // Endpoint within adapter
  params: { contactId: "123" }
})

// AdapterClient resolves:
//   baseUrl: https://crm.example.com/api (from adapter config)
//   endpoint path: /contacts/{contactId}
//   auth: Bearer token (OAuth2 client credentials)
//   headers: { "X-API-Key": "...", ... }
//   timeout: 45000 (adapter-configured)
//   retries: 3 (adapter-configured)

// Full request: GET https://crm.example.com/api/contacts/123
// with Authorization and X-API-Key headers

result = {
  status: 200,
  data: { id: "123", name: "Alice", ... },
  headers: { ... }
}
```

---

## Pattern 3: Multi-Step Workflow with State Management

**Use case**: Sequential actions where later steps depend on earlier results.

**When to use**:
- Order processing (fetch → validate → charge → confirm)
- Data enrichment from multiple sources
- Complex state-dependent logic

**Recipe**:

```
// Client creates or updates a workflow definition
POST /workflows
{
  name: "processOrder",
  application: "ecommerce",
  actions: [
    // Step 1: Fetch order details
    {
      activity: "endpointCall",
      name: "fetchOrder",
      args: {
        method: "GET",
        url: "https://inventory.example.com/orders/{{request.orderId}}",
        adapterId: "inventory-adapter",
        endpointId: "getOrder"
      }
    },
    
    // Step 2: Validate payment (uses Step 1 result)
    {
      activity: "endpointCall",
      name: "validatePayment",
      args: {
        method: "POST",
        url: "https://payments.example.com/validate",
        data: {
          orderId: "{{request.orderId}}",
          amount: "{{results.fetchOrder.data.total}}",
          currency: "USD"
        }
      }
    },
    
    // Step 3: Process charge (uses Step 2 result)
    {
      activity: "endpointCall",
      name: "processCharge",
      args: {
        method: "POST",
        url: "https://payments.example.com/charge",
        data: {
          transactionId: "{{results.validatePayment.data.transactionId}}",
          amount: "{{results.fetchOrder.data.total}}"
        }
      }
    },
    
    // Step 4: Send confirmation (uses all previous results)
    {
      activity: "serviceBusCall",
      name: "sendConfirmation",
      args: {
        subject: "events.orders.confirmed",
        payload: {
          orderId: "{{request.orderId}}",
          transactionId: "{{results.validatePayment.data.transactionId}}",
          amount: "{{results.fetchOrder.data.total}}",
          timestamp: "{{results.fetchOrder.data.placedAt}}"
        }
      }
    }
  ]
}

// Execution flow:
// 1. fetchOrder → { orderId: "ORD-123", total: 99.99, items: [...] }
// 2. validatePayment → { transactionId: "txn_abc", valid: true }
// 3. processCharge → { chargeId: "ch_xyz", status: "succeeded" }
// 4. sendConfirmation → published to NATS

// Final result
{
  status: 200,
  data: {
    orderId: "ORD-123",
    transactionId: "txn_abc",
    amount: 99.99,
    timestamp: "2026-05-11T10:30:00Z"
  }
}

// All steps executed sequentially
// Each step's results available to downstream steps via {{results.stepName.data}}

// Then execute the saved definition
POST /workflows/:id/execute
{
  request: { orderId: "ORD-123" }
}
```

---

## Pattern 4: Parallel Execution with Branches

**Use case**: Execute multiple actions concurrently, wait for all to complete.

**When to use**:
- Parallel data enrichment from multiple sources
- Concurrent notifications
- Independent sub-workflows

**Recipe**:

```
POST /workflows
{
  name: "enrichUserProfile",
  application: "crm",
  actions: [
    // Fetch base user data
    {
      activity: "endpointCall",
      name: "fetchUser",
      args: {
        adapterId: "user-service",
        endpointId: "getUser",
        params: { userId: "{{request.userId}}" }
      }
    },
    
    // Branch: Execute 3 parallel enrichments
    // Note: `branch` does NOT take `args.branches`. Every key on the action
    // other than `activity`/`name` is treated as a branch name mapped to
    // an action array (see `BranchAction` in `packages/shared/src/workflow.interfaces.ts`
    // and the `case "branch"` handler in `services/workflow-service/src/temporal/workflows.ts`).
    {
      activity: "branch",
      name: "enrichParallel",
      // Branch 1: Fetch purchase history
      purchaseHistoryBranch: [
        {
          activity: "endpointCall",
          name: "fetchHistory",
          args: {
            adapterId: "ecommerce",
            endpointId: "getUserPurchases",
            params: { userId: "{{results.fetchUser.data.id}}" }
          }
        }
      ],
      // Branch 2: Fetch preferences
      preferencesBranch: [
        {
          activity: "endpointCall",
          name: "fetchPreferences",
          args: {
            adapterId: "preferences-service",
            endpointId: "getUserPrefs",
            params: { userId: "{{results.fetchUser.data.id}}" }
          }
        }
      ],
      // Branch 3: Fetch loyalty points
      loyaltyBranch: [
        {
          activity: "endpointCall",
          name: "fetchLoyalty",
          args: {
            adapterId: "loyalty-service",
            endpointId: "getUserPoints",
            params: { userId: "{{results.fetchUser.data.id}}" }
          }
        }
      ]
    },
    
    // Merge enriched data
    {
      activity: "jsFunction",
      name: "mergeEnrichment",
      args: {
        code: `
          (context) => ({
            user: context.results.fetchUser.data,
            purchases: context.results.fetchHistory.data,
            preferences: context.results.fetchPreferences.data,
            loyalty: context.results.fetchLoyalty.data
          })
        `
      }
    }
  ]
}

// Execution flow:
// 1. fetchUser → completes in 100ms
// 2. Branch starts: 3 concurrent API calls
//    - fetchHistory: 150ms
//    - fetchPreferences: 120ms
//    - fetchLoyalty: 90ms
//    All run in parallel, workflow waits for slowest (150ms)
// 3. mergeEnrichment → combines results

// Total latency: ~260ms (sequential fetch + parallel branch)
// vs. 460ms if done sequentially (100 + 150 + 120 + 90)
```

---

## Pattern 5: Conditional Branching (if/then/else)

**Use case**: Different actions based on previous step results.

**When to use**:
- Route based on condition
- Retry on specific errors
- Approval workflows

**Recipe**:

```
POST /workflows
{
  name: "conditionalApproval",
  application: "approvals",
  actions: [
    // Check request amount
    {
      activity: "endpointCall",
      name: "validateRequest",
      args: {
        method: "POST",
        url: "https://approval-service.example.com/validate",
        data: { amount: "{{request.amount}}" }
      }
    },
    
    // Conditional branch: approve or escalate
    {
      activity: "jsFunction",
      name: "shouldApprove",
      args: {
        code: `
          (context) => {
            const amount = parseInt(context.request.amount);
            const isApproved = context.results.validateRequest.data.approved;

            if (amount > 10000 || !isApproved) {
              return { action: "escalate", reason: "high_amount_or_validation_failed" };
            } else {
              return { action: "approve", reason: "auto_approved" };
            }
          }
        `
      }
    },
    
    // Branch on decision
    // Note: `branch` does NOT take `args.branches` — every key other than
    // `activity`/`name` is a branch name mapped to an action array.
    {
      activity: "branch",
      name: "approvalRoute",
      // Branch A: Auto-approve (low amount, passed validation)
      autoApproveBranch: [
        {
          activity: "serviceBusCall",
          name: "publishApproved",
          args: {
            subject: "events.approvals.approved",
            payload: {
              requestId: "{{request.requestId}}",
              decision: "auto_approved",
              timestamp: "{{results.shouldApprove.data.decidedAt}}"
            }
          }
        }
      ],
      // Branch B: Escalate to manager (high amount or validation failed)
      escalateBranch: [
        {
          activity: "channelSend",
          name: "notifyManager",
          args: {
            accountId: "{{request.channelAccountId}}",
            channel: "telegram",
            provider: "telegram",
            to: "{{request.managerChatId}}",
            type: "text",
            text: "Approval Request: {{request.requestId}}\nRequest for {{request.amount}} requires manager approval.\nReason: {{results.shouldApprove.data.reason}}"
          }
        }
      ]
    }
  ]
}

// Note: with `branch`, both branches always execute in parallel.
// For true if/then/else, use the `conditional` action type:
//   { activity: "conditional", branches: [{ condition: {...}, actions: [...] }], default: [...] }
// The `conditional` action evaluates branches in order and executes
// only the first matching branch (or `default` if none match).
```

---

## Pattern 6: Template Resolution & Variable Substitution

**Use case**: Dynamically configure action arguments using previous results.

**Syntax**: `{{path.to.value}}`

**Recipe**:

```
POST /workflows
{
  name: "dynamicRequest",
  application: "notifications",
  actions: [
    // Step 1: Fetch user data
    {
      activity: "serviceCall",
      name: "getUser",
      args: {
        serviceId: "a1b2c3d4-...-registered-service-uuid",  // registered_services.id, not a name
        path: "/users/{{request.userId}}",  // {{request.X}} from initial request
        method: "GET"
      }
    },
    
    // Step 2: Fetch email template
    {
      activity: "serviceCall",
      name: "getTemplate",
      args: {
        serviceId: "e5f6a7b8-...-registered-service-uuid",
        path: "/templates/{{request.templateId}}",  // {{request.X}} from initial request
        method: "GET"
      }
    },
    
    // Step 3: Send message with templated content
    // Note: `Channel` is one of `whatsapp` | `instagram` | `telegram` | `http`
    // (see `packages/shared/src/channel.interfaces.ts`) — there is no `email`/`sms`
    // channel. `channelSend.args` requires `accountId`, `channel`, `provider`,
    // `to`, `type` (there is no `recipient`/`subject`/`body`).
    {
      activity: "channelSend",
      name: "sendMessage",
      args: {
        accountId: "{{request.channelAccountId}}",
        channel: "telegram",
        provider: "telegram",
        to: "{{results.getUser.data.chatId}}",  // {{results.X.data.Y}} from step 1
        type: "text",
        text: "Hello {{results.getUser.data.firstName}},\n\n{{results.getTemplate.data.body}}"  // Nested template
      }
    },
    
    // Step 4: Log event with context
    {
      activity: "serviceBusCall",
      name: "logSent",
      args: {
        subject: "events.emails.sent",
        payload: {
          userId: "{{request.userId}}",              // {{request.X}}
          email: "{{results.getUser.data.email}}",   // {{results.X.data.Y}}
          sentAt: "{{results.getUser.data.fetchedAt}}",  // from a step result
          workflow: "{{workflow.name}}",                 // {{workflow.name|tenant|application}}
          tenant: "{{workflow.tenant}}"                  // NOT {{workflow.tenantId}}
        }
      }
    }
  ]
}

// Template scopes (every root key of WorkflowExecutionContext):
// - {{request.X}}                  — from initial workflow request
// - {{results.actionName.data.Y}}  — from a previous action result
// - {{workflow.name}}              — definition name
// - {{workflow.tenant}}            — tenant id (NOT `workflow.tenantId`)
// - {{workflow.application}}       — definition application
// - {{variables.system.X}} / .workflow.X / .previous.X / .node.<action>.X / .request.X
// - {{executionId}}                — present once runWorkflow assigns it
//
// There is NO {{workflow.id}}, {{workflow.startTime}}, {{workflow.endTime}} or
// {{workflow.channelAccountId}}. Those resolve to "" — silently.

// Resolution happens at action execution time:
// 1. getUser completes, results.getUser.data = { email: "alice@example.com", ... }
// 2. Subsequent actions can reference: {{results.getUser.data.email}}
// 3. Template substituted with actual value before execution
```

---

## Pattern 7: Error Handling & Retries

**Use case**: Handle failures gracefully with retries and fallbacks.

**Recipe**:

```
POST /workflows
{
  name: "resilientAPICall",
  application: "integrations",
  actions: [
    // Attempt 1: Call primary API
    // Note: `EndpointCallArgs` has no `timeout`/`retries` fields — those are
    // ignored if sent. Retry/timeout behavior is fixed by the Temporal activity
    // policy for `endpointCall`/`serviceCall` (30s per attempt, 5 attempts,
    // 1s->30s exponential backoff), not configurable per-action.
    {
      activity: "endpointCall",
      name: "callPrimaryAPI",
      args: {
        method: "GET",
        url: "https://primary-api.example.com/data"
      }
    },
    
    // Evaluate result
    {
      activity: "jsFunction",
      name: "checkSuccess",
      args: {
        code: `
          (context) => {
            const result = context.results.callPrimaryAPI;
            if (result.status === 200) {
              return { success: true, data: result.data };
            } else if (result.status >= 500) {
              return { success: false, reason: "server_error", retry: true };
            } else {
              return { success: false, reason: "client_error", retry: false };
            }
          }
        `
      }
    },
    
    // Conditional fallback
    // Note: `branch` does NOT take `args.branches` — every key other than
    // `activity`/`name` is a branch name mapped to an action array.
    {
      activity: "branch",
      name: "fallbackStrategy",
      // If success: publish result
      publishBranch: [
        {
          activity: "serviceBusCall",
          name: "publishSuccess",
          args: {
            subject: "events.data.retrieved",
            payload: {
              data: "{{results.callPrimaryAPI.data}}"
            }
          }
        }
      ],
      // If failed: try backup API
      backupBranch: [
        {
          activity: "endpointCall",
          name: "callBackupAPI",
          args: {
            method: "GET",
            url: "https://backup-api.example.com/data"
          }
        }
      ]
    }
  ]
}

// Retry strategy (Temporal activity retry policy, fixed for endpointCall/serviceCall
// in services/workflow-service/src/temporal/workflows.ts — not configurable per-action):
// - 5 attempts max
// - 1s initial interval, 2x backoff coefficient, 30s maximum interval
// - Rides out one full circuit-breaker cooldown window (30s in connector-runtime)
// - A raw call with no `adapterId` gets a fixed 30s per-attempt timeout and no
//   connector-runtime-level retry of its own — retries happen at the Temporal layer
// - Circuit breaker OPEN is retried too (it's a transient signal, not a hard stop)

// Timeout behavior:
// - Per-attempt: 30s (startToCloseTimeout)
// - If adapter configured: adapter-level timeout/retries also apply (see Pattern 2)
// - Workflow execution timeout: 10 minutes (`WORKFLOW_DEFAULT_TIMEOUT_MS` in
//   `packages/shared/src/constants.ts`), not 24 hours
```

---

## Pattern 8: Agent-Driven Classification in Workflow

**Use case**: Use AI agent for intelligent decision-making within workflow.

**When to use**:
- Complex classification
- Context-aware reasoning
- Natural language understanding

**Recipe**:

```
POST /workflows
{
  name: "classifyAndRoute",
  application: "support",
  actions: [
    // Parse incoming request
    {
      activity: "jsFunction",
      name: "parseRequest",
      args: {
        code: `
          (context) => {
            const text = context.request.text;
            return {
              length: text.length,
              keywords: text.split(' '),
              receivedAt: new Date().toISOString()
            };
          }
        `
      }
    },
    
    // Invoke AI agent for classification
    // Note: `AgentCallArgs` requires `agentId` + `message` (not `input`); there is
    // no `timeout`/`systemPrompt` field — the agent's system prompt is configured
    // in agent-admin-service. `context` is reserved for prior chat turns
    // (`{ sender: "customer" | "agent", content }[]`), and `variables` must NOT be
    // set here: `runWorkflow` dispatches `{ ...resolvedArgs, variables: context.variables }`,
    // so any `variables` you write is replaced by the engine's own five-scope
    // `VariableResolutionContext`. Fold free-form data into `message` instead.
    {
      activity: "agentCall",
      name: "classifyMessage",
      args: {
        agentId: "message-classifier-v2",
        message: "{{request.text}} (len={{results.parseRequest.data.length}}, at={{results.parseRequest.data.receivedAt}})"
      }
    },
    
    // Route based on classification
    // Note: `branch` does NOT take `args.branches` — every key other than
    // `activity`/`name` is a branch name mapped to an action array.
    {
      activity: "branch",
      name: "routeByPriority",
      // High confidence urgent: escalate immediately
      urgentBranch: [
        {
          activity: "channelSend",
          name: "escalateUrgent",
          args: {
            accountId: "{{request.channelAccountId}}",
            channel: "telegram",
            provider: "telegram",
            to: "{{request.escalationChatId}}",
            type: "text",
            text: "URGENT: {{request.text}} [Confidence: {{results.classifyMessage.data.confidence}}%]"
          }
        }
      ],
      // Normal priority: queue for processing
      normalBranch: [
        {
          activity: "serviceBusCall",
          name: "queueForProcessing",
          args: {
            subject: "events.messages.queued",
            payload: {
              text: "{{request.text}}",
              classification: "{{results.classifyMessage.data.classification}}",
              confidence: "{{results.classifyMessage.data.confidence}}",
              reason: "{{results.classifyMessage.data.reason}}"
            }
          }
        }
      ]
    }
  ]
}

// Agent call characteristics:
// - Async: the activity publishes execution_requested.v1 to JetStream and waits
//   on core NATS for the lifecycle events; no HTTP connection is held.
// - Timeout: 15 min startToCloseTimeout with a 30s heartbeatTimeout (the
//   `httpAgent` proxyActivities block in workflows.ts). The activity's own wait
//   is AGENT_CALL_TIMEOUT_MS (default 900_000 ms), overridable per definition
//   via `workflow.agentTimeoutMs`. It is NOT 60s.
// - Retry: maximumAttempts 3, 1s initial, 2x backoff, 60s maximum interval.
// - Output: whatever the agent returns; nothing enforces JSON.
// See DOCS/agents/long-running-executions.md for the full budget table.
```

---

## Pattern 9: Audit Trail & Logging

**Use case**: Maintain complete execution history for compliance.

**Recipe**:

```
POST /workflows
{
  name: "auditedTransaction",
  application: "compliance",
  actions: [
    // Step 1: Log transaction start
    {
      activity: "serviceBusCall",
      name: "logStart",
      args: {
        subject: "events.transactions.started",
        payload: {
          transactionId: "{{request.transactionId}}",
          userId: "{{request.userId}}",
          amount: "{{request.amount}}",
          timestamp: "{{request.startedAt}}",
          workflow: "{{workflow.name}}",
          executionId: "{{executionId}}"
        }
      }
    },
    
    // Step 2: Execute transaction
    {
      activity: "endpointCall",
      name: "executeTransaction",
      args: {
        method: "POST",
        url: "https://payments.example.com/transactions",
        data: {
          userId: "{{request.userId}}",
          amount: "{{request.amount}}"
        }
      }
    },
    
    // Step 3: Log success
    {
      activity: "serviceBusCall",
      name: "logSuccess",
      args: {
        subject: "events.transactions.completed",
        payload: {
          transactionId: "{{request.transactionId}}",
          workflow: "{{workflow.name}}",
          executionId: "{{executionId}}",
          chargeId: "{{results.executeTransaction.data.chargeId}}",
          status: "{{results.executeTransaction.data.status}}",
          duration: "{{results.executeTransaction.data.duration}}",
          completedAt: "{{results.executeTransaction.data.completedAt}}"
        }
      }
    }
  ]
}

// Audit trail created by:
// 1. NATS events published to events.transactions.* stream
// 2. Audit service consumes and stores in audit table
// 3. Complete history: start → success/failure → end
// 4. Queryable by transactionId, userId, workflow ID
```

---

## Pattern 10: Chaining Workflows with Callbacks

**Use case**: Trigger secondary workflow from first, await result via webhook.

**When to use**:
- Long-running async operations
- Decoupled workflow execution
- Event-driven orchestration

**Recipe**:

```
// Workflow 1: Primary workflow with callback
POST /workflows
{
  name: "primaryWorkflow",
  application: "orders",
  actions: [
    // Execute primary steps...
    
    // Trigger secondary workflow and subscribe to result
    {
      activity: "serviceBusCall",
      name: "triggerSecondaryWorkflow",
      args: {
        subject: "events.workflows.trigger",
        payload: {
          workflowName: "secondaryWorkflow",
          request: {
            orderId: "{{request.orderId}}",
            callbackUrl: "{{request.callbackUrl}}"
          }
        }
      }
    }
  ]
}

// Workflow 2: Secondary workflow with callback notification
POST /workflows
{
  name: "secondaryWorkflow",
  application: "orders",
  actions: [
    // Execute async operations (e.g., generate report, process in background)
    // Note: there is no built-in `sleep` action. Use jsFunction with a
    // timeout loop, or trigger a separate delayed workflow via serviceBusCall.
    
    // Notify completion
    {
      activity: "endpointCall",
      name: "notifyCompletion",
      args: {
        method: "POST",
        url: "{{request.callbackUrl}}",
        data: {
          orderId: "{{request.orderId}}",
          status: "completed",
          result: "secondary workflow result"
        }
      }
    }
  ]
}

// Execution:
// 1. Primary workflow starts
// 2. Publishes trigger event to NATS
// 3. Secondary workflow is spawned (async)
// 4. Secondary workflow executes independently
// 5. On completion, calls callback URL
// 6. Primary workflow continues (or polls callback)
```

---

## Summary Table

| Pattern | Use Case | Key Technique |
|---------|----------|---------------|
| Simple HTTP | Single API call | Direct activity dispatch |
| Adapter-driven | Config-managed API | adapterId + endpointId |
| Multi-step | Sequential actions | Template resolution |
| Parallel | Concurrent actions | branch action type |
| Conditional | if/then/else logic | `conditional` action (or jsFunction + branch for runtime decisions) |
| Template substitution | Dynamic arguments | {{path.to.value}} syntax |
| Error handling | Failure recovery | Retries + fallback branches |
| AI classification | Intelligent routing | agentCall action type |
| Audit trail | Compliance logging | serviceBusCall events |
| Async chaining | Long-running workflows | Event-driven callbacks |

---

## Further Reading

- [Connector Runtime README](../../services/connector-runtime/README.md) — Direct API calls
- [Connector Admin README](../../services/connector-admin/README.md) — Connector configuration
- [Workflow Service README](../../services/workflow-service/README.md) — Orchestration
- [Connector Runtime vs Workflow Service](./connector-vs-workflow.md) — Decision guide
- `packages/shared/src/` — Canonical type definitions (no README; read source directly)
- [Platform Architecture](../architecture/overview.md) — High-level service boundaries
- [Workflow Engine](./engine.md) — Action execution model
