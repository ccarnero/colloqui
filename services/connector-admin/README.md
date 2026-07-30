# Connector Admin

Multi-tenant connector configuration service. It manages connector definitions (base URL, auth type, custom headers, timeouts, retries) and their endpoints per tenant. Internally some modules still use legacy `adapter` names, but the public HTTP surface is `/connectors`.

## Quick Start

```bash
pnpm install
bun run start:dev
```

Requires the configured storage engine. `DB_ENGINE` / `STORAGE_ENGINE` defaults to `postgres`; `mongo` is optional.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/connectors` | Create connector (+ optional inline endpoints) |
| `GET` | `/connectors` | List connectors for tenant (optional `?context=`, `?tag=`, `?name=`, `?limit=`, `?offset=` filters) |
| `GET` | `/connectors/usage` | Connector call usage stats |
| `GET` | `/connectors/:id` | Get connector with endpoints |
| `PATCH` | `/connectors/:id` | Partial update connector |
| `DELETE` | `/connectors/:id` | Delete connector (cascades endpoints) |
| `POST` | `/connectors/:id/endpoints` | Add endpoint to connector |
| `PATCH` | `/connectors/:id/endpoints/:epId` | Partial update endpoint |
| `DELETE` | `/connectors/:id/endpoints/:epId` | Remove endpoint |
| `GET` | `/health` | Health check |
| `GET` | `/healthz` | Liveness probe — returns 200 unconditionally while the process is up |
| `GET` | `/readyz` | Readiness probe — gates differ per `SERVICE_MODE`, surfaces discrete readiness checks in the JSON body |

All connector routes require `x-yoizen-tenant` for tenant scoping.

## Retry-chain caps (`timeoutMs`, `maxRetries`, `retryBackoffMs`)

The three connector retry-chain fields have upper caps, exported as shared
constants from `packages/shared/src/adapter-schema.ts` and enforced with
`@Max(...)` on both the Create and the Update DTO in
`src/modules/adapters/adapters.dto.ts`:

| Field | Cap constant | Value |
|-------|--------------|-------|
| `timeoutMs` | `ADAPTER_TIMEOUT_MS_MAX` | `60_000` (60s) |
| `maxRetries` | `ADAPTER_MAX_RETRIES_MAX` | `3` |
| `retryBackoffMs` | `ADAPTER_RETRY_BACKOFF_MS_MAX` | `10_000` (10s) |

**Why the caps exist.** An uncapped `timeoutMs` × retries lets a single
connector call outlive the async invoke consumer's JetStream ack wait
(`INVOKE_CONSUMER_ACK_WAIT_MS = 300_000` in
`services/connector-runtime/src/config.ts`). Past that window NATS redelivers
the in-flight message and the outbound HTTP call is duplicated. With the caps
in place the worst-case chain is
`3 × (60s + 10s) + 10s` webhook delivery `= 220s < 300s`, so the ack wait is
never exceeded.

**The invariant is a test, not a comment.**
`services/connector-runtime/test/unit/invoke-ack-wait-invariant.spec.ts`
asserts the worst chain against the real exported `INVOKE_CONSUMER_ACK_WAIT_MS`
— raising any of the three caps or lowering the ack wait without rebalancing
breaks the build.

**Validation layer only.** There is no DB `CHECK` constraint and no migration:
pre-existing rows whose values sit above a cap keep working as-is and are only
rejected the next time they are written through `POST`/`PATCH`.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port |
| `SERVICE_MODE` | `api` when unset | Split-service mode: `api` or `worker` |
| `DB_ENGINE` / `STORAGE_ENGINE` | `postgres` | Storage engine selector: `postgres` or `mongo` |
| `POSTGRES_HOST` | `postgres.support-services-dev.svc.cluster.local` | PostgreSQL host when using Postgres |
| `POSTGRES_PORT` | `5432` | PostgreSQL port |
| `POSTGRES_DB` | `yoizen` | Database name |
| `POSTGRES_USER` | `yoizen` | Database user |
| `POSTGRES_PASSWORD` | `yoizen-dev-password` | Database password |

## Testing

```bash
bun test:unit
bun test:integration
```

## Architecture

See [AGENTS.md](AGENTS.md) for database schema, module dependency graph, DI tokens, and conventions.
