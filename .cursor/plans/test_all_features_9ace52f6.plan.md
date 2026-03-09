---
name: Test all features
overview: Add comprehensive testing (unit, integration, E2E) to all three NestJS/Bun services using bun:test, with mocks for unit tests, Docker containers for integration, and a full cross-service E2E event flow test.
todos:
  - id: test-infra
    content: Create tests/docker-compose.test.yaml (NATS + Redis), add @nestjs/testing + test scripts to all 3 package.json files
    status: completed
  - id: unit-api-gateway
    content: "Unit tests for api-gateway: events.service (publish, getResult, L1 cache, eviction), events.controller (202, 404), health.controller"
    status: completed
  - id: unit-event-processor
    content: "Unit tests for event-processor: processor.service (processEvent, type counting via Map, getStats), health.controller"
    status: completed
  - id: unit-cache-service
    content: "Unit tests for cache-service: cache.service (get/set/del/scan/batchGet, L1 hit/miss/expiry/eviction), cache.controller (all 5 endpoints), health.controller"
    status: completed
  - id: integration-tests
    content: "Integration tests for all 3 services: real NATS/Redis via Docker, test actual message flow and data persistence"
    status: completed
  - id: e2e-test
    content: "E2E test: boot all 3 services in-process, test full event publish -> consume -> cache -> retrieve pipeline"
    status: completed
isProject: false
---

# Test All Features

## Current state

- 3 services: `api-gateway`, `event-processor`, `cache-service`
- 0 tests, no test runner configured, no test scripts in package.json
- Runtime: Bun, Framework: NestJS 11 + Fastify

## Test runner: `bun:test`

Bun's built-in test runner with Jest-compatible API (`describe`, `it`, `expect`, `mock`, `beforeAll`, etc.). Combined with `@nestjs/testing` for NestJS module bootstrapping.

## Directory structure

```
services/
├── api-gateway/
│   └── test/
│       ├── unit/
│       │   ├── events.service.spec.ts
│       │   ├── events.controller.spec.ts
│       │   └── health.controller.spec.ts
│       └── integration/
│           └── events.integration.spec.ts
├── event-processor/
│   └── test/
│       ├── unit/
│       │   ├── processor.service.spec.ts
│       │   └── health.controller.spec.ts
│       └── integration/
│           └── processor.integration.spec.ts
├── cache-service/
│   └── test/
│       ├── unit/
│       │   ├── cache.service.spec.ts
│       │   ├── cache.controller.spec.ts
│       │   └── health.controller.spec.ts
│       └── integration/
│           └── cache.integration.spec.ts
tests/
├── e2e/
│   ├── event-flow.e2e.spec.ts     # Full cross-service flow
│   ├── package.json
│   └── tsconfig.json
└── docker-compose.test.yaml        # NATS + Redis for integration/E2E
```

## Test infrastructure

### `tests/docker-compose.test.yaml`

Lightweight NATS + Redis containers for integration and E2E tests:

```yaml
services:
  nats:
    image: nats:2.10-alpine
    command: ["--jetstream"]
    ports: ["4222:4222"]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

### Package.json changes (per service)

Add to each service's `package.json`:

```json
{
  "scripts": {
    "test": "bun test",
    "test:unit": "bun test test/unit",
    "test:integration": "bun test test/integration"
  },
  "devDependencies": {
    "@nestjs/testing": "^11.0.0"
  }
}
```

## Unit tests (mock all externals)

All unit tests use `@nestjs/testing` `Test.createTestingModule()` with mock providers for NATS/Redis tokens (`NATS_CONNECTION`, `JETSTREAM`, `JETSTREAM_MANAGER`, `REDIS_CLIENT`).

### api-gateway

`**events.service.spec.ts**` -- Tests for [events.service.ts](services/api-gateway/src/modules/events/events.service.ts):

- `publish()`: mock JetStream `.publish()` and Redis `.setex()`, verify correct subject `events.<type>`, verify UUID generation, verify pending key written
- `getResult()` with L1 cache hit: populate Map, assert no Redis call
- `getResult()` with L1 miss / Redis hit: mock Redis `.get()` returning JSON, assert parsed result returned and L1 populated
- `getResult()` with both miss: Redis returns null, assert `null` returned
- L1 eviction: fill Map to 1024, assert oldest entry evicted on next insert

`**events.controller.spec.ts**` -- Tests for [events.controller.ts](services/api-gateway/src/modules/events/events.controller.ts):

- `POST /events`: verify 202 status, response shape `{id, status: "accepted"}`
- `GET /results/:id` found: verify 200, returned object
- `GET /results/:id` not found: verify 404 NotFoundException

`**health.controller.spec.ts**` -- Tests for [health.controller.ts](services/api-gateway/src/modules/health/health.controller.ts):

- NATS connected + Redis pong: `{status: "ok", nats: "connected", redis: "connected"}`
- NATS closed: `{status: "degraded", nats: "disconnected", ...}`
- Redis ping throws: `{status: "degraded", ..., redis: "disconnected"}`

### event-processor

`**processor.service.spec.ts**` -- Tests for [processor.service.ts](services/event-processor/src/modules/processor/processor.service.ts):

- `processEvent("id1", "created", ...)`: verify Redis `.setex()` called with `result:id1`, parsed JSON contains `{processed: true}`
- `processEvent("id2", "unknown", null)`: verify `processed: false`
- `getStats()`: process multiple events of different types, verify Map has correct counts
- Type counting: O(1) check -- process 3 "created" + 2 "updated", assert `stats.get("created") === 3`

`**health.controller.spec.ts**` -- Similar pattern to api-gateway's health test.

### cache-service

`**cache.service.spec.ts**` -- Tests for [cache.service.ts](services/cache-service/src/modules/cache/cache.service.ts):

- `get()` L1 hit (not expired): verify no Redis call
- `get()` L1 expired entry: verify Redis fallback, L1 re-populated
- `get()` L1 miss: verify Redis `.get()` called
- `set()` with TTL: verify Redis `.set(key, val, "EX", ttl)` + L1 updated
- `set()` without TTL: verify Redis `.set(key, val)` + L1 `expiry: 0`
- `del()`: verify both Redis and L1 cleared
- `scan()`: mock Redis `.scan()` iterator, verify all pages collected
- `batchGet()`: mock Redis `.pipeline()`, verify all keys fetched in single round-trip, result is Map
- L1 eviction at max size: fill to 1000, insert one more, verify oldest evicted (Map insertion order)

`**cache.controller.spec.ts**` -- Tests for [cache.controller.ts](services/cache-service/src/modules/cache/cache.controller.ts):

- `GET /cache/:key` returns value
- `PUT /cache/:key` with `{value, ttl}` returns `{ok: true}`
- `DELETE /cache/:key` returns `{ok: true}`
- `GET /cache?pattern=test*` returns key array
- `POST /cache/batch` with `{keys: [...]}` returns object from Map entries

`**health.controller.spec.ts**` -- Redis ping ok/fail pattern.

## Integration tests (real NATS + Redis via Docker)

Require `docker-compose.test.yaml` running. Tests connect to `localhost:4222` (NATS) and `localhost:6379` (Redis).

### api-gateway integration

`**events.integration.spec.ts**`:

- Bootstrap full NestJS app with real NATS/Redis connections
- `POST /events {type: "test", payload: {foo: 1}}`: verify NATS stream received the message (subscribe and check), verify Redis `pending:<id>` key exists
- `GET /results/:id` after manually writing `result:<id>` to Redis: verify correct response

### event-processor integration

`**processor.integration.spec.ts**`:

- Bootstrap full NestJS app with real NATS/Redis
- Publish a message directly to NATS `events.test` with `{id: "abc", type: "test", payload: {}}`
- Wait (polling with timeout) for Redis key `result:abc` to appear
- Verify the stored result has `{eventId: "abc", type: "test", processed: true, timestamp: <number>}`

### cache-service integration

`**cache.integration.spec.ts**`:

- Bootstrap full NestJS app with real Redis
- Full CRUD cycle via HTTP: PUT a key, GET it back, DELETE it, GET returns null
- Batch: PUT 3 keys, POST batch get, verify all returned
- SCAN: PUT keys with prefix, scan with pattern, verify found

## E2E test (full cross-service event flow)

`**tests/e2e/event-flow.e2e.spec.ts**`:

This test boots all three services in-process (different ports) against shared real NATS + Redis:

```
1. POST /events to api-gateway  {type: "created", payload: {name: "test"}}
2. Assert 202 + get event ID
3. Poll GET /results/:id on api-gateway (max 10s, 500ms interval)
4. Assert result: {eventId, type: "created", processed: true, timestamp}
5. GET /cache/:key on cache-service (verify not found)
6. PUT /cache/:key on cache-service with result data
7. GET /cache/:key  -- verify data returned
8. POST /cache/batch -- verify batch includes the key
9. DELETE /cache/:key -- verify gone
```

This validates the complete event publish -> consume -> cache -> retrieve pipeline.

## Test execution

```bash
# Start test infrastructure
docker compose -f tests/docker-compose.test.yaml up -d

# Run all tests for a single service
cd services/api-gateway && bun test

# Run only unit tests (no Docker needed)
cd services/api-gateway && bun test test/unit

# Run integration tests (Docker required)
cd services/api-gateway && bun test test/integration

# Run E2E
cd tests/e2e && bun test

# Tear down
docker compose -f tests/docker-compose.test.yaml down
```

## Summary of test count


| Service         | Unit tests | Integration tests | Total   |
| --------------- | ---------- | ----------------- | ------- |
| api-gateway     | ~10        | ~3                | ~13     |
| event-processor | ~5         | ~2                | ~7      |
| cache-service   | ~13        | ~4                | ~17     |
| E2E             | --         | --                | ~5      |
| **Total**       | **~28**    | **~9 + 5 E2E**    | **~42** |


