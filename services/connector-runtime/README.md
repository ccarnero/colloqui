# Connector Runtime

A standalone Temporal worker service that executes generic HTTP requests with optional adapter-driven configuration. This service is the execution engine for all HTTP-based activities in the platform — whether called from workflows, event processors, webhooks, or direct external callers. It operates independently from workflow orchestration and scales based on Temporal task queue depth.

## What is connector-runtime?

connector-runtime listens on the `connector-runtime` Temporal task queue for activity tasks. Each activity represents a single HTTP request that may be configured in one of two ways:

1. **Raw HTTP**: Caller provides complete URL, method, headers, and body
2. **Adapter-driven**: Caller provides `adapterId` and `endpointId`; the service resolves full configuration (base URL, auth, custom headers, timeout, retries) from adapter-service and applies it

All HTTP calls are instrumented with OpenTelemetry for observability. The service maintains a Redis stale-while-revalidate cache for adapter configurations to minimize dependency on adapter-service.

## Quick Start

```bash
# Install dependencies
pnpm install

# Run locally with Temporal on localhost:7233
bun run start:dev
```

**Prerequisites**: Temporal server running (`localhost:7233`), Redis (`localhost:6379`), adapter-service reachable.

## Local Development

### Running the service

```bash
bun run start:dev
```

This starts both the Temporal worker and the health server on port 3000.

### Health check

```bash
curl http://localhost:3000
```

Returns `200 OK` when ready, `503 Service Unavailable` during startup.

### Running tests

```bash
bun test
bun test test/unit
```

## Architecture

### Core Components

**Temporal Worker** (`src/worker.ts`)
- Connects to Temporal server at `TEMPORAL_ADDRESS:7233`
- Registers activities on the `connector-runtime` task queue
- Maintains health server on `PORT` (default 3000)
- Gracefully shuts down on SIGTERM/SIGINT
- Max 200 concurrent activity tasks

**Activity: `executeEndpointCall`** (`src/activities/endpoint-call.activity.ts`)
- Entry point for HTTP requests
- Routes to adapter-driven path (if `adapterId`/`endpointId` provided) or raw path
- Uses `tracedFetch` from `@yoizen/observability` for instrumentation
- Implements exponential backoff retry with circuit breaker
- Returns `{ status, body, headers }` to caller

**Activity: `executeServiceCall`** (`src/activities/service-call.activity.ts`)
- Resolves internal service calls via adapter mirror (if configured)
- Falls back to registry-service DNS lookup
- Delegates to `executeEndpointCall` for HTTP execution

**Adapter Resolution** (`src/activities/_shared/adapter-client.provider.ts`)
- `AdapterClient` class wraps adapter-service REST API calls
- Redis stale-while-revalidate cache (TTL 300s, stale window 60s)
- Lazy cache misses: fetch from adapter-service while serving stale data if cache is fresh
- OAuth2 client credentials token management for secured adapters

### Data Flow

```
Temporal Server receives activity task for connector-runtime queue
         ↓
Worker picks up executeEndpointCall activity
         ↓
         ├─ [Adapter-driven path]
         │   AdapterClient.resolveRequest(tenantId, adapterId, endpointId)
         │   ├─ Check Redis cache (hit → return config)
         │   └─ [Cache miss]
         │       ├─ Fetch from adapter-service REST API
         │       ├─ Cache in Redis
         │       └─ Return resolved config (URL, auth headers, timeout, retries)
         │
         └─ [Raw HTTP path]
             Caller provides complete URL + headers
         ↓
tracedFetch with OpenTelemetry instrumentation
         ├─ [Circuit breaker open?] → immediate failure
         ├─ [First attempt] → execute request
         └─ [Failure?] → exponential backoff retry (up to 3 attempts)
         ↓
Return { status, body, headers } to Temporal
```

### Request/Response Shapes

**Endpoint Call Request**

```
{
  method: string              // GET, POST, PUT, DELETE, PATCH
  url: string                 // Target URL (used if no adapter)
  adapterId?: string          // Adapter ID for config resolution
  endpointId?: string         // Endpoint ID within adapter (requires adapterId)
  params?: Record<string, *>  // URL query parameters
  data?: any                  // Request body (JSON or form data)
  headers?: Record<string, string>  // Additional headers (merged with adapter)
  timeout?: number            // Optional timeout override (ms)
  retries?: number            // Optional retry count override
}
```

**Endpoint Call Response**

```
{
  status: number              // HTTP status code (200, 404, 500, etc.)
  body: string | object       // Response body (parsed JSON if Content-Type: application/json)
  headers: Record<string, string>  // Response headers
  duration: number            // Execution time (ms)
  retriesUsed: number         // Count of retries consumed
}
```

**Service Call Request**

```
{
  service: string             // Internal service name
  path: string                // Service path
  method: string              // HTTP method
  data?: any                  // Request body
  headers?: Record<string, string>  // Additional headers
  adapterId?: string          // Optional adapter for service config
  timeout?: number            // Optional timeout override
}
```

## Activities

### executeEndpointCall

Executes an HTTP request with optional adapter-driven configuration.

**Example 1: Raw HTTP call**

```
// Caller (workflow-service)
activity = executeEndpointCall({
  method: "GET",
  url: "https://api.example.com/users/123",
  headers: { "Accept": "application/json" },
  timeout: 30000
})

// Result
{
  status: 200,
  body: { id: 123, name: "Alice" },
  headers: { "content-type": "application/json" },
  duration: 150,
  retriesUsed: 0
}
```

**Example 2: Adapter-driven call**

```
// Caller provides minimal info; adapter resolves the rest
activity = executeEndpointCall({
  method: "GET",
  url: "/users/123",          // Relative path
  adapterId: "crm-adapter",
  endpointId: "get-customer",
  timeout: 30000
})

// AdapterClient resolves from adapter-service:
// - Base URL: https://crm.example.com/api
// - Auth: Bearer token (OAuth2 client credentials)
// - Custom headers: { "X-API-Key": "..." }
// - Timeout: 45000 (adapter configured)
// - Retries: 3 (adapter configured)

// Full request becomes:
// GET https://crm.example.com/api/users/123
// Headers: {
//   "Authorization": "Bearer <token>",
//   "X-API-Key": "...",
//   "x-yoizen-tenant": "acme"
// }

// Result
{
  status: 200,
  body: { customerId: 123, name: "Alice", email: "alice@example.com" },
  headers: { "content-type": "application/json" },
  duration: 250,
  retriesUsed: 1
}
```

### executeServiceCall

Resolves and calls internal services (e.g., `event-processor`, `audit-service`). Similar signature to `executeEndpointCall` but targets internal service via DNS discovery.

**Example**

```
// Caller
activity = executeServiceCall({
  service: "audit-service",
  path: "/events/log",
  method: "POST",
  data: { action: "user.login", userId: "123" }
})

// Service resolution:
// 1. Check if audit-adapter configured in adapter-service
// 2. If yes, use adapter config (URL, auth, headers)
// 3. If no, resolve via Kubernetes DNS: audit-service.default.svc.cluster.local

// Request sent to: http://audit-service.default.svc.cluster.local/events/log
// With tenant header injection: x-yoizen-tenant: acme

// Result
{
  status: 200,
  body: { eventId: "evt_abc123" },
  headers: { "content-type": "application/json" },
  duration: 50,
  retriesUsed: 0
}
```

## Error Handling

### Circuit Breaker

If a remote endpoint fails repeatedly, the service activates a circuit breaker to fail fast without attempting additional calls. Thresholds are adapter-configurable.

```
Attempt 1: Failure (timeout)
Attempt 2: Failure (5xx error)
Attempt 3: Failure (connection refused)
Circuit breaker opens → immediate 503 error on next call
After cooldown period → half-open state (1 test request)
If test succeeds → circuit closes, normal operation resumes
```

### Retries & Backoff

- **Strategy**: Exponential backoff (1s, 2s, 4s)
- **Max retries**: 3 (configurable per adapter)
- **Retryable errors**: Network timeouts, 5xx status codes, connection refused
- **Non-retryable errors**: 4xx status codes (immediate failure)

### Timeout Strategy

1. Use adapter-configured timeout if adapter-driven request
2. Use caller-provided timeout override if present
3. Fall back to 30s default
4. Maximum: 300s (circuit breaker prevents infinite hangs)

## Performance

### Concurrency

- **Max concurrent activities**: 200 per replica
- **Task dequeue**: Pull-based from Temporal (prevents overload)
- **Activity timeout**: 30s default, configurable per adapter

### Scaling

The service is deployed as a plain Kubernetes Deployment (not Knative Service) because Temporal uses pull-based task distribution. KEDA monitors the `connector-runtime` task queue depth and scales accordingly:

```
Task queue depth 0-10: 1 replica
Task queue depth 10-100: 2-5 replicas
Task queue depth 100+: 5-20 replicas (max)
Scale-down cooldown: 300s
```

This ensures sufficient concurrency for high-throughput execution without over-provisioning idle replicas.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Health server port |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Temporal server address:port |
| `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `ADAPTER_SERVICE_URL` | `http://adapter-service.platform-services-dev.svc.cluster.local` | Adapter service URL |
| `REDIS_HOST` | `localhost` | Redis host for adapter config cache |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_DB` | `0` | Redis database number |
| `REDIS_PASSWORD` | *(unset)* | Redis password (if required) |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |

### Adapter Configuration

Adapters are managed by adapter-service. connector-runtime queries adapter-service for runtime configuration:

```
GET /adapters/{adapterId}
→ {
    id: string,
    baseUrl: string,
    auth: {
      type: "bearer" | "apiKey" | "oauth2" | "basic",
      credentials: Record<string, string>
    },
    headers: Record<string, string>,
    timeout: number,
    retries: number,
    endpoints: [
      { id, label, method, path },
      ...
    ]
  }
```

The service caches this for 300s and serves stale data while refreshing in the background.

## Debugging Tips

### Check Health Status

```bash
curl -v http://localhost:3000
```

**200 OK**: Worker is ready and connected to Temporal.  
**503 Service Unavailable**: Worker is starting or Temporal connection failed.

### Enable Debug Logging

```bash
LOG_LEVEL=debug bun run start:dev
```

Watch for:
- `[adapter-client] cache hit/miss` — adapter config resolution
- `[http-call] retrying after` — retry attempts
- `[circuit-breaker] state changed` — circuit breaker state transitions

### Monitor Task Queue Depth

Use Temporal Web UI (usually at `http://localhost:8080`):
1. Navigate to "Task Queues"
2. Find `connector-runtime`
3. Observe pending task count

High pending count → consider scaling replicas up manually or adjusting KEDA thresholds.

### Common Issues

**Issue**: Activity hangs or times out  
**Solution**: Check adapter-service connectivity and Redis. Enable debug logging to see where time is spent.

**Issue**: Adapter config not resolving  
**Solution**: Verify adapter-service is running and returning configs. Check Redis cache by:
```bash
redis-cli KEYS "*adapter*"
```

**Issue**: Circuit breaker keeps opening  
**Solution**: Check if the target endpoint is responding. Examine response times — if consistently > timeout, increase timeout in adapter config.

## Dependencies

| Service | Protocol | Purpose |
|---------|----------|---------|
| **Temporal Server** | gRPC | Receive activity tasks, report results |
| **adapter-service** | HTTP | Fetch adapter configs |
| **Redis** | TCP | Cache adapter configs and OAuth2 tokens |
| **Target endpoints** | HTTP(S) | Execute user-requested HTTP calls |

## Integration Points

### Called By

- **workflow-service**: `endpointCall` actions dispatch to connector-runtime task queue

### Calls To

- **connector-admin**: REST API for connector config resolution
- **Redis**: Stale-while-revalidate cache
- **Target endpoints**: User-configured HTTP endpoints
- **OpenTelemetry collector** (if configured): Traces and metrics

## Further Reading

- [AGENTS.md](AGENTS.md) — Detailed architecture, worker configuration, code structure
- [Temporal Activity Documentation](https://temporal.io/docs/concepts/what-is-a-workflow-definition#activities)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
