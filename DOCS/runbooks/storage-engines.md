# Storage engines (Postgres vs Mongo)

Platform OLTP data can run on **PostgreSQL** (default) or **MongoDB**, selected at **bootstrap time**. Temporal always stays on dedicated Postgres CNPG clusters.

## Choosing an engine

```bash
# Default — Postgres OLTP + Temporal Postgres
./bootstrap-orbstack-osx.sh dev support-services platform-services

# Mongo OLTP + Temporal Postgres (hybrid)
./bootstrap-orbstack-osx.sh --storage-engine=mongo dev support-services platform-services
```

Environment variables (same semantics):

| Variable | Values | Default |
|----------|--------|---------|
| `STORAGE_ENGINE` | `postgres`, `mongo` | `postgres` |
| `DB_ENGINE` | `postgres`, `mongo` | `postgres` (alias, used in Knative patches) |

Services resolve the active engine once in `src/config.ts` via `resolveStorageEngine()` from `@yoizen/database`.

## What changes per engine

| Layer | Postgres | Mongo |
|-------|----------|-------|
| Infra (local) | `infrastructure/overlays/local/<env>` → `local-base` → `overlays/postgres` (no Mongo) | `infrastructure/overlays/local/mongo-<env>` → `mongo-local-base` → `overlays/mongo` (no OLTP Postgres) |
| Infra (orbstack) | `infrastructure/overlays/orbstack/<env>` | `infrastructure/overlays/orbstack/mongo-<env>` |
| Knative (dev) | `knative/services/overlays/local/postgres-dev` | `knative/services/overlays/local/mongo-dev` |
| Per-tenant DB | Default `shared` tier: logical DB on `postgres-shared` exposed in the tenant namespace by a `postgres` ExternalName Service. `dedicated` tier: per-tenant PostgreSQL StatefulSet. | Default `shared` tier: logical DB on shared Mongo; `dedicated` tier: per-tenant Mongo StatefulSet. |
| Shared platform DB | CNPG `postgres-shared` / legacy `postgres` SS | Replica set `mongo-platform` |
| Usage time-series | Timescale `postgres-usage-shared` | Replica set `mongo-usage` (time-series collections) |
| **Temporal** | `postgres-temporal*` (unchanged) | `postgres-temporal*` (unchanged) |

## Application pattern

Each migrated NestJS service uses:

1. **Repository interface** (port) per feature module
2. **Postgres adapter** — `postgres.js` / SQL (restored from git history)
3. **Mongo adapter** — `mongodb` driver (current implementation)
4. **`createRepositoryProvider`** — binds the interface to the adapter for `config.dbEngine`

`agent-ai-service` uses `IMemoryStore` / `IVectorIndex` / `ILeaderElection` with the same `DB_ENGINE` switch.

## Feature matrix (dev/local)

| Capability | Postgres | Mongo |
|------------|----------|-------|
| Multi-tenant isolation | Logical DB per tenant on the shared tier; physical StatefulSet per tenant on the dedicated tier | Logical DB per tenant on the shared tier; physical StatefulSet per tenant on the dedicated tier |
| Idempotent inserts | `ON CONFLICT DO NOTHING` | `insertMany` + E11000 / upsert |
| Batch projection | `UPDATE … FROM unnest` | `bulkWrite` |
| Usage aggregates | Timescale `time_bucket`, continuous aggregates | `$dateTrunc` aggregation pipelines |
| Vector search (runtime) | pgvector | Atlas Local / cosine fallback |
| Scheduler leader lock | `pg_advisory_lock` | TTL heartbeat document |
| Transactions (auth roles) | `sql.begin` | multi-doc sessions (where needed) |

## Port-forward

```bash
STORAGE_ENGINE=postgres ./port-forward.sh dev   # 5432 shared postgres
STORAGE_ENGINE=mongo ./port-forward.sh dev      # 27017 platform, 27018 usage
```

Temporal Postgres ports are forwarded in **both** modes.

## Testing

> `tests/e2e`, `tests/stress`, and `experiments/` were deleted from the
> repository. Per-service unit tests run from within each service:
>
> ```bash
> cd services/<service-name>
> bun test
> ```
>
> Integration testing is done manually: bootstrap the cluster with the desired
> engine, then exercise the platform API. Tenant provisioning can be scripted
> via `setup-tenant.sh`.

## Switching engines on an existing cluster

Dev data is disposable. Changing `--storage-engine` without a full reset leaves tenants provisioned for the previous engine. Prefer:

```bash
./bootstrap-orbstack-osx.sh --reset --storage-engine=mongo dev support-services platform-services
```

## Out of scope

- Dual-write or CDC between engines
- Per-service or per-tenant engine selection at runtime (bootstrap-level only)
- Migrating Temporal to Mongo
