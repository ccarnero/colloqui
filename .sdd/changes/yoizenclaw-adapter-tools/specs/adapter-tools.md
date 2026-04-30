# Delta for adapter-tools (YoizenClaw Python Runtime)

## ADDED Requirements

### REQ-AT-001: Adapter Reference Schema

**Priority**: P0 (Critical)

The system MUST support an optional `adapterRef` field in the `AgentToolPayload` schema with `adapterId` and `endpointId` subfields.

```python
class AdapterReference(BaseModel):
    adapterId: str
    endpointId: str

class AgentToolPayload(BaseModel):
    # Existing fields...
    endpoint: str | None = None
    adapterRef: AdapterReference | None = None  # NEW
```

#### Scenario: Tool with adapter reference resolves correctly

- GIVEN an agent tool configuration with `adapterRef.adapterId="salesforce"` and `adapterRef.endpointId="get-contact"`
- WHEN the tool is loaded into the agent runtime
- THEN the tool is registered with resolved endpoint URL and auth headers
- AND `endpoint` field is populated from adapter config
- AND `headers` field is populated with authentication

#### Scenario: Tool without adapter reference works as before

- GIVEN an agent tool configuration with only `endpoint="/tools/custom"` and no `adapterRef`
- WHEN the tool is loaded into the agent runtime
- THEN the tool behaves as existing HTTP tools (no adapter resolution)

#### Scenario: Invalid adapter reference fails gracefully

- GIVEN an agent tool configuration with `adapterRef.adapterId="nonexistent"`
- WHEN the tool is loaded into the agent runtime
- THEN the tool is marked as disabled with error message "Adapter not found: nonexistent"
- AND the agent logs a warning but continues initialization

### REQ-AT-002: Python Adapter Client

**Priority**: P0 (Critical)

The system MUST provide an `AdapterClient` Python class that fetches adapter configuration from `adapter-service` via HTTP.

```python
class AdapterClient:
    def __init__(self, base_url: str, tenant_id: str): ...
    
    async def get_adapter(self, adapter_id: str) -> AdapterConfig: ...
    
    async def resolve_request(
        self, adapter_id: str, endpoint_id: str
    ) -> ResolvedRequest: ...
```

#### Scenario: Resolve request returns complete HTTP configuration

- GIVEN an adapter with ID "salesforce" and endpoint "get-contact"
- WHEN `resolve_request("salesforce", "get-contact")` is called
- THEN the returned `ResolvedRequest` contains:
  - `url`: `adapter.baseUrl + endpoint.path`
  - `method`: `endpoint.method`
  - `headers`: auth headers + custom headers
  - `timeout_ms`: `adapter.timeoutMs`
  - `max_retries`: `adapter.maxRetries`

#### Scenario: Resolve request caches adapter config

- GIVEN `get_adapter("salesforce")` has been called once
- WHEN subsequent calls to `get_adapter("salesforce")` occur within 60 seconds
- THEN the adapter config is returned from cache
- AND no HTTP request is made to adapter-service

#### Scenario: Cache expiry refreshes config

- GIVEN an adapter config has been cached for more than 60 seconds
- WHEN `get_adapter("salesforce")` is called
- THEN a fresh HTTP request is made to adapter-service
- AND the cache is updated with the new config

#### Scenario: Adapter service unavailable returns cached fallback

- GIVEN an adapter config is cached (soft TTL expired, hard TTL valid)
- WHEN adapter-service is unavailable (timeout or 5xx)
- THEN the cached config is returned with a warning log
- AND the agent continues execution

### REQ-AT-003: Adapter Tool Executor

**Priority**: P0 (Critical)

The system MUST provide an `AdapterToolExecutor` class that executes HTTP requests using resolved adapter configuration.

```python
class AdapterToolExecutor:
    def __init__(self, adapter_client: AdapterClient, backend_client: BackendClient): ...
    
    async def execute(
        self,
        tenant_id: str,
        adapter_ref: AdapterReference,
        payload: dict[str, Any]
    ) -> ToolResult: ...
```

#### Scenario: Execute adapter tool with successful response

- GIVEN an adapter tool configuration with valid `adapterRef`
- WHEN `execute(tenant_id, adapter_ref, {"query": "John Doe"})` is called
- THEN the request is sent to the resolved URL with auth headers
- AND `X-Yoizen-Tenant` header is included
- AND the response body is returned in `ToolResult.output`

#### Scenario: Execute adapter tool with authentication injection

- GIVEN an adapter with `authType: "bearer"` and `authConfig: {"token": "secret123"}`
- WHEN the tool is executed
- THEN the HTTP request includes `Authorization: Bearer secret123`
- AND the auth token is NOT logged or exposed in error messages

#### Scenario: Execute adapter tool with all auth types

- GIVEN adapters configured with auth types: `none`, `api-key`, `bearer`, `basic`, `oauth2-client`
- WHEN each adapter tool is executed
- THEN the appropriate auth headers are injected:
  - `none`: No auth headers
  - `api-key`: `X-Api-Key: {key}` (or custom header name)
  - `bearer`: `Authorization: Bearer {token}`
  - `basic`: `Authorization: Basic {base64(user:pass)}`
  - `oauth2-client`: `Authorization: Bearer {client_token}`

#### Scenario: Adapter tool timeout respects adapter config

- GIVEN an adapter with `timeoutMs: 5000`
- WHEN the tool execution exceeds 5000ms
- THEN the execution is cancelled
- AND `ToolResult.error` contains "Request timeout after 5000ms"

#### Scenario: Adapter tool error maps to tool error

- GIVEN an adapter tool execution that returns HTTP 4xx or 5xx
- WHEN the response is received
- THEN `ToolResult.error` contains:
  - HTTP status code
  - Adapter ID and endpoint ID for context
  - Response body (sanitized, no sensitive data)

### REQ-AT-004: Tool Executor Dispatch Integration

**Priority**: P0 (Critical)

The system MUST extend `ToolExecutor._execute_configured_tool` to dispatch to `AdapterToolExecutor` when `adapterRef` is present.

#### Scenario: Tool executor routes to adapter executor

- GIVEN a tool configuration with `adapterRef` field
- WHEN `_execute_configured_tool` is called
- THEN the execution is delegated to `AdapterToolExecutor.execute`
- AND the result is returned to the agent

#### Scenario: Tool executor routes to HTTP executor when no adapterRef

- GIVEN a tool configuration with `endpoint` but no `adapterRef`
- WHEN `_execute_configured_tool` is called
- THEN the existing HTTP/NATS execution path is used
- AND behavior is unchanged from current implementation

#### Scenario: Feature flag disables adapter tool execution

- GIVEN environment variable `YOIZENCLAW_ADAPTER_TOOLS_ENABLED=false`
- WHEN a tool with `adapterRef` is executed
- THEN the tool is skipped with error "Adapter tools are disabled"
- AND the agent continues with other tools

### REQ-AT-005: Response Size Limits

**Priority**: P1 (High)

The system MUST truncate or summarize adapter tool responses that exceed a configurable size limit.

#### Scenario: Large response is truncated

- GIVEN an adapter tool response with body > 100KB
- WHEN the response is processed
- THEN only the first 100KB is retained
- AND `ToolResult.output` includes a `_truncated: true` flag
- AND `ToolResult.output._original_size` contains the original size

#### Scenario: Response size limit is configurable

- GIVEN environment variable `YOIZENCLAW_TOOL_RESPONSE_MAX_BYTES=50000`
- WHEN an adapter tool response exceeds 50KB
- THEN the response is truncated to 50KB

### REQ-AT-006: Tenant Context Propagation

**Priority**: P0 (Critical)

The system MUST propagate tenant context from agent execution to adapter tool execution.

#### Scenario: Tenant header is included in adapter requests

- GIVEN an agent executing for tenant "acme-corp"
- WHEN an adapter tool is executed
- THEN the HTTP request includes `X-Yoizen-Tenant: acme-corp`
- AND the adapter service can validate tenant access

#### Scenario: Missing tenant context fails fast

- GIVEN an agent execution context without `tenant_id`
- WHEN an adapter tool is about to execute
- THEN a `TenantContextError` is raised
- AND the tool execution is skipped with error "Missing tenant context"

## Non-Functional Requirements

### NFR-AT-001: Adapter Resolution Performance

**Category**: Performance
**Priority**: P1

The adapter config resolution MUST complete within 100ms (p95) for cached adapters and 500ms (p95) for uncached adapters.

- **Metric**: Time from `resolve_request` call to return
- **Target**: < 100ms p95 cached, < 500ms p95 uncached
- **Measurement**: Distributed tracing span on `adapter.resolve`

### NFR-AT-002: Auth Credential Security

**Category**: Security
**Priority**: P0

Auth credentials from adapters MUST NOT be logged, exposed in error messages, or stored in agent state.

- **Metric**: Security audit of logs and error messages
- **Target**: Zero credential exposure in logs/errors
- **Measurement**: Automated scan for credential patterns in logs

### NFR-AT-003: Adapter Service Circuit Breaker

**Category**: Reliability
**Priority**: P1

The `AdapterClient` MUST implement a circuit breaker for adapter-service HTTP calls to prevent cascade failures.

- **Metric**: Circuit breaker open/close events
- **Target**: Circuit opens after 5 consecutive failures, closes after 30s
- **Measurement**: Metrics on circuit breaker state transitions