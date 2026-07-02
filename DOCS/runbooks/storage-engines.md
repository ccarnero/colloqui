# Storage engines (Postgres vs Mongo)

Platform OLTP data can run on **PostgreSQL** (default) or **MongoDB**, selected at **bootstrap time**. Temporal always stays on dedicated Postgres CNPG clusters.

## Choosing an engine

```bash
# Default — Postgres OLTP + Temporal Postgres (full dev bring-up)
./bootstrap-orbstack-osx.sh

# Mongo OLTP + Temporal Postgres (hybrid)
./bootstrap-orbstack-osx.sh --storage-engine=mongo
```

The script always targets the single dev environment — there is no `dev` positional argument or per-environment overlay to select. An optional `[GROUP]` (`support-services` or `platform-services`) restricts the run to one group; omitting it runs both.

Environment variables (same semantics):

| Variable | Values | Default |
|----------|--------|---------|
| `STORAGE_ENGINE` | `postgres`, `mongo` | `postgres` |
| `DB_ENGINE` | `postgres`, `mongo` | `postgres` (alias, takes precedence over `STORAGE_ENGINE` in app code; Knative patches set `STORAGE_ENGINE`) |

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

`agent-ai-service` follows the same repository-port pattern for agent config (`IAgentConfigRepository`, switched by `DB_ENGINE`). Memory retrieval goes through `MemoryClientService`, an HTTP client to `agent-memory-service`, which is Postgres-only (no Mongo adapter, no engine switch). The scheduler's `LeaderElectionService` is also Postgres-only — it always uses `pg_try_advisory_lock` regardless of `DB_ENGINE`.

## Feature matrix (dev/local)

| Capability | Postgres | Mongo |
|------------|----------|-------|
| Multi-tenant isolation | Logical DB per tenant on the shared tier; physical StatefulSet per tenant on the dedicated tier | Logical DB per tenant on the shared tier; physical StatefulSet per tenant on the dedicated tier |
| Idempotent inserts | `ON CONFLICT DO NOTHING` | `insertMany` + E11000 / upsert |
| Batch projection | `UPDATE … FROM unnest` | `bulkWrite` |
| Usage aggregates | Timescale `time_bucket`, continuous aggregates | `$dateTrunc` aggregation pipelines |
| Vector search (runtime) | pgvector (`agent-admin-service` knowledge-base embeddings, always Postgres regardless of `DB_ENGINE`) | Not implemented; `agent-ai-service`'s in-memory `cosineSimilarity` fallback is engine-independent, not a Mongo-backed vector store |
| Scheduler leader lock | `pg_advisory_lock` | Not implemented; `LeaderElectionService` always uses `pg_try_advisory_lock` regardless of `DB_ENGINE` |
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

Dev data is disposable. Changing `--storage-engine` without a full reset leaves tenants provisioned for the previous engine. `bootstrap-orbstack-osx.sh` has no `--reset` flag — clean up manually before switching:

```bash
kubectl delete namespace support-services-dev platform-services-dev
./bootstrap-orbstack-osx.sh --storage-engine=mongo
```

## Out of scope

- Dual-write or CDC between engines
- Per-service or per-tenant engine selection at runtime (bootstrap-level only)
- Migrating Temporal to Mongo
