# Adapter Tools

Adapter tools allow agents to invoke external APIs through centrally managed adapter configurations, instead of hardcoding HTTP endpoint details in each agent.

## Overview

Traditional agent tools require explicit `endpoint` URLs and authentication credentials per tool. **Adapter tools** replace this with a reference (`adapterRef`) to a connector managed by the platform's `connector-admin` service. This provides:

- **Centralized configuration**: Auth credentials, base URLs, and retry policies managed in one place.
- **Reusability**: Multiple agents can reference the same connector/endpoint.
- **Security**: Credentials are never stored in agent configs — resolved at execution time.

## Architecture

### Data Flow

```
┌──────────────────────────────────────────────────────────────────┐
│ Configuration Phase                                              │
│                                                                  │
│  Admin Console ──POST /admin/agents──▶ agent-admin-service       │
│     {tools: [{adapterRef: {adapterId, endpointId}}]}             │
│                                          │                       │
│                                   Validate adapterRef            │
│                                          │                       │
│                                   Store in PostgreSQL             │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│ Execution Phase                                                  │
│                                                                  │
│  agent-ai-service                                                │
│     │                                                            │
│     ▼                                                            │
│  ToolExecutorService.execute()                                   │
│     │                                                            │
│     ├── adapterRef present? ──YES──▶ AdapterExecutorService      │
│     │                                      │                     │
│     │                               GET /connectors/{id}         │
│     │                               (connector-admin)            │
│     │                                      │                     │
│     │                               Resolve URL + headers         │
│     │                               + inject auth                │
│     │                                      │                     │
│     │                               HTTP request to external API │
│     │                                      │                     │
│     │                               Return ToolResult            │
│     │                                                            │
│     └── endpoint present? ──YES──▶ HTTP (existing path)         │
└──────────────────────────────────────────────────────────────────┘
```

### Components

| Component | File | Responsibility |
|-----------|------|---------------|
| `AdapterExecutorService` | `services/agent-ai-service/src/modules/tools/adapter-executor.service.ts` | Resolve adapter config from connector-admin, inject auth headers, execute HTTP call |
| `ToolExecutorService` | `services/agent-ai-service/src/modules/tools/tool-executor.service.ts` | Dispatch to adapter or HTTP path based on tool definition |
| `AdaptersService` (agent-admin) | `services/agent-admin-service/src/modules/adapters/adapters.service.ts` | Validate adapterRef existence on agent create/update |
| `AdaptersController` | `services/agent-admin-service/src/modules/adapters/adapters.controller.ts` | `GET /admin/adapters` for UI |
| `AdaptersService` (admin-console) | `services/admin-console/src/app/core/services/adapters.service.ts` | Angular service for adapter API |
| `ToolAdapterFormComponent` | `services/admin-console/src/app/features/automation/ai/tool-adapter-form.component.ts` | UI for adapter selection |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONNECTOR_ADMIN_URL` | `http://connector-admin-api:3000` | Base URL for connector-admin API (consumed by `agent-ai-service`) |

Note: The legacy `ADAPTER_SERVICE_URL`, `ADAPTER_TOOLS_ENABLED`, `ADAPTER_CACHE_TTL_SECONDS`, `ADAPTER_CACHE_HARD_TTL_SECONDS`, and `TOOL_RESPONSE_MAX_BYTES` variables referenced in older docs are **not present** in the current TypeScript implementation. The TypeScript `AdapterExecutorService` calls connector-admin directly on each tool invocation; there is no SWR cache layer at the agent-ai-service level.

### Agent Tool Schema

Each agent tool must have **either** `endpoint` **or** `adapterRef`, never both:

```typescript
// HTTP tool (existing)
{
  "name": "get-weather",
  "endpoint": "https://api.weather.com/v1/forecast",
  "method": "GET"
}

// Adapter tool
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

When a connector ID does not exist in `connector-admin`:

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

### Connector Admin Unavailable

When connector-admin returns a non-2xx response or is unreachable, `AdapterExecutorService` returns a `ToolResult` with `success: false` and the HTTP error message. There is no SWR fallback at the agent-ai-service level — the error propagates to the LLM as tool failure.

### Timeout Handling

Each adapter endpoint has a configurable timeout (default: 5000 ms, from the endpoint or adapter config in connector-admin). If the external API does not respond within the timeout, `AbortSignal.timeout` causes an abort and the error is returned as a `ToolResult` failure.

## Security

### Auth Credential Handling

`AdapterExecutorService` supports five authentication types via `injectAuthHeaders`:

| Auth Type | Header Injected | Configuration |
|-----------|----------------|---------------|
| `none` | None | No credentials needed |
| `api-key` | `X-Api-Key: {key}` (or `authConfig.headerName`) | `authConfig.key`, `authConfig.headerName` |
| `bearer` | `Authorization: Bearer {token}` | `authConfig.token` or `authConfig.bearerToken` |
| `basic` | `Authorization: Basic {base64}` | `authConfig.username`, `authConfig.password` |
| `oauth2-client` | `Authorization: Bearer {access_token}` | `authConfig.access_token` |

Key security principles:

- **Resolved at execution time**: Credentials are fetched from `connector-admin` for each tool execution, never stored in agent configuration.
- **Tenant isolation**: Every connector request includes the `X-Yoizen-Tenant` header. `connector-admin` enforces tenant-scoped access.

### Tenant Context Propagation

```
Agent (tenant: acme) → AdapterExecutorService
  → GET /connectors/{id} (X-Yoizen-Tenant: acme)
  → resolve URL + auth headers
  → HTTP request to external API
    (X-Yoizen-Tenant: acme + adapter auth headers)
```

## File Reference

| File | Language | Description |
|------|----------|-------------|
| `services/agent-ai-service/src/modules/tools/adapter-executor.service.ts` | TypeScript | AdapterExecutorService — resolves connector-admin config, injects auth, executes HTTP call |
| `services/agent-ai-service/src/modules/tools/tool-executor.service.ts` | TypeScript | ToolExecutorService — dispatches to adapter or direct HTTP path |
| `services/agent-ai-service/src/modules/tools/tool-definition.ts` | TypeScript | `AdapterReference` type and `ToolResult` interface |
| `services/agent-admin-service/src/modules/agents/agents.service.ts` | TypeScript | `validateAdapterRefs` on agent create/update |
| `services/agent-admin-service/src/modules/adapters/` | TypeScript | Adapter lookup controller and service |
| `services/admin-console/src/app/core/services/adapters.service.ts` | TypeScript | Angular adapter API service |
| `services/admin-console/src/app/features/automation/ai/tool-adapter-form.component.ts` | TypeScript | Adapter selection UI component |
