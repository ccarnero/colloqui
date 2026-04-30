# YoizenClaw Adapter Tools - Architecture Diagrams

## 1. High-Level Architecture

```mermaid
graph TB
    subgraph "Admin Console (Angular)"
        UI[Agent Config UI]
        AD[Adapter Dropdown]
        ED[Endpoint Dropdown]
    end

    subgraph "yoizenclaw-admin-service (NestJS)"
        AC[AgentsController]
        AV[AdapterProxyService]
        ADTO[AdapterReferenceDto]
    end

    subgraph "adapter-service (NestJS)"
        AR[AdaptersController]
        DB[(PostgreSQL)]
    end

    subgraph "YoizenClaw Runtime (Python)"
        TE[ToolExecutor]
        AE[AdapterToolExecutor]
        AC_PY[AdapterClient]
        CACHE[(LRU Cache)]
    end

    subgraph "External APIs"
        SF[Salesforce API]
        HB[HubSpot API]
        CUSTOM[Custom API]
    end

    UI --> AC
    AC --> AV
    ADTO --> AC
    AV --> AR
    AR --> DB

    TE --> AE
    AE --> AC_PY
    AC_PY --> CACHE
    AC_PY --> AR
    
    AE --> SF
    AE --> HB
    AE --> CUSTOM

    style UI fill:#e1f5fe
    style TE fill:#f3e5f5
    style AE fill:#f3e5f5
    style AC_PY fill:#fff3e0
    style AR fill:#e8f5e9
```

## 2. Configuration Flow

```mermaid
sequenceDiagram
    participant User as Admin User
    participant UI as Admin Console
    participant Admin as yoizenclaw-admin
    participant Adapter as adapter-service
    participant DB as PostgreSQL

    Note over User,DB: Configuration Phase

    User->>UI: Crear/Editar Agente
    UI->>UI: Click "Add Tool"
    UI->>UI: Select "Tool Source: Adapter"
    
    UI->>Admin: GET /admin/adapters
    Admin->>Adapter: GET /adapters (proxy)
    Adapter->>DB: SELECT adapters WHERE tenant_id
    DB-->>Adapter: adapter list
    Adapter-->>Admin: adapters (sin credentials)
    Admin-->>UI: adapter list

    User->>UI: Select adapter "salesforce"
    UI->>Admin: GET /admin/adapters/salesforce
    Admin->>Adapter: GET /adapters/salesforce
    Adapter-->>Admin: adapter con endpoints
    Admin-->>UI: endpoints list

    User->>UI: Select endpoint "get-contact"
    UI->>UI: Preview shows: URL, Method, Auth

    User->>UI: Save Agent
    UI->>Admin: POST /admin/agents
    Note right of UI: {tools: [{name, adapterRef: {adapterId, endpointId}}]}
    Admin->>Admin: Validate adapterRef
    Admin->>DB: INSERT/UPDATE agent config
    Admin-->>UI: 201 Created
```

## 3. Execution Flow

```mermaid
sequenceDiagram
    participant User as End User
    participant Runtime as YoizenClaw Runtime
    participant TE as ToolExecutor
    participant AE as AdapterToolExecutor
    participant AC as AdapterClient
    participant Cache as LRU Cache
    participant AS as adapter-service
    participant External as External API

    Note over User,External: Execution Phase

    User->>Runtime: Send message to agent
    Runtime->>Runtime: LLM decides to use tool
    Runtime->>TE: execute_tool(name, payload)
    
    TE->>TE: Lookup tool definition
    TE->>TE: Check for adapterRef
    
    alt adapterRef present
        TE->>AE: execute(adapterRef, payload, tenant_id)
        
        AE->>AC: resolve_request(adapterId, endpointId)
        AC->>Cache: check cache
        Cache-->>AC: cache status
        alt valid (soft TTL)
            AC-->>AE: adapter context
            Note right of AE: headers contain auth tokens
        else
            AC->>AS: GET /adapters/{id}
            
            rect rgb(255,200,200)
                Note right of AC: Headers: X-Yoizen-Tenant
            end
            AS-->>AC: adapter config
            AC->>Cache: store (60s/300s TTL)
        end
        
        Note right of AE: Build request:
        rect rgb(240,248,255)
            Note right of AE
                url = baseUrl + path
                method = endpoint.method
                headers = auth + custom
                X-Yoizen-Tenant = tenant_id
            end
        
        AE->>External: HTTP request
        
        rect rgb(255,255,200)
            Note right of AE
                POST /api/contacts
                Authorization: Bearer ***
                X-Yoizen-Tenant: acme-corp
            end
        
        External-->>AE: response JSON
        
        Note right of AE: Truncate if >100KB
        
        rect rgb(200,220,220)
            Note right of AE
                if len(response) > max_bytes:
                    response = truncate(response)
                    response["_truncated"] = True
                    response["_original_size"] = size
            end
        
        AE-->>TE: result dict
    else no adapterRef (HTTP/NATS)
        TE->>TE: execute_configured_tool(endpoint)
    end
    
    TE-->>Runtime: result
    Runtime->>Runtime: Continue conversation
    Runtime-->>User: Agent response
```

## 4. Adapter Client Cache Strategy

```mermaid
flowchart TB
    subgraph "AdapterClient.resolve_request()"
        START([Start]) --> CHECK{Check Cache}
        
        CHECK -->|Key exists| TTL{Soft TTL<br/>expired?}
        CHECK -->|Key missing| FETCH[Fetch from<br/>adapter-service]
        
        TTL -->|No| RETURN1[Return cached<br/>adapter config]
        TTL -->|Yes| REFRESH[Refresh in background]
        REFRESH --> R2{Fetch successful?}
        
        R2 -->|Yes| UPDATE[Update cache<br/>return fresh]
        R2 -->|No| STALE[Return stale<br/>data + log warning]
        
        FETCH --> F2{Fetch successful?}
        F2 -->|Yes| CACHE[Store in cache<br/>with TTLs]
        F2 -->|No| ERR[Throw<br/>AdapterNotFoundError]
        CACHE --> RETURN2[Return adapter config]
    end

    style START fill:#e8f5e9
    style RETURN1 fill:#c8e6c9
    style RETURN2 fill:#c8e6c9
    style UPDATE fill:#c8e6c9
    style STALE fill:#fff9c4
    style ERR fill:#ffcdd2
    style FETCH fill:#bbdefb
    style REFRESH fill:#bbdefb
```

## 5. Data Models

```mermaid
classDiagram
    class AgentToolPayload {
        +string id
        +string name
        +string endpoint
        +string method
        +dict headers
        +dict body_template
        +bool enabled
        +AdapterReference adapter_ref
    }

    class AdapterReference {
        +string adapter_id
        +string endpoint_id
    }

    class AdapterConfig {
        +string id
        +string base_url
        +string auth_type
        +dict auth_config
        +list headers
        +int timeout_ms
        +int max_retries
        +int retry_backoff_ms
        +list~AdapterEndpointConfig~ endpoints
    }

    class AdapterEndpointConfig {
        +string id
        +string label
        +string path
        +string method
    }

    class ResolvedAdapterRequest {
        +string url
        +string method
        +dict headers
        +int timeout_ms
        +int max_retries
        +int retry_backoff_ms
    }

    AgentToolPayload --> AdapterReference : optional
    AdapterConfig --> AdapterEndpointConfig : has many
    AdapterConfig --> ResolvedAdapterRequest : resolves to

    note for AgentToolPayload "endpoint OR adapterRef\n(mutual exclusion)"
    note for ResolvedAdapterRequest "Built by AdapterClient\nwith auth headers injected"
```

## 6. Auth Header Injection

```mermaid
flowchart LR
    subgraph "Auth Types"
        NONE[none]
        API_KEY[api-key]
        BEARER[bearer]
        BASIC[basic]
        OAUTH2[oauth2-client]
    end

    subgraph "Headers Injected"
        H1["No auth headers"]
        H2["X-Api-Key: {key}<br/>or custom header"]
        H3["Authorization: Bearer {token}"]
        H4["Authorization: Basic base64(user:pass)"]
        H5["Authorization: Bearer {client_token}"]
    end

    NONE --> H1
    API_KEY --> H2
    BEARER --> H3
    BASIC --> H4
    OAUTH2 --> H5

    style NONE fill:#f5f5f5
    style API_KEY fill:#e3f2fd
    style BEARER fill:#e8f5e9
    style BASIC fill:#fff3e0
    style OAUTH2 fill:#fce4ec
```

## 7. Error Handling Flow

```mermaid
flowchart TB
    START([Tool Execution]) --> CHECK{adapterRef<br/>present?}
    
    CHECK -->|No| HTTP[Execute HTTP<br/>tool directly]
    CHECK -->|Yes| FLAG{Feature flag<br/>enabled?}
    
    FLAG -->|No| DISABLED[Return:<br/>"Adapter tools disabled"]
    FLAG -->|Yes| RESOLVE[Resolve adapter<br/>config]
    
    RESOLVE --> FOUND{Adapter<br/>found?}
    FOUND -->|No| NOT_FOUND[Return:<br/>AdapterNotFoundError]
    FOUND -->|Yes| ENDPOINT{Endpoint<br/>found?}
    
    ENDPOINT -->|No| EP_NOT_FOUND[Return:<br/>EndpointNotFoundError]
    ENDPOINT -->|Yes| TIMEOUT{Timeout<br/>configured?}
    
    TIMEOUT -->|Yes| SLOW[SLOW: Use stale<br/>cached data]
    TIMEOUT -->|No| FETCH[Fetch fresh<br/>config]
    
    FETCH --> EXECUTE[Execute HTTP<br/>request]
    SLOW --> EXECUTE
    
    EXECUTE --> HTTP_CODE{HTTP<br/>status?}
    
    HTTP_CODE -->|2xx| SUCCESS[Return response<br/>truncated if >100KB]
    HTTP_CODE -->|4xx| CLIENT_ERR[Return:<br/>ClientError with context]
    HTTP_CODE -->|5xx| SERVER_ERR[Return:<br/>ServerError with context]
    HTTP_CODE -->|Timeout| TIMEOUT_ERR[Return:<br/>TimeoutError]
    
    style NOT_FOUND fill:#ffcdd2
    style EP_NOT_FOUND fill:#ffcdd2
    style CLIENT_ERR fill:#fff9c4
    style SERVER_ERR fill:#ffcdd2
    style TIMEOUT_ERR fill:#ffcdd2
    style SUCCESS fill:#c8e6c9
    style DISABLED fill:#e0e0e0
```

## 8. UI Component Structure

```mermaid
graph TB
    subgraph "Angular Components"
        FORM[AgentFormComponent]
        TOOLS[ToolsSectionComponent]
        TOOL[ToolConfigComponent]
        HTTP[HttpToolFormComponent]
        ADAPTER[ToolAdapterFormComponent]
        PREVIEW[AdapterPreviewComponent]
    end

    subgraph "Services"
        AGENT_SVC[AgentsService]
        ADAPTER_SVC[AdaptersService]
    end

    subgraph "State"
        SIGNAL[Tool Source Signal]
        ADAPTER_SIG[Selected Adapter Signal]
    end

    FORM --> TOOLS
    TOOLS --> TOOL
    TOOL --> HTTP
    TOOL --> ADAPTER
    ADAPTER --> PREVIEW

    ADAPTER --> AGENT_SVC
    ADAPTER --> ADAPTER_SVC
    ADAPTER --> SIGNAL
    ADAPTER --> ADAPTER_SIG

    SIGNAL -->|"'http'"| HTTP
    SIGNAL -->|"'adapter'"| ADAPTER

    style FORM fill:#e1f5fe
    style ADAPTER fill:#fff3e0
    style PREVIEW fill:#e8f5e9
```

## 9. File Structure

```mermaid
graph LR
    subgraph "Python (yoizenclaw-application)"
        PY1[src/shared/adapter_client.py]
        PY2[src/tools/adapter_executor.py]
        PY3[src/application/agents/tool_executor.py]
        PY4[src/shared/config/agent_config.py]
        PY5[src/shared/di/providers.py]
        PY6[tests/test_adapter_client.py]
        PY7[tests/test_adapter_executor.py]
    end

    subgraph "NestJS (admin-service)"
        TS1[src/modules/agents/agents.dto.ts]
        TS2[src/modules/adapters/adapters.controller.ts]
        TS3[src/modules/admin/admin-proxy.service.ts]
        TS4[test/agents/adapter-ref-validation.test.ts]
    end

    subgraph "Angular (admin-console)"
        NG1[tool-adapter-form.component.ts]
        NG2[adapters.service.ts]
        NG3[yoizenclaw.component.ts]
    end

    PY1 --> PY2
    PY2 --> PY3
    PY4 --> PY2
    PY5 --> PY1
    PY5 --> PY2

    TS1 --> TS3

    NG2 --> NG1
    NG1 --> NG3

    style PY1 fill:#f3e5f5
    style PY2 fill:#f3e5f5
    style TS1 fill:#e8f5e9
    style NG1 fill:#e1f5fe
    style NG2 fill:#e1f5fe
```

## 10. Deployment & Feature Rollout

```mermaid
flowchart LR
    subgraph "Phase 1: Deploy"
        DEPLOY[Deploy code with<br/>YOIZENCLAW_ADAPTER_TOOLS_ENABLED=false]
    end

    subgraph "Phase 2: Test"
        TEST1[Enable flag in staging]
        TEST2[Run integration tests]
        TEST3[Run E2E tests]
        TEST4[Security audit]
    end

    subgraph "Phase 3: Canary"
        CANARY[Enable for single<br/>tenant via env var]
        MONITOR1[Monitor metrics]
        MONITOR2[Check error rates]
    end

    subgraph "Phase 4: GA"
        GA[Enable globally]
        MONITOR3[Monitor all tenants]
        CLEANUP[Remove feature flag<br/>after validation]
    end

    DEPLOY --> TEST1
    TEST1 --> TEST2
    TEST2 --> TEST3
    TEST3 --> TEST4
    TEST4 --> CANARY
    CANARY --> MONITOR1
    MONITOR1 --> MONITOR2
    MONITOR2 --> GA
    GA --> MONITOR3
    MONITOR3 --> CLEANUP

    style DEPLOY fill:#e3f2fd
    style TEST1 fill:#fff3e0
    style TEST2 fill:#fff3e0
    style TEST3 fill:#fff3e0
    style TEST4 fill:#fff3e0
    style CANARY fill:#e8f5e9
    style GA fill:#c8e6c9
    style CLEANUP fill:#c8e6c9
```

---

## Quick Reference

| Component | File | Key Class/Function |
|-----------|------|-------------------|
| **AdapterClient (Python)** | `adapter_client.py` | `get_adapter()`, `resolve_request()` |
| **AdapterToolExecutor** | `adapter_executor.py` | `execute()` |
| **ToolExecutor** | `tool_executor.py` | `_execute_configured_tool()` |
| **AdapterReference (Py)** | `agent_config.py` | `AdapterReference` model |
| **AdapterReferenceDto (TS)** | `agents.dto.ts` | validation decorators |
| **AdaptersController** | `adapters.controller.ts` | `GET /admin/adapters` |
| **ToolAdapterFormComponent** | `tool-adapter-form.component.ts` | UI for adapter selection |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `YOIZENCLAW_ADAPTER_TOOLS_ENABLED` | `false` | Feature flag for adapter tools |
| `ADAPTER_SERVICE_URL` | - | adapter-service base URL |
| `YOIZENCLAW_TOOL_RESPONSE_MAX_BYTES` | `100000` | Response truncation limit |
| `ADAPTER_CACHE_TTL_SECONDS` | `60` | Cache TTL (soft) |
| `ADAPTER_CACHE_HARD_TTL_SECONDS` | `300` | Cache TTL (hard/fallback) |