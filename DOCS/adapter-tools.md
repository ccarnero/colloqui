# Adapter Tools

Adapter tools allow YoizenClaw agents to invoke external APIs through centrally managed adapter configurations, instead of hardcoding HTTP endpoint details in each agent.

## Overview

Traditional agent tools require explicit `endpoint` URLs and authentication credentials per tool. **Adapter tools** replace this with a reference (`adapterRef`) to an adapter managed by the platform's adapter-service. This provides:

- **Centralized configuration**: Auth credentials, base URLs, and retry policies managed in one place.
- **Reusability**: Multiple agents can reference the same adapter/endpoint.
- **Security**: Credentials are never stored in agent configs — resolved at execution time.
- **Resilience**: Stale-while-revalidate (SWR) caching with automatic fallback when adapter-service is unavailable.

## Architecture

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ Configuration Phase                                              │
│                                                                  │
│  Admin Console ──POST /admin/agents──▶ yoizenclaw-admin-service │
│     {tools: [{adapterRef: {adapterId, endpointId}}]}             │
│                                          │                       │
│                                   Validate adapterRef            │
│                                          │                       │
│                                   Store in PostgreSQL             │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ Execution Phase                                                  │
│                                                                  │
│  YoizenClaw Runtime                                              │
│     │                                                            │
│     ▼                                                            │
│  ToolExecutor._execute_configured_tool()                         │
│     │                                                            │
│     ├── adapterRef present? ──YES──▶ AdapterToolExecutor         │
│     │                                      │                     │
│     │                               AdapterClient                │
│     │                              (SWR cache check)             │
│     │                                      │                     │
│     │                              GET /adapters/{id}            │
│     │                              (adapter-service)             │
│     │                                      │                     │
│     │                              Resolve URL + headers          │
│     │                              + inject auth                 │
│     │                                      │                     │
│     │                              HTTP request to external API  │
│     │                                      │                     │
│     │                              Truncate if >100KB            │
│     │                                      │                     │
│     │                              Return ToolResult             │
│     │                                                            │
│     └── endpoint present? ──YES──▶ HTTP/NATS (existing path)    │
└──────────────────────────────────────────────────────────────────┘
```

### Components

| Component | File | Responsibility |
|-----------|------|---------------|
| `AdapterClient` | `applications/yoizenclaw-application/src/shared/adapter_client.py` | Resolve adapter configs with SWR caching |
| `AdapterToolExecutor` | `applications/yoizenclaw-application/src/tools/adapter_executor.py` | Execute HTTP calls via adapter resolution |
| `ToolExecutor` | `applications/yoizenclaw-application/src/application/agents/tool_executor.py` | Dispatch to adapter or HTTP path |
| `AdapterReference` | `applications/yoizenclaw-application/src/shared/config/agent_config.py` | Pydantic model for adapter references |
| `AdapterReferenceDto` | `services/yoizenclaw-admin-service/src/modules/agents/agents.dto.ts` | DTO validation in admin-service |
| `AdaptersController` | `services/yoizenclaw-admin-service/src/modules/adapters/adapters.controller.ts` | `GET /admin/adapters` for UI |
| `AdaptersService` | `services/admin-console/src/app/core/services/adapters.service.ts` | Angular service for adapter API |
| `ToolAdapterFormComponent` | `services/admin-console/src/app/features/automation/yoizenclaw/tool-adapter-form.component.ts` | UI for adapter selection |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `YOIZENCLAW_ADAPTER_TOOLS_ENABLED` | `true` | Feature flag for adapter tools |
| `ADAPTER_SERVICE_URL` | `http://adapter-service:3000` | adapter-service base URL |
| `YOIZENCLAW_TOOL_RESPONSE_MAX_BYTES` | `100000` | Response truncation limit (bytes) |
| `ADAPTER_CACHE_TTL_SECONDS` | `60` | Cache soft TTL (fresh threshold) |
| `ADAPTER_CACHE_HARD_TTL_SECONDS` | `300` | Cache hard TTL (stale fallback) |

### Agent Tool Schema

Each agent tool must have **either** `endpoint` **or** `adapterRef`, never both:

```typescript
// HTTP tool (existing)
{
  "name": "get-weather",
  "endpoint": "https://api.weather.com/v1/forecast",
  "method": "GET"
}

// Adapter tool (new)
{
  "name": "search-crm",
  "adapterRef": {
    "adapterId": "adapter-crm-001",
    "endpointId": "ep-search"
  }
}
```

### Admin UI Setup

1. Navigate to **YoizenClaw Agents** in the admin console.
2. Open the **Tools** tab on an agent.
3. Click **Add Tool**.
4. Toggle **Tool Source** to **Adapter**.
5. Select an adapter from the dropdown.
6. Select an endpoint from the dropdown.
7. The resolved URL, method, and auth type are shown in the preview section.
8. Save the agent.

## Usage Examples

### Create Agent with Adapter Tool via API

```bash
# Create an agent with an adapter-backed tool
curl -X POST http://localhost:3000/admin/agents \
  -H "Content-Type: application/json" \
  -H "x-yoizen-tenant: my-tenant" \
  -d '{
    "name": "CRM Assistant",
    "description": "Searches CRM contacts using managed adapter",
    "system_prompt": "You help users search and manage CRM contacts.",
    "model_config": {
      "model": "gpt-4",
      "provider": "openai"
    },
    "tools": [
      {
        "name": "search-contacts",
        "description": "Search contacts in the CRM",
        "adapterRef": {
          "adapterId": "adapter-crm-001",
          "endpointId": "ep-search"
        }
      },
      {
        "name": "get-contact",
        "description": "Get a specific contact by ID",
        "adapterRef": {
          "adapterId": "adapter-crm-001",
          "endpointId": "ep-get"
        }
      }
    ]
  }'
```

### List Available Adapters

```bash
# Get adapters available for the tenant
curl http://localhost:3000/admin/adapters \
  -H "x-yoizen-tenant: my-tenant"
```

Response:

```json
{
  "adapters": [
    {
      "id": "adapter-crm-001",
      "name": "CRM API Adapter",
      "status": "active",
      "baseUrl": "https://crm.example.com/api/v2",
      "authType": "bearer",
      "hasAuth": true,
      "endpoints": [
        {
          "id": "ep-search",
          "path": "/contacts/search",
          "method": "POST",
          "label": "Search Contacts"
        },
        {
          "id": "ep-get",
          "path": "/contacts/{id}",
          "method": "GET",
          "label": "Get Contact"
        }
      ]
    }
  ]
}
```

### Publish Agent

```bash
# Publish the agent to make it available for runtime
curl -X POST http://localhost:3000/admin/agents/{agentId}/publish \
  -H "x-yoizen-tenant: my-tenant"
```

## Error Handling

### Adapter Not Found

When an adapter ID does not exist in the adapter-service:

```json
{
  "success": false,
  "error": "Adapter not found: adapter-nonexistent"
}
```

The runtime logs a warning and returns the error to the LLM. The agent can decide how to handle the failure (retry, inform user, etc.).

### Endpoint Not Found

When an endpoint ID does not exist within the adapter:

```json
{
  "success": false,
  "error": "Endpoint 'ep-nonexistent' not found in adapter 'adapter-crm-001'"
}
```

### Adapter Service Unavailable

The `AdapterClient` uses a stale-while-revalidate (SWR) cache:

1. **Fresh cache (within 60s)**: Returns cached config immediately.
2. **Stale cache (60s-300s)**: Returns cached config, triggers background refresh.
3. **Expired cache (>300s)**: Must fetch fresh. If adapter-service is down, returns an error.
4. **No cache**: Must fetch. If adapter-service is down, returns an error immediately.

### Response Truncation

Adapter responses exceeding 100KB are truncated to prevent LLM context overflow:

```json
{
  "_truncated": true,
  "original_size_bytes": 150000,
  "top_level_keys": ["results", "pagination"],
  "message": "Response truncated: 150000 bytes exceeded limit of 100000 bytes"
}
```

### Timeout Handling

Each adapter has a configurable timeout (default: 5000ms). If the external API does not respond within the timeout:

```json
{
  "success": false,
  "error": "Request to https://crm.example.com/api/v2/contacts/search timed out after 5000ms"
}
```

## Security

### Auth Credential Handling

Adapter tools support five authentication types:

| Auth Type | Header Injected | Configuration |
|-----------|----------------|---------------|
| `none` | None | No credentials needed |
| `api-key` | `X-Api-Key: {key}` (or custom header) | `authConfig.key`, `authConfig.header_name` |
| `bearer` | `Authorization: Bearer {token}` | `authConfig.token` |
| `basic` | `Authorization: Basic {base64}` | `authConfig.username`, `authConfig.password` |
| `oauth2-client` | `Authorization: Bearer {access_token}` | `authConfig.access_token` |

Key security principles:

- **Never logged**: Auth tokens are never included in log messages or error responses.
- **Resolved at execution time**: Credentials are fetched from adapter-service for each tool execution, never stored in agent configuration.
- **Tenant isolation**: Every adapter request includes the `X-Yoizen-Tenant` header. Adapter-service enforces tenant-scoped access.
- **Sanitized errors**: Error messages returned to the LLM do not contain auth headers or credential values.

### Tenant Context Propagation

```
Agent (tenant: acme) → AdapterToolExecutor
  → AdapterClient.get_adapter(adapter_id)
    → GET /adapters/{id} (X-Yoizen-Tenant: acme)
  → resolve_request() (includes auth headers)
  → HTTP request to external API
    (X-Yoizen-Tenant: acme + adapter auth headers)
```

## Feature Flag

Adapter tools are controlled by the `YOIZENCLAW_ADAPTER_TOOLS_ENABLED` environment variable.

| Value | Behaviour |
|-------|-----------|
| `true` (default) | Adapter tools are enabled. `adapterRef` tools are resolved and executed. |
| `false` | Adapter tools are disabled. Tool calls with `adapterRef` return an error. |

> **Note**: The feature flag is temporary and should be removed after production validation. See Task 6.2 in the yoizenclaw-adapter-tools change.

## File Reference

| File | Language | Description |
|------|----------|-------------|
| `applications/yoizenclaw-application/src/shared/adapter_client.py` | Python | AdapterClient with SWR cache |
| `applications/yoizenclaw-application/src/tools/adapter_executor.py` | Python | AdapterToolExecutor |
| `applications/yoizenclaw-application/src/shared/config/agent_config.py` | Python | `AdapterReference` model |
| `services/yoizenclaw-admin-service/src/modules/agents/agents.dto.ts` | TypeScript | `AdapterReferenceDto` validation |
| `services/yoizenclaw-admin-service/src/modules/adapters/` | TypeScript | Adapter lookup controller + service |
| `services/admin-console/src/app/core/services/adapters.service.ts` | TypeScript | Angular adapter API service |
| `services/admin-console/src/app/features/automation/yoizenclaw/tool-adapter-form.component.ts` | TypeScript | Adapter selection UI component |
