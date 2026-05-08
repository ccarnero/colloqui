# Service Architecture Diagrams

This document provides visual diagrams of the platform's service architecture, focusing on the refactored HTTP Adapter and Workflow Service boundary, multi-tenancy patterns, and data flow.

## 1. Service Boundary & Communication

High-level view of core services and their interactions:

```mermaid
graph TB
    Client["HTTP Client<br/>(Gateway)"]
    
    subgraph "Workflow Orchestration"
        WFA["workflow-service API<br/>(NestJS REST)"]
        WFW["workflow-service Worker<br/>(Temporal Orchestrator)"]
    end
    
    subgraph "HTTP Execution"
        HAW["http-adapter<br/>(Temporal Worker)"]
    end
    
    subgraph "Configuration"
        ADA["adapter-service<br/>(NestJS REST)"]
    end
    
    subgraph "AI & Agents"
        YCR["yoizenclaw-runtime<br/>(Agent Execution)"]
    end
    
    subgraph "Messaging & Events"
        NATS["NATS JetStream<br/>(Event Broker)"]
    end
    
    subgraph "Data"
        TEMPORAL["Temporal Server<br/>(Workflow Engine)"]
        REDIS["Redis<br/>(Cache)"]
        PG["Per-tenant Postgres<br/>(Workflow Storage)"]
    end
    
    Client -->|HTTP /workflows| WFA
    WFA -->|gRPC| TEMPORAL
    WFA -->|Pool by tenantId| PG
    
    TEMPORAL -->|Activity Tasks<br/>workflow-orchestrator Queue| WFW
    TEMPORAL -->|Activity Tasks<br/>http-adapter Queue| HAW
    
    WFW -->|endpointCall<br/>serviceCall| HAW
    WFW -->|agentCall| YCR
    WFW -->|serviceBusCall<br/>channelSend| NATS
    
    HAW -->|Adapter Config<br/>Cache Misses| ADA
    HAW -->|Cache Storage| REDIS
    
    PG -->|Tenant Isolation| PG
    
    style WFA fill:#e1f5ff
    style WFW fill:#e1f5ff
    style HAW fill:#fff3e0
    style ADA fill:#f3e5f5
    style YCR fill:#e8f5e9
    style NATS fill:#fce4ec
    style TEMPORAL fill:#ede7f6
    style REDIS fill:#e0f2f1
    style PG fill:#f1f8e9
```

**Key Points**:
- **workflow-service** splits into API (REST) and Worker (Temporal orchestration)
- **http-adapter** is a separate Temporal worker for HTTP execution
- **adapter-service** provides config; http-adapter caches in Redis
- **Per-tenant Postgres** isolates workflow data by tenant
- **NATS** handles event publishing from workflows

---

## 2. Workflow Execution Timeline

How a workflow request flows through the system:

```mermaid
sequenceDiagram
    participant Client
    participant WF as workflow-service<br/>API
    participant TEMPORAL as Temporal<br/>Server
    participant WFW as workflow-service<br/>Worker
    participant HAW as http-adapter<br/>Worker
    participant EXT as External<br/>Endpoint
    participant REDIS as Redis<br/>Cache
    participant ADA as adapter-service
    
    Client->>WF: POST /workflows<br/>{actions: [...]}
    WF->>WF: Validate DTO<br/>Resolve tenantId
    WF->>TEMPORAL: workflow.start('runWorkflow', {...})
    TEMPORAL->>TEMPORAL: Queue on workflow-orchestrator<br/>task queue
    TEMPORAL-->>WF: 202 Accepted<br/>workflowId
    WF-->>Client: Return workflowId
    
    Note over TEMPORAL: Orchestrator picks up workflow task
    TEMPORAL->>WFW: Deliver workflow task
    WFW->>WFW: runWorkflow() starts<br/>Iterate actions
    
    alt Action: endpointCall
        WFW->>TEMPORAL: Dispatch activity task<br/>http-adapter queue
        TEMPORAL->>TEMPORAL: Queue activity<br/>http-adapter queue
        TEMPORAL->>HAW: Deliver activity task
        
        HAW->>REDIS: Check adapter config<br/>cache?
        alt Cache hit
            REDIS-->>HAW: Config (fresh)
        else Cache miss
            HAW->>ADA: GET /adapters/{id}
            ADA-->>HAW: {baseUrl, auth, ...}
            HAW->>REDIS: Store in cache<br/>TTL 300s
        end
        
        HAW->>EXT: tracedFetch<br/>with adapter config
        EXT-->>HAW: {status, body}
        HAW->>TEMPORAL: Return result
        TEMPORAL-->>WFW: Activity result
    end
    
    WFW->>WFW: Store result in<br/>execution context
    WFW->>WFW: Next action: resolve<br/>templates, execute
    
    WFW->>TEMPORAL: Workflow complete
    TEMPORAL-->>Client: (query /workflows/:id)
    Client->>WF: GET /workflows/:id
    WF->>TEMPORAL: workflow.describe(id)
    TEMPORAL-->>WF: {status: COMPLETED, result}
    WF-->>Client: Return result
```

**Key Moments**:
1. Client POSTs workflow definition
2. workflow-service API validates and starts Temporal workflow
3. Temporal queues workflow task on orchestrator queue
4. Worker picks up, iterates actions
5. For HTTP actions: dispatch to http-adapter queue
6. http-adapter resolves adapter config (cache hit/miss)
7. Execute HTTP call, return result
8. Next action can use previous result via templates
9. Client queries for status/result

---

## 3. Adapter Configuration Resolution Flow

How http-adapter resolves adapter-driven requests:

```mermaid
graph TB
    REQ["HTTP Request<br/>adapterId: 'crm'<br/>endpointId: 'getCustomer'"]
    AC["AdapterClient<br/>.resolveRequest()"]
    REDIS["Redis Cache<br/>Key: adapter:tenant:crm"]
    
    subgraph "Cache Miss Path"
        ADA["adapter-service<br/>REST API"]
        MERGE["Merge Config<br/>baseUrl +<br/>endpoint.path"]
        AUTH["Resolve Auth<br/>(OAuth2 tokens)"]
        HEADERS["Merge Headers<br/>(default +<br/>custom)"]
        FINAL["Return Resolved<br/>URL, Headers,<br/>Timeout, Retries"]
        STORE["Cache in Redis<br/>TTL: 300s<br/>Stale: 60s"]
    end
    
    subgraph "Cache Hit Path"
        FRESH["Config Fresh?"]
        USE["Use Cached<br/>Config"]
        STALE["Serving Stale<br/>Refresh in BG"]
    end
    
    REQ -->|AdapterClient| AC
    AC -->|Check cache| REDIS
    
    REDIS -->|Hit| FRESH
    REDIS -->|Miss| ADA
    
     FRESH -->|Yes| USE
     FRESH -->|No stale| STALE
    
    ADA -->|GET /adapters/crm| MERGE
    MERGE -->|Combine| AUTH
    AUTH -->|Add token| HEADERS
    HEADERS -->|Add tenant| FINAL
    FINAL -->|Store| STORE
    STORE -->|Return| USE
    STALE -->|Background| ADA
    
    USE -->|Resolved| EXEC["Execute HTTP Call<br/>tracedFetch"]
    
    style AC fill:#fff3e0
    style REDIS fill:#e0f2f1
    style ADA fill:#f3e5f5
    style EXEC fill:#e8f5e9
```

**Cache Strategy**:
- **TTL**: 300 seconds (adapter configs valid for 5 minutes)
- **Stale window**: 60 seconds (serve stale while refreshing)
- **Background refresh**: On stale hit, refresh in background, serve cached value immediately
- **Miss**: Fetch from adapter-service synchronously

---

## 4. Multi-Tenant Data Isolation

How tenant information flows through the system and ensures isolation:

```mermaid
graph TB
    CLIENT["Client Request<br/>Header: x-yoizen-tenant: acme"]
    
    GATEWAY["API Gateway<br/>Extract tenant from header<br/>Validate tenant scope"]
    
    subgraph "Service Layer"
        WF["workflow-service<br/>Tenant ID: acme"]
        HA["http-adapter<br/>Tenant ID: acme"]
        ADA["adapter-service<br/>Tenant ID: acme"]
    end
    
    subgraph "Data Layer"
        PG_ACME["Postgres Instance<br/>postgres.acme-dev-ns<br/>Database: acme_dev<br/>Tables: workflow_*"]
        NATS_ACME["NATS Subjects<br/>events.acme.*<br/>results.acme.*"]
        REDIS_ACME["Redis Keys<br/>adapter:acme:*<br/>callback:acme:*"]
    end
    
    CLIENT -->|/workflows| GATEWAY
    GATEWAY -->|Tenant: acme| WF
    WF -->|Tenant: acme| PG_ACME
    WF -->|Subject: events.acme.*| NATS_ACME
    WF -->|Activity to http-adapter<br/>TenantId attribute| HA
    
    HA -->|Header: x-yoizen-tenant: acme| ADA
    ADA -->|Query acme adapters| PG_ACME
    
    HA -->|Cache keys: adapter:acme:*| REDIS_ACME
    
    CLIENT2["Client Request<br/>Header: x-yoizen-tenant: demo"]
    GATEWAY -->|Tenant: demo| WF
    WF -->|Tenant: demo| PG_DEMO["Postgres Instance<br/>postgres.demo-dev-ns<br/>Database: demo_dev<br/>Tables: workflow_*"]
    
    style CLIENT fill:#e3f2fd
    style CLIENT2 fill:#fce4ec
    style GATEWAY fill:#fff9c4
    style WF fill:#e1f5ff
    style HA fill:#fff3e0
    style ADA fill:#f3e5f5
    style PG_ACME fill:#c8e6c9
    style PG_DEMO fill:#f8bbd0
    style NATS_ACME fill:#fce4ec
    style REDIS_ACME fill:#e0f2f1
```

**Isolation Boundaries**:
1. **Header**: `x-yoizen-tenant` propagates through all layers
2. **Database**: Each tenant gets their own Postgres instance
3. **NATS**: Subjects include tenant ID prefix
4. **Redis**: Cache keys include tenant scope
5. **Temporal**: Search attribute `TenantId` for workflow queries

---

## 5. Temporal Task Queue Architecture

Two independent task queues with different concurrency models:

```mermaid
graph TB
    TEMPORAL["Temporal Server"]
    
    subgraph "workflow-orchestrator Queue"
        COORD["Activity Coordination"]
        JS["jsFunction<br/>Local Activity"]
        SB["serviceBusCall<br/>Local Activity"]
        CH["channelSend<br/>Local Activity"]
        AG["agentCall<br/>Local Activity"]
    end
    
    subgraph "http-adapter Queue"
        HTTP["HTTP Execution"]
        EP["endpointCall<br/>Remote Activity"]
        SC["serviceCall<br/>Remote Activity"]
    end
    
    subgraph "Workers"
        WFW["workflow-service<br/>Worker Process<br/>Concurrency: 100 workflows<br/>50 activities"]
        HAW["http-adapter<br/>Worker Process<br/>Concurrency: 200 activities"]
    end
    
    subgraph "Scaling"
        KEDA_WF["KEDA Scaler<br/>Monitor: orchestrator<br/>queue depth<br/>Min: 1, Max: 3<br/>Cooldown: 300s"]
        KEDA_HA["KEDA Scaler<br/>Monitor: http-adapter<br/>queue depth<br/>Min: 1, Max: 20<br/>Cooldown: 300s"]
    end
    
    TEMPORAL -->|Dispatch| COORD
    COORD -->|Local| JS
    COORD -->|Local| SB
    COORD -->|Local| CH
    COORD -->|Remote| TEMPORAL
    
    TEMPORAL -->|Dispatch| HTTP
    HTTP -->|Remote| EP
    HTTP -->|Remote| SC
    
    COORD -->|Register| WFW
    HTTP -->|Register| HAW
    
    KEDA_WF -->|Monitor depth<br/>Scale replicas| WFW
    KEDA_HA -->|Monitor depth<br/>Scale replicas| HAW
    
    style TEMPORAL fill:#ede7f6
    style WFW fill:#e1f5ff
    style HAW fill:#fff3e0
    style KEDA_WF fill:#f1f8e9
    style KEDA_HA fill:#f1f8e9
```

**Queue Design**:
- **workflow-orchestrator**: Coordinates multi-step execution; local activities (JS, NATS) run inline
- **http-adapter**: Specialized for HTTP; high concurrency (200) to handle network latency
- **Separate scaling**: Each queue scales independently based on task depth
- **Temporal dispatch**: Remote activities (endpointCall) dispatch back to Temporal for load balancing

---

## 6. Action Execution Paths

Different routing based on action type:

```mermaid
graph TB
    WF["workflow-service<br/>runWorkflow()"]
    
    WF -->|Action Type?| SWITCH{Switch}
    
    SWITCH -->|endpointCall<br/>serviceCall| HAQ["Dispatch to<br/>http-adapter<br/>task queue"]
    SWITCH -->|jsFunction| JS["Local Activity<br/>executeJsFunction"]
    SWITCH -->|serviceBusCall| SB["Local Activity<br/>executeServiceBusCall<br/>→ NATS"]
    SWITCH -->|channelSend| CH["Local Activity<br/>executeChannelSend<br/>→ channel-service"]
    SWITCH -->|agentCall| AG["Remote Activity<br/>→ yoizenclaw-runtime"]
    SWITCH -->|branch| BR["Promise.all<br/>Parallel execution"]
    SWITCH -->|sleep| SLP["Temporal timer"]
    
    HAQ -->|Pull activity| HAW["http-adapter<br/>Worker"]
    HAW -->|tracedFetch| EXT["External<br/>Endpoint"]
    
    JS -->|Inline| EXEC["new Function()<br/>eval JS"]
    
    SB -->|Publish| NATS["NATS Subject"]
    
    CH -->|Send message| CHAN["Channel<br/>Delivery<br/>email/SMS/etc"]
    
    AG -->|Agent execution| YCR["YoizenClaw<br/>Runtime"]
    
    BR -->|Each branch| SUB["Sub-action<br/>sequence"]
    
    SLP -->|Timer| TIMER["Temporal<br/>Sleep"]
    
    style WF fill:#e1f5ff
    style HAW fill:#fff3e0
    style YCR fill:#e8f5e9
    style NATS fill:#fce4ec
    style EXEC fill:#ede7f6
```

**Routing Logic**:
- **Remote activities** (endpointCall, serviceCall, agentCall): Dispatch to task queue, await result
- **Local activities** (jsFunction, serviceBusCall, channelSend): Execute inline, await result
- **Control flow** (branch, sleep): Temporal native (no activity)
- **Error handling**: Failed action blocks workflow (no automatic compensation)

---

## 7. Per-Tenant Postgres Connection Pattern

How workflow-service maintains isolated connections per tenant:

```mermaid
graph TB
    MULTI["API Request Handler<br/>tenantId: acme"]
    
    MGR["WorkflowTenantConnectionManager"]
    
    subgraph "Connection Pool Map"
        POOL1["pool[acme]<br/>→ postgres.acme-dev-ns"]
        POOL2["pool[demo]<br/>→ postgres.demo-dev-ns"]
        POOL3["pool[...]"]
    end
    
    MULTI -->|ensureSchema| MGR
    
    MGR -->|Lookup| LOOKUP{Pool exists?}
    
    LOOKUP -->|Yes| POOL1
    LOOKUP -->|No| CREATE["Create new pool<br/>to postgres.acme-dev-ns"]
    
    CREATE -->|Initialize| SCHEMA["Register WORKFLOW_SCHEMA_SQL<br/>CREATE TABLE IF NOT EXISTS<br/>workflow_definitions<br/>workflow_executions"]
    
    SCHEMA -->|Cache pool| POOL1
    
    POOL1 -->|Query| EXEC["SELECT * FROM<br/>workflow_executions<br/>WHERE id = $1"]
    
    POOL2 -->|Query| EXEC2["SELECT * FROM<br/>workflow_executions<br/>WHERE id = $1<br/>(different instance)"]
    
    style MULTI fill:#e1f5ff
    style MGR fill:#fff9c4
    style POOL1 fill:#c8e6c9
    style POOL2 fill:#f8bbd0
    style SCHEMA fill:#f3e5f5
```

**Connection Strategy**:
- **Per-tenant pools**: Each tenant gets a dedicated Postgres connection pool
- **Lazy creation**: Pools created on first access to tenant
- **Schema registration**: `workflow_definitions` and `workflow_executions` created idempotently
- **No shared table**: No `tenant_id` column; database is the boundary
- **DNS resolution**: K8s DNS resolves `postgres.{tenantId}-{env}-ns.svc.cluster.local`

---

## 8. Circuit Breaker & Retry Flow (http-adapter)

How http-adapter handles failures and protects against cascading failures:

```mermaid
stateDiagram-v2
    [*] --> CLOSED
    
    CLOSED --> CLOSED: Request succeeds
    CLOSED --> OPEN: Failure threshold exceeded
    
    OPEN --> OPEN: Fail fast
    OPEN --> HALF_OPEN: Cooldown expired
    
    HALF_OPEN --> CLOSED: Test request succeeds
    HALF_OPEN --> OPEN: Test request fails
    
    CLOSED --> RETRY: Request fails (transient)
    RETRY --> RETRY: Backoff + retry
    RETRY --> CLOSED: Retry succeeds
    RETRY --> OPEN: Max retries exceeded
```

**Behavior**:
1. **Normal (CLOSED)**: Execute requests, track failures
2. **Degraded (OPEN)**: Fail fast, return 503, don't attempt request
3. **Recovery (HALF_OPEN)**: Allow one test request; success closes circuit, failure reopens
4. **Retries**: Exponential backoff for transient failures (network timeout, 5xx)
5. **Non-retryable**: 4xx status codes fail immediately

---

## Summary

The refactored architecture separates concerns into:

1. **Workflow Orchestration** (`workflow-service`) — Coordinates multi-step execution
2. **HTTP Execution** (`http-adapter`) — Specialized worker for HTTP calls with adapter resolution
3. **Configuration** (`adapter-service`) — Manages adapter configs, cached by http-adapter
4. **AI & Agents** (`yoizenclaw-runtime`) — Autonomous agent execution
5. **Multi-tenancy** — Per-tenant Postgres, NATS subject prefixes, header propagation
6. **Temporal Task Queues** — Two independent queues for independent scaling

This design enables:
- **Independent scaling**: HTTP-heavy workloads scale http-adapter separately
- **Tenant isolation**: Per-tenant databases prevent cross-tenant data leakage
- **High concurrency**: 200 parallel HTTP requests per http-adapter replica
- **Resilience**: Circuit breaker + retries protect against cascading failures
- **Observability**: Each action traces through Temporal with OpenTelemetry instrumentation
