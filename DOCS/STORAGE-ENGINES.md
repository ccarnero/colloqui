# Storage engines (Postgres vs Mongo)

Platform OLTP data can run on **PostgreSQL** (default) or **MongoDB**, selected at **bootstrap time**. Temporal always stays on dedicated Postgres CNPG clusters.

## Choosing an engine

```bash
# Default — Postgres OLTP + Temporal Postgres
./bootstrap-minikube.sh dev support-services platform-services

# Mongo OLTP + Temporal Postgres (hybrid)
./bootstrap-minikube.sh --storage-engine=mongo dev support-services platform-services
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
| Per-tenant DB | StatefulSets `postgres` + `postgres-usage` | StatefulSet `mongo` (platform + usage DBs) |
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
| Multi-tenant isolation | DB per tenant | DB per tenant |
| Idempotent inserts | `ON CONFLICT DO NOTHING` | `insertMany` + E11000 / upsert |
| Batch projection | `UPDATE … FROM unnest` | `bulkWrite` |
| Usage aggregates | Timescale `time_bucket`, continuous aggregates | `$dateTrunc` aggregation pipelines |
| Vector search (runtime) | pgvector | Atlas Local / cosine fallback |
| Scheduler leader lock | `pg_advisory_lock` | TTL heartbeat document |
| Transactions (auth roles) | `sql.begin` | multi-doc sessions (where needed) |

## Port-forward

```bash
STORAGE_ENGINE=postgres ./port-forward-minikube.sh dev   # 5432 shared postgres
STORAGE_ENGINE=mongo ./port-forward-minikube.sh dev      # 27017 platform, 27018 usage
```

Temporal Postgres ports are forwarded in **both** modes.

## E2E / stress tests

```bash
# Matches bootstrap default
bun test tests/e2e

# Explicit engine (overrides bootstrap env)
E2E_STORAGE_ENGINE=mongo bun test tests/e2e
```

`tests/stress/scripts/provision.sh` is engine-agnostic (HTTP API). Postgres tenant provisioning deploys two StatefulSets and may take longer than Mongo before `wait_tenant_ready` succeeds.

## Switching engines on an existing cluster

Dev data is disposable. Changing `--storage-engine` without a full reset leaves tenants provisioned for the previous engine. Prefer:

```bash
./bootstrap-minikube.sh --reset --storage-engine=mongo dev support-services platform-services
```

## Out of scope

- Dual-write or CDC between engines
- Per-service or per-tenant engine selection at runtime (bootstrap-level only)
- Migrating Temporal to Mongo
