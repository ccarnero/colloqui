# @yoizen/sdk

TypeScript SDK for tenant developers to interact with the Yoizen platform. Zero runtime dependencies -- uses native `fetch`.

## Installation

```bash
bun add @yoizen/sdk
# or
npm install @yoizen/sdk
```

## Quick Start

```typescript

import { YoizenClient } from '@yoizen/sdk';

const client = new YoizenClient({
  baseUrl: 'https://dev.acme.yplatform.com',
  clientId: 'yoizen_abc123',
  clientSecret: 'ysk_secret',
  tenant: 'acme',
});
```

Authentication is handled automatically. The SDK acquires a token via client credentials on the first request and refreshes it proactively before expiry.

## Configuration

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `baseUrl` | `string` | yes | Platform API gateway URL |
| `clientId` | `string` | yes | API client ID (`yoizen_...`) |
| `clientSecret` | `string` | yes | API client secret (`ysk_...`) |
| `tenant` | `string` | yes | Tenant identifier |
| `maxRetries` | `number` | no | Retries on 5xx / network errors (default `0`) |
| `retryBaseDelayMs` | `number` | no | Base delay for exponential backoff (default `500`) |
| `fetch` | `typeof fetch` | no | Custom fetch implementation |

## Events

Publish domain events, retrieve processed results, or open a real-time SSE stream.

```typescript
// Publish an event
const { id } = await client.events.publish({
  type: 'order.created',
  payload: { orderId: '42', amount: 99.99 },
  callbackUrl: 'https://my-app.example.com/hooks/orders', // optional
});

// Poll for the result
const result = await client.events.getResult(id);

// Stream events in real-time
for await (const event of client.events.stream(['order.created', 'order.updated'])) {
  console.log(event.type, event.data);
}
```

## Workflows

Start Temporal-backed workflows composed of HTTP calls, inline JS functions, service bus messages, and parallel branches.

```typescript
const { workflowId } = await client.workflows.start({
  name: 'onboard-user',
  application: 'user-mgmt',
  request: { userId: 'u_123' },
  actions: [
    {
      activity: 'endpointCall',
      name: 'createProfile',
      args: {
        method: 'POST',
        url: 'https://api.example.com/profiles',
        data: { userId: '{{request.userId}}' },
      },
    },
    {
      activity: 'serviceBusCall',
      name: 'notifyTeam',
      args: {
        subject: 'events.user.onboarded',
        payload: { userId: '{{request.userId}}' },
      },
    },
  ],
});

// Check status
const status = await client.workflows.getStatus(workflowId);

// List all workflows for this tenant
const workflows = await client.workflows.list();
```

## Schedules

Create cron, interval, or one-time schedules that execute inline JS, Kubernetes jobs, or Docker containers.

```typescript
// Create a cron schedule
const schedule = await client.schedules.create({
  name: 'nightly-cleanup',
  type: 'cron',
  expression: '0 3 * * *',
  exec_mode: 'js-inline',
  config: { script: 'console.log("cleaning up...")' },
});

// List schedules
const schedules = await client.schedules.list({ enabled: true, limit: 20 });

// Update
await client.schedules.update(schedule.id, { enabled: false });

// Trigger manually
await client.schedules.trigger(schedule.id);

// View execution history
const logs = await client.schedules.listExecutions({ scheduleId: schedule.id, limit: 10 });
const execution = await client.schedules.getExecution(logs[0].id);

// Delete
await client.schedules.delete(schedule.id);
```

## Service Registry

Register your own services as auto-scaling Knative workloads, manage HTTP routes, and run canary deployments.

```typescript
// Register a service
const svc = await client.registry.register({
  name: 'my-api',
  image: 'ghcr.io/acme/my-api:v1.2.0',
  port: 8080,
  minScale: 1,
  maxScale: 10,
  concurrencyTarget: 50,
  envVars: { DATABASE_URL: 'postgres://...' },
});

// Expose it via a route
await client.registry.createRoute(svc.id, {
  pathPrefix: '/api/v1',
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  isPublic: false,
  stripPrefix: true,
});

// Canary deployment
await client.registry.startCanary(svc.id, {
  image: 'ghcr.io/acme/my-api:v1.3.0',
  percent: 10,
});
await client.registry.updateCanary(svc.id, { percent: 50 });
await client.registry.promoteCanary(svc.id);
// or: await client.registry.rollbackCanary(svc.id);

// Inspect revisions
const revisions = await client.registry.listRevisions(svc.id);

// Manage routes
const routes = await client.registry.listRoutes(svc.id);
await client.registry.removeRoute(svc.id, routes[0].id);

// Cleanup
await client.registry.remove(svc.id);
```

## Cache

Tenant-scoped key-value cache backed by Redis.

```typescript
await client.cache.set('session:abc', { userId: 'u_1' }, { ttl: 3600 });

const value = await client.cache.get('session:abc');

const keys = await client.cache.scan('session:*', 100);

const batch = await client.cache.batchGet(['session:abc', 'session:def']);

await client.cache.delete('session:abc');
```

## Audit

Query the immutable audit log of all events processed for your tenant.

```typescript
const { events } = await client.audit.query({
  type: 'order.created',
  from: '2026-01-01T00:00:00Z',
  to: '2026-03-01T00:00:00Z',
  limit: 50,
  offset: 0,
});

const event = await client.audit.get(events[0].id);
```

## Error Handling

All non-2xx responses throw a `YoizenApiError` with structured details.

```typescript
import { YoizenApiError } from '@yoizen/sdk';

try {
  await client.events.publish({ type: 'bad', payload: {} });
} catch (err) {
  if (err instanceof YoizenApiError) {
    console.error(err.status);    // HTTP status code
    console.error(err.body);      // Parsed response body
    console.error(err.endpoint);  // e.g. "POST /events"
  }
}
```

## Retry

Enable automatic retries on 5xx and network errors with exponential backoff:

```typescript
const client = new YoizenClient({
  baseUrl: 'https://dev.acme.yplatform.com',
  clientId: 'yoizen_abc123',
  clientSecret: 'ysk_secret',
  tenant: 'acme',
  maxRetries: 3,
  retryBaseDelayMs: 500, // 500ms, 1s, 2s
});
```

## Runtime Compatibility

Works in any environment with a global `fetch`:

- Node.js 18+
- Bun
- Deno
- Modern browsers

Pass a custom `fetch` for edge runtimes or testing:

```typescript
const client = new YoizenClient({
  // ...
  fetch: myCustomFetch,
});
```
