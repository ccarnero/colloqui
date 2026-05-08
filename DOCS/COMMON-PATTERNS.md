# Common Patterns & Recipes

Practical pseudocode examples for common use cases with HTTP Adapter and Workflow Service.

## Pattern 1: Simple HTTP Call via HTTP Adapter

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

// Response
{
  status: 200,
  body: {
    id: "123",
    name: "Alice",
    email: "alice@example.com"
  },
  headers: { "content-type": "application/json" },
  duration: 145,
  retriesUsed: 0
}

// Use result immediately
console.log(result.body.email)  // "alice@example.com"
```

---

## Pattern 2: Adapter-Driven HTTP Call

**Use case**: Call external API using centralized adapter configuration.

**Benefits**:
- Configuration managed in adapter-service
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
  body: { id: "123", name: "Alice", ... },
  ...
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
// Client initiates workflow
POST /workflows
{
  name: "processOrder",
  application: "ecommerce",
  request: { orderId: "ORD-123" },
  actions: [
    // Step 1: Fetch order details
    {
      type: "endpointCall",
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
      type: "endpointCall",
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
      type: "endpointCall",
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
      type: "serviceBusCall",
      name: "sendConfirmation",
      args: {
        subject: "events.orders.confirmed",
        payload: {
          orderId: "{{request.orderId}}",
          transactionId: "{{results.validatePayment.data.transactionId}}",
          amount: "{{results.fetchOrder.data.total}}",
          timestamp: "{{workflow.startTime}}"
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
  actions: [
    // Fetch base user data
    {
      type: "endpointCall",
      name: "fetchUser",
      args: {
        adapterId: "user-service",
        endpointId: "getUser",
        params: { userId: "{{request.userId}}" }
      }
    },
    
    // Branch: Execute 3 parallel enrichments
    {
      type: "branch",
      name: "enrichParallel",
      args: {
        branches: [
          // Branch 1: Fetch purchase history
          [
            {
              type: "endpointCall",
              name: "fetchHistory",
              args: {
                adapterId: "ecommerce",
                endpointId: "getUserPurchases",
                params: { userId: "{{results.fetchUser.data.id}}" }
              }
            }
          ],
          
          // Branch 2: Fetch preferences
          [
            {
              type: "endpointCall",
              name: "fetchPreferences",
              args: {
                adapterId: "preferences-service",
                endpointId: "getUserPrefs",
                params: { userId: "{{results.fetchUser.data.id}}" }
              }
            }
          ],
          
          // Branch 3: Fetch loyalty points
          [
            {
              type: "endpointCall",
              name: "fetchLoyalty",
              args: {
                adapterId: "loyalty-service",
                endpointId: "getUserPoints",
                params: { userId: "{{results.fetchUser.data.id}}" }
              }
            }
          ]
        ]
      }
    },
    
    // Merge enriched data
    {
      type: "jsFunction",
      name: "mergeEnrichment",
      args: {
        code: `
          return {
            user: context.results.fetchUser.data,
            purchases: context.results.fetchHistory.data,
            preferences: context.results.fetchPreferences.data,
            loyalty: context.results.fetchLoyalty.data
          }
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
  actions: [
    // Check request amount
    {
      type: "endpointCall",
      name: "validateRequest",
      args: {
        method: "POST",
        url: "https://approval-service.example.com/validate",
        data: { amount: "{{request.amount}}" }
      }
    },
    
    // Conditional branch: approve or escalate
    {
      type: "jsFunction",
      name: "shouldApprove",
      args: {
        code: `
          const amount = parseInt(context.request.amount);
          const isApproved = context.results.validateRequest.data.approved;
          
          if (amount > 10000 || !isApproved) {
            return { action: "escalate", reason: "high_amount_or_validation_failed" };
          } else {
            return { action: "approve", reason: "auto_approved" };
          }
        `
      }
    },
    
    // Branch on decision
    {
      type: "branch",
      name: "approvalRoute",
      args: {
        branches: [
          // Branch A: Auto-approve (low amount, passed validation)
          [
            {
              type: "serviceBusCall",
              name: "publishApproved",
              args: {
                subject: "events.approvals.approved",
                payload: {
                  requestId: "{{request.requestId}}",
                  decision: "auto_approved",
                  timestamp: "{{workflow.startTime}}"
                }
              }
            }
          ],
          
          // Branch B: Escalate to manager (high amount or validation failed)
          [
            {
              type: "channelSend",
              name: "notifyManager",
              args: {
                channel: "email",
                recipient: "manager@example.com",
                subject: "Approval Request: {{request.requestId}}",
                body: "Request for {{request.amount}} requires manager approval.\nReason: {{results.shouldApprove.data.reason}}"
              }
            }
          ]
        ]
      }
    }
  ]
}

// Note: Both branches always execute in workflow
// For true if/then/else, use jsFunction to decide,
// then publish different events for downstream handling
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
  request: {
    userId: "user_123",
    templateId: "email_template_456"
  },
  actions: [
    // Step 1: Fetch user data
    {
      type: "serviceCall",
      name: "getUser",
      args: {
        service: "user-service",
        path: "/users/{{request.userId}}",  // {{request.X}} from initial request
        method: "GET"
      }
    },
    
    // Step 2: Fetch email template
    {
      type: "serviceCall",
      name: "getTemplate",
      args: {
        service: "template-service",
        path: "/templates/{{request.templateId}}",  // {{request.X}} from initial request
        method: "GET"
      }
    },
    
    // Step 3: Send email with templated content
    {
      type: "channelSend",
      name: "sendEmail",
      args: {
        channel: "email",
        recipient: "{{results.getUser.data.email}}",  // {{results.X.data.Y}} from step 1
        subject: "{{results.getTemplate.data.subject}}",  // {{results.X.data.Y}} from step 2
        body: "Hello {{results.getUser.data.firstName}},\n\n{{results.getTemplate.data.body}}"  // Nested template
      }
    },
    
    // Step 4: Log event with context
    {
      type: "serviceBusCall",
      name: "logSent",
      args: {
        subject: "events.emails.sent",
        payload: {
          userId: "{{request.userId}}",              // {{request.X}}
          email: "{{results.getUser.data.email}}",   // {{results.X.data.Y}}
          sentAt: "{{workflow.startTime}}",          // {{workflow.X}}
          workflowId: "{{workflow.id}}"              // {{workflow.X}}
        }
      }
    }
  ]
}

// Template scopes:
// - {{request.X}} — from initial workflow request
// - {{results.actionName.data.Y}} — from previous action result
// - {{workflow.id}} — workflow metadata
// - {{workflow.tenantId}} — tenant ID
// - {{workflow.startTime}} — workflow start time

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
  actions: [
    // Attempt 1: Call primary API
    {
      type: "endpointCall",
      name: "callPrimaryAPI",
      args: {
        method: "GET",
        url: "https://primary-api.example.com/data",
        timeout: 30000,
        retries: 3  // Automatic retries with exponential backoff
      }
    },
    
    // Evaluate result
    {
      type: "jsFunction",
      name: "checkSuccess",
      args: {
        code: `
          const result = context.results.callPrimaryAPI;
          if (result.status === 200) {
            return { success: true, data: result.body };
          } else if (result.status >= 500) {
            return { success: false, reason: "server_error", retry: true };
          } else {
            return { success: false, reason: "client_error", retry: false };
          }
        `
      }
    },
    
    // Conditional fallback
    {
      type: "branch",
      name: "fallbackStrategy",
      args: {
        branches: [
          // If success: publish result
          [
            {
              type: "serviceBusCall",
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
          [
            {
              type: "endpointCall",
              name: "callBackupAPI",
              args: {
                method: "GET",
                url: "https://backup-api.example.com/data",
                timeout: 30000,
                retries: 3
              }
            }
          ]
        ]
      }
    }
  ]
}

// Retry strategy:
// - HTTP Adapter automatically retries on:
//   - Network timeouts
//   - 5xx status codes
// - Does NOT retry:
//   - 4xx status codes (client error)
//   - Circuit breaker open
// - Backoff: 1s, 2s, 4s (exponential)
// - Max: 3 retries (configurable)

// Timeout behavior:
// - Default: 30s per attempt
// - If adapter configured: use adapter timeout
// - Activity timeout: 60s (3 attempts * 20s default)
// - Workflow timeout: 24 hours
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
  actions: [
    // Parse incoming request
    {
      type: "jsFunction",
      name: "parseRequest",
      args: {
        code: `
          const text = context.request.text;
          return {
            length: text.length,
            keywords: text.split(' '),
            receivedAt: new Date().toISOString()
          };
        `
      }
    },
    
    // Invoke AI agent for classification
    {
      type: "agentCall",
      name: "classifyMessage",
      args: {
        agentId: "message-classifier-v2",
        input: "{{request.text}}",
        context: {
          messageLength: "{{results.parseRequest.data.length}}",
          timestamp: "{{results.parseRequest.data.receivedAt}}"
        },
        systemPrompt: "Classify messages as: URGENT, NORMAL, or LOW_PRIORITY. Respond with JSON: {classification, confidence, reason}"
      }
    },
    
    // Route based on classification
    {
      type: "branch",
      name: "routeByPriority",
      args: {
        branches: [
          // High confidence urgent: escalate immediately
          [
            {
              type: "channelSend",
              name: "escalateUrgent",
              args: {
                channel: "sms",
                recipient: "+1-555-0100",
                message: "URGENT: {{request.text}} [Confidence: {{results.classifyMessage.data.confidence}}%]"
              }
            }
          ],
          
          // Normal priority: queue for processing
          [
            {
              type: "serviceBusCall",
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
        ]
      }
    }
  ]
}

// Agent call characteristics:
// - Async: Agent processes request autonomously
// - Timeout: 60s (configurable)
// - Context: Passed to agent for reasoning
// - Output: Structured (expects JSON response)
// - Idempotent: Can be retried on failure
```

---

## Pattern 9: Audit Trail & Logging

**Use case**: Maintain complete execution history for compliance.

**Recipe**:

```
POST /workflows
{
  name: "auditedTransaction",
  actions: [
    // Step 1: Log transaction start
    {
      type: "serviceBusCall",
      name: "logStart",
      args: {
        subject: "events.transactions.started",
        payload: {
          transactionId: "{{request.transactionId}}",
          userId: "{{request.userId}}",
          amount: "{{request.amount}}",
          timestamp: "{{workflow.startTime}}",
          workflowId: "{{workflow.id}}"
        }
      }
    },
    
    // Step 2: Execute transaction
    {
      type: "endpointCall",
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
      type: "serviceBusCall",
      name: "logSuccess",
      args: {
        subject: "events.transactions.completed",
        payload: {
          transactionId: "{{request.transactionId}}",
          workflowId: "{{workflow.id}}",
          chargeId: "{{results.executeTransaction.data.chargeId}}",
          status: "{{results.executeTransaction.data.status}}",
          duration: "{{results.executeTransaction.data.duration}}",
          completedAt: "{{workflow.endTime}}"
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
  request: {
    orderId: "ORD-123",
    callbackUrl: "https://callback-service/webhook"
  },
  actions: [
    // Execute primary steps...
    
    // Trigger secondary workflow and subscribe to result
    {
      type: "serviceBusCall",
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
  request: {
    orderId: "ORD-123",
    callbackUrl: "https://callback-service/webhook"
  },
  actions: [
    // Execute async operations (e.g., generate report, process in background)
    {
      type: "sleep",
      name: "allowAsyncProcessing",
      args: { duration: 5000 }
    },
    
    // Notify completion
    {
      type: "endpointCall",
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
| Conditional | if/then/else logic | jsFunction + branch |
| Template substitution | Dynamic arguments | {{path.to.value}} syntax |
| Error handling | Failure recovery | Retries + fallback branches |
| AI classification | Intelligent routing | agentCall action type |
| Audit trail | Compliance logging | serviceBusCall events |
| Async chaining | Long-running workflows | Event-driven callbacks |

---

## Further Reading

- [HTTP Adapter README](../services/http-adapter/README.md) — Direct API calls
- [Workflow Service README](../services/workflow-service/README.md) — Orchestration
- [HTTP Adapter vs Workflow Service](./HTTP-ADAPTER-VS-WORKFLOW-SERVICE.md) — Decision guide
- [@yoizen/shared](../packages/shared/README.md) — Type definitions
- [Service Architecture Diagrams](./SERVICE-ARCHITECTURE-DIAGRAM.md) — Visual flows
