# PostgreSQL → MongoDB Migration Assessment — Yoizen Arch

> Read-only investigation. Snapshot date: 2026-05-21.
> Scope: every service under `services/` plus shared schemas in `packages/shared/` and `packages/database/`.

## TL;DR

The platform uses PostgreSQL in three distinct roles. Only one of them is a natural fit for MongoDB:

| Tier | Recommendation |
|------|----------------|
| **Per-tenant OLTP "config" stores** (adapters, agents, workflows, channel accounts) | **Strong MongoDB candidate** in 2 services; **mixed** in 2 |
| **Append-only audit/event stores** (audit-service `events` + channel audit) | **Strong MongoDB candidate** |
| **TimescaleDB usage pipeline** (usage-aggregator + channel-service usage) | **Keep on Postgres** (irreplaceable feature set) |
| **Platform catalog / RBAC** (tenant-service, auth-service, registry-service) | **Keep on Postgres** (referential integrity & cross-tenant joins) |
| **YoizenClaw runtime memory** (pgvector + advisory locks) | **Keep on Postgres** (specific extensions) |

There is also a **one-time platform tax** that the first migration must absorb: a `MongoTenantConnectionManager` analog, per-tenant Mongo provisioning in `tenant-service`, health controllers, and dual-write tooling. After that, additional services migrate cheaply.

Below is the full breakdown.

---

## 1. Current data-tier topology

Three storage planes coexist (mapped from `packages/shared/src/*-schema.ts`, `services/tenant-service/src/providers/postgres.provider.ts`, and `packages/database/src/tenant-connection-manager.ts`):

| Plane | Host | Boundary | Examples |
|-------|------|----------|----------|
| **Platform Postgres** (shared) | `postgres.support-services-*` | `tenant_id` column | `tenants`, `platform_users`, `api_clients`, `public_routes`, `registered_services`, `service_routes`, `canary_deployments` |
| **Per-tenant OLTP** | `postgres.<tenant>-<env>-ns` | DB = tenant | `http_adapters`, `adapter_endpoints`, `workflow_definitions`, `workflow_executions`, `channel_accounts`, `auto_reply_rules`, `tenant_users`, `tenant_roles`, `tenant_role_permissions`, audit `events`, audit `channel_events`, audit `gateway_audit_events`, YoizenClaw `agents`/`jobs`/`job_executions`/`credentials`/`config_files` |
| **TimescaleDB usage** | `postgres-usage` (dedicated) or shared `yoizen_usage` | tenant_id partition or DB | Hypertable `channel_events` + continuous aggregates |

The `TenantConnectionManager` (see `packages/database/src/tenant-connection-manager.ts`) and `tenant-deletion-eviction-listener.ts` are central — they hide pool routing, lazy DDL, eviction on tenant deletion. **Any Mongo migration must extend, not bypass, this mechanism.**

---

## 2. Migration candidates — ranked

### TIER A — Strong MongoDB candidates

#### A1. `connector-admin` (HTTP adapters + endpoints)

**Why MongoDB wins**

- Data is a literal document tree: `http_adapters` row + N `adapter_endpoints` joined and **always grouped back into a single response** with `Map<string, EndpointRow[]>` (`services/connector-admin/src/modules/adapters/adapters.repository.ts`). The repository already does the embed in application code.
- Three JSONB columns (`auth_config`, `headers`, `default_cache_strategy`) plus a JSONB endpoint `cache_strategy`. Mongo natively types these as sub-documents — no `parseJsonb` helper, no `JSON.stringify` on insert (`adapters.repository.ts:67-74, 90-95`).
- The `TEXT[] tags` + GIN index maps 1:1 to a Mongo array field with a default multi-key B-tree index.
- The unique key is `(name)` only (DB is the tenant boundary) — trivial in Mongo (`{name:1}` unique).
- Upserts come from a JetStream consumer (`internal-sync.service.ts`) that mirrors `service.upserted.v1` events. Idempotent upserts (`updateOne(..., {upsert:true})`) are simpler than the current SELECT-then-UPDATE/INSERT pattern (`adapters.repository.ts:251-304`).
- No transactions across documents. No aggregates. No JOINs that aren't trivially embedded.

**Where MongoDB is neutral or slightly worse**

- The FK cascade (`adapter_endpoints.adapter_id REFERENCES ... ON DELETE CASCADE`) becomes application-managed delete OR collapsed into an embedded subdocument array. The latter is faster and removes a query.
- Partial index `WHERE managed_by IS NOT NULL` is a partial index in Mongo (`partialFilterExpression`) — direct port.
- `is_encrypted` boolean + secrets in `auth_config` JSONB: still need KMS-style envelope encryption — orthogonal to the DB.

**Effort: S–M (3–7 days) for this service alone. M–L (1–2 weeks) including the shared `MongoTenantConnectionManager` if it doesn't yet exist.**

Concrete steps:

1. Add `MongoTenantConnectionManager` to `packages/database` (mirror of `tenant-connection-manager.ts`) returning per-tenant `MongoClient` and lazy index creation (`adapters` collection with indexes `{name:1} unique`, `{context:1}`, `{tags:1}`, `{managed_by:1} partial`).
2. Replace `services/connector-admin/src/providers/tenant-connection-manager.ts` with a Mongo subclass that registers an `ensureSchema` hook calling `createIndexes`.
3. Rewrite `adapters.repository.ts` (~550 lines → ~250) with embedded `endpoints: [...]` subdocuments; collapse `mapAdapter`/`mapEndpoint`.
4. Update `tenant-service` provisioner to create the tenant Mongo DB at the same step it currently runs `ensureTenantPostgresProvisioned` (`services/tenant-service/src/providers/postgres.provider.ts:66-88`).
5. Health controller swap: add `nats-tenant-mongo-health.controller.ts` next to `nats-tenant-postgres-health.controller.ts`.
6. Tests: rewrite `make-sql-mock.ts` to a `makeFakeTenantMongo` helper (mongodb-memory-server).

**Trade-off accepted**: Lose `ON DELETE CASCADE` (replaced by embedded sub-docs); lose ConflictException via `error code 23505` (replaced by `E11000`).

---

#### A2. `audit-service` — domain `events` + `channel_events`

**Why MongoDB wins**

- Pure append-only event log keyed by id (`services/audit-service/src/modules/audit/audit.repository.ts:42-69`). Mongo capped collections or time-series collections (since 5.0) are purpose-built for this.
- Schema is JSONB `payload` + JSONB `metadata` + a few flat indexable fields (type, subject, created_at). That's already a Mongo document.
- Writes come from NATS in batches of 100 with `ON CONFLICT (id) DO NOTHING` — equivalent to `insertMany({ ordered: false })` with duplicate-key tolerance.
- Read path is `WHERE type = ? AND created_at BETWEEN ?` ordered by `created_at DESC` — Mongo `find({type, createdAt: {$gte, $lte}}).sort({createdAt:-1}).limit(n)` with a compound index `{type:1, createdAt:-1}` is at least as fast.
- Time-series collections give automatic bucketing and zstd compression similar to Timescale-without-the-aggregates — relevant since the AGENTS.md for audit-service explicitly does NOT use Timescale features there.
- **TTL indexes** replace the missing retention story (today the audit events table grows unboundedly per tenant — Mongo TTL index on `created_at` is a one-line fix).

**Where Postgres is currently better — and what we'd lose**

- The other two tables in the same service (`gateway_audit_events`) use SQL aggregates: `PERCENTILE_CONT`, `COUNT(*) FILTER (WHERE ...)`, `DATE_TRUNC` (`services/audit-service/src/modules/gateway-audit/gateway-audit.service.ts:232-291`). Mongo aggregation pipeline can express these but is more verbose and percentiles need `$percentile` (8.0+) or an explicit `$bucket` workaround.
- **Recommendation**: split — migrate `events` (rare reads, append-only) to Mongo; keep `gateway_audit_events` on Postgres (or move it to ClickHouse if there's enough volume — but that's out of scope).

**Effort: S (2–4 days)** if `MongoTenantConnectionManager` already exists from A1. Otherwise S+M plus the shared cost.

---

#### A3. `yoizenclaw-admin-service` (agents, credentials, jobs, job_executions, config_files)

**Why MongoDB wins**

- Each tenant DB gets seeded with **2 agents and 2 jobs** (AGENTS.md). Tiny cardinality. No reason for FKs.
- `agents.model_config`, `agents.tools`, `agents.channels` are all JSONB arrays — natural Mongo sub-documents (`services/yoizenclaw-admin-service/src/providers/yoizenclaw-schema-initializer.ts`).
- `job_executions.logs TEXT[]` and `payload`/`event_payload`/`result` JSONB — same.
- The one JOIN (`job_executions LEFT JOIN jobs` for name) is just a denormalized field on Mongo.
- `config_files` is essentially a key-value store with `path UNIQUE` — a dictionary use-case.
- Soft-FK to `agents`/`jobs` is enforced today by `ON DELETE CASCADE` only; can become "delete parent → delete child collection rows" in a transaction (Mongo replica-set txn) or embedded subdocs.

**What we'd lose**

- Partial index on `jobs(is_active) WHERE is_active = true` — replicated via Mongo partial filter.
- Transactional schema init (`yoizenclaw-schema-initializer.ts:86-90`) replaced by `runCommand({createIndexes:...})`.

**Effort: S–M (3–7 days)** alongside A1/A2.

---

### TIER B — Mixed (selectively migrate)

#### B1. `channel-service` — `channel_accounts` + `auto_reply_rules` (NOT the usage hypertable)

- Same shape as connector-admin: parent + child rules; document-like; few JSONB fields. Migration shape identical to A1.
- BUT: this service is co-deployed with the **TimescaleDB usage path** (the usage write side lives in `usage-aggregator-service`, but channel-service reads `channel_events_hourly` continuous aggregates). Migrating accounts to Mongo while leaving usage on Timescale means the service now needs **two DB clients** and **two tenant connection managers**. That's operationally non-trivial.
- **Verdict**: defer until A1 + A2 are in production and the `MongoTenantConnectionManager` is battle-tested. Then **S (2–3 days)**.

#### B2. `workflow-service` — `workflow_definitions` (yes), `workflow_executions` (no)

- `workflow_definitions.actions` is a JSONB array of step descriptors — Mongo natural fit.
- `workflow_definitions.trigger` has a **partial index on a JSON path** (`((trigger->>'type'))`) — works in Mongo as `{trigger.type:1}`.
- **But** `workflow_executions` is treated as a **projection of Temporal state**, updated in batch via `UPDATE workflow_executions SET status=$1 FROM unnest($2::text[],$3::text[]) AS t(id,status)` (`executions.repository.ts:53-62`). The `unnest`-driven batch update has no efficient Mongo equivalent at the same Big-O (you'd issue N `updateOne` ops or a `bulkWrite`; bulkWrite is good but adds round-trips). Throughput-wise, Postgres `UPDATE ... FROM unnest` is hard to beat.
- **Verdict**: migrate `workflow_definitions` (small, document-shaped) **only** if it's part of a wider config-collection consolidation. Keep `workflow_executions` on Postgres.
- **Effort if you split**: M (5–10 days) — adds cross-DB consistency (definition_id reference becomes a string in two stores).
- **Effort if you migrate both anyway**: L (2–3 weeks), with a measurable throughput regression on the projector path.

---

### TIER C — Keep on PostgreSQL (don't migrate)

#### C1. `usage-aggregator-service` + the usage hypertable in `channel-service`

**Why Postgres wins decisively**

- The whole pipeline is **TimescaleDB-native**: hypertable, hash partitioning by `tenant_id`, **continuous aggregates** (`channel_events_hourly`, `channel_events_daily`), compression policy after 7 days, retention policy at 60 days (`packages/shared/src/channel-usage-schema.ts:42-114`, `125-216`).
- Write path: `INSERT … SELECT * FROM UNNEST(...) ON CONFLICT (idempotency_key, ts) DO NOTHING` at **500 rows / 1s flush** (`services/usage-aggregator-service/src/.../batch-inserter.ts:51-71`). This is the highest-write surface in the platform.
- Read path: bucketed time-series queries blending continuous aggregates + tail via UNION (`usage.repository.ts:71-108`).

**What MongoDB would force you to give up**

- No equivalent to continuous aggregates. Atlas time-series collections support window functions but require manual materialization, lose the policy-driven refresh model.
- Compression and chunk-pruning are Timescale's killer features for billing-grade time series — Mongo time-series compression exists but isn't as aggressive.
- Materialized-on-write CAGGs back the dashboard's sub-100ms reads; Mongo would force `$facet` over raw points or a hand-rolled rollup service.

**Effort if you tried**: **XL (months)** and you'd ship a regression. **Do not migrate.**

---

#### C2. `auth-service` — platform users + tenant RBAC

**Why Postgres wins**

- Login goes through 2 JOINs (`tenant_users ⋈ tenant_roles ⋈ tenant_role_permissions`, `services/auth-service/src/modules/tokens/token.repository.ts:48`, `services/auth-service/src/modules/users/tenant-users.repository.ts:68`). Mongo would either denormalize (stale-permission risk) or do `$lookup`s which negate the upside.
- Cross-tenant probing loops tenant DBs O(n) (`token.repository.ts:80+`). Already a hot spot — converting this to Mongo gains nothing.
- RBAC integrity is **security-critical**. FK + unique constraints with `ON DELETE CASCADE` give correctness for free. Mongo can do it via transactions, but the relational model is the simpler invariant here.
- Public routes table is tiny and synced to Redis — irrelevant to the DB choice.

**Verdict**: **Keep on Postgres**. Migration would be high effort (L) for negative ROI.

---

#### C3. `tenant-service` — platform `tenants` catalog

- One central table with `name`, `tier`, `configuration` JSONB, `provisioning_status`. **Many** services read `tenants.tier` on startup or per request — it's the routing table for shared-vs-dedicated tier resolution.
- A relational catalog with strict CHECK constraints + partial index on incomplete provisioning (`services/tenant-service/src/providers/platform-postgres.provider.ts:18-61`) is the right primitive.
- Migrating it would force **every other service** to learn a new client to do `SELECT tier FROM tenants WHERE id=?` — a cross-cutting refactor with no benefit.
- **Verdict**: **Keep on Postgres**. Single source of tier truth. Effort if forced: **L–XL** because of fan-out.

---

#### C4. `registry-service`

- 3 tables (`registered_services`, `service_routes`, `canary_deployments`) with FK cascades; small data set (one row per Knative ksvc per tenant).
- Discovery endpoint joins `service_routes ⋈ registered_services` and is polled every 15s by api-gateway (`services/registry-service/src/modules/routes/routes.service.ts`).
- Could migrate but **no measurable upside**: rows are not document-shaped, the relational query is trivial, and migration cost outweighs benefit.
- **Verdict**: **Keep on Postgres**. Effort if forced: **M (1 week)**.

---

#### C5. `yoizenclaw-runtime` (Python)

- Uses `pgvector` (`embeddings.vector(1536)` + IVFFlat cosine index — `services/yoizenclaw-runtime/alembic/versions/001_initial_schema.py:82-93`).
- Uses `pg_try_advisory_lock` / `pg_advisory_unlock` for scheduler leader election (`scheduler_leader.py:29-49`).
- Both are Postgres-extension features. Mongo Atlas Vector Search exists but only on Atlas — not self-hostable. Advisory locks have no native Mongo equivalent (you'd need a Redis lease or a dedicated coordinator).
- **Verdict**: **Keep on Postgres**. Migration would be **XL**, and would replace a known-good design with a multi-store one.

---

## 3. Migration effort summary

T-shirt sizes assume the **shared platform work is done once** (see §4):

| Service / area | Verdict | Net effort | Shared infra needed |
|----------------|---------|------------|---------------------|
| connector-admin (adapters + endpoints) | Migrate | **S–M (3–7 d)** | MongoTenantConnectionManager |
| audit-service `events`, audit `channel_events` | Migrate | **S (2–4 d)** | TTL indexes; time-series collection |
| yoizenclaw-admin-service | Migrate | **S–M (3–7 d)** | — |
| channel-service `channel_accounts` only | Optional | **S (2–3 d)** | Service runs dual-store (Mongo + Timescale) |
| workflow-service `workflow_definitions` only | Optional | **M (5–10 d)** | Split-store consistency |
| audit-service `gateway_audit_events` | Keep | n/a | Aggregates favor SQL |
| usage-aggregator + usage hypertable | **Keep** | n/a (XL if forced) | Timescale features |
| auth-service | **Keep** | n/a (L if forced) | FK + cross-tenant joins |
| tenant-service | **Keep** | n/a (XL if forced) | Platform routing table |
| registry-service | **Keep** | n/a (M if forced) | No upside |
| yoizenclaw-runtime | **Keep** | n/a (XL if forced) | pgvector + advisory locks |

---

## 4. One-time platform cost (the "first-mover tax")

The first migration has to land all of this; subsequent ones are cheap:

1. **`packages/database` additions**
   - `mongo-provider.ts` (analog of `postgres-provider.ts`)
   - `MongoTenantConnectionManager` (analog of `tenant-connection-manager.ts`) — must support the same lazy `ensureSchema` hook (now creating indexes + collections) and the same eviction listener (`tenant-deletion-eviction-listener.ts`).
   - `mongo-errors.ts` (E11000 → `ConflictException` mapping, analog of `postgres-errors.ts`).
   - `nats-tenant-mongo-health.controller.ts` + `nats-tenant-mongo-health.ts`.

2. **`tenant-service` provisioner extension**
   - `services/tenant-service/src/providers/postgres.provider.ts:66-88` currently bakes `WORKFLOW_SCHEMA_SQL`, `ADAPTER_SCHEMA_SQL`, etc. into each tenant's `init.sql`. Add a parallel **MongoDB provisioning step** that creates the tenant's Mongo DB, the seed collections, and indexes — atomically with the Postgres step (best-effort with reconcile loop on failure).
   - Update `tenant_database_tier` semantics if dedicated-vs-shared Mongo is to be supported.

3. **Bootstrap scripts** (`bootstrap-minikube.sh`, `bootstrap-orbstack.sh`, `port-forward.sh`)
   - Deploy MongoDB (likely the Bitnami chart or `mongodb-community-operator`).
   - Add port-forward entries.

4. **Observability**
   - `@yoizen/observability` already abstracts metrics — wire a Mongo driver instrumentation (OpenTelemetry MongoDB plugin) so traces span both stores during the dual-write phase.

5. **Dual-write & cutover playbook**
   - Per-service: implement repository behind an interface, dual-write to both PG and Mongo for N days, run a shadow-read consistency check (sample 1% of reads, diff results, alert on drift), then flip a feature flag.
   - For `connector-admin` specifically, dovetail with the existing `REGISTRY_EMIT_ADAPTER_SYNC` flag pattern (`services/registry-service/AGENTS.md`) — same rollout discipline.

6. **Testing**
   - Add `mongodb-memory-server` to `packages/testing`.
   - Per-service unit tests need a `makeFakeTenantMongo()` helper analogous to `makeFakeTenantConnections()`.

**Platform cost: M–L (1.5–3 weeks)** depending on whether dedicated-per-tenant Mongo or shared-Mongo-with-DB-per-tenant is chosen. Recommend **DB-per-tenant on a shared Mongo replica set** for parity with the shared-Postgres tier.

---

## 5. Recommended migration sequence

1. **Land the shared platform work** behind a feature flag (no service consumes it yet). M–L.
2. **Migrate `connector-admin` first** — smallest blast radius, clearest document-shape win, already has a managed-by mirror pipeline that exercises upsert semantics. S–M.
3. **Migrate `audit-service.events` second** — pure append-only, low read volume, immediate TTL/retention win. S.
4. **Migrate `yoizenclaw-admin-service`** — small per-tenant data, lots of JSONB, naturally hierarchical. S–M.
5. **Stop**. Re-evaluate after these three are stable for ≥30 days in production. Resist the urge to move workflow definitions or channel accounts unless there's a concrete reason (cost, scaling, schema flexibility).

Total realistic delivery: **5–8 weeks** including platform work, dual-write, and cutover for the three Tier-A services.

---

## 6. Why Postgres wins in the "Keep" cases — explicit reasons

| Service / area | Postgres feature that's hard or impossible to replace |
|----------------|--------------------------------------------------------|
| `usage-aggregator-service`, channel usage | **TimescaleDB hypertables, continuous aggregates, compression policy, retention policy** — Mongo time-series collections exist but lack policy-driven materialized rollups |
| `yoizenclaw-runtime` | **`pgvector` IVFFlat cosine index** for RAG; **`pg_try_advisory_lock`** for scheduler leader election — neither has a native Mongo equivalent |
| `auth-service` | **Multi-table FK integrity, ACID 2-row updates** for user↔role↔permission JOIN paths; **deterministic cross-tenant joins** in the cross-tenant login probe |
| `tenant-service` | **Central routing table**: every service reads `tenants.tier` — keeping this in Postgres avoids a cross-cutting refactor and preserves CHECK-constraint correctness |
| `registry-service` | **Cascade deletes + the `routes ⋈ services` discovery JOIN** are trivial in SQL; migration has no Big-O upside |
| `audit-service.gateway_audit_events` | **`PERCENTILE_CONT`, `COUNT(*) FILTER`, `DATE_TRUNC` over wide-fact rows** — Mongo aggregation pipeline can express these but at higher latency and lower clarity |

---

## 7. Risks to flag before you commit

1. **Operational doubling**: running two stateful systems per tenant doubles backup/restore/upgrade work. The current per-tenant Postgres model is already heavy (`postgres.<tenant>-<env>-ns.svc.cluster.local`). Adding `mongo.<tenant>-<env>-ns` will need the same SRE muscle.
2. **Tenant deletion** (`packages/database/src/tenant-deletion-eviction-listener.ts`) must be extended to also drop the Mongo DB — otherwise tenants leak storage on offboarding.
3. **Health gates**: `nats-tenant-postgres-health.controller.ts` is referenced from the `connector-admin` `/readyz` gate. The migration must add a Mongo equivalent **before** flipping readiness, or the api-pod will go 503.
4. **The `internal-sync` durable** in `connector-admin` is at-least-once with `term`-on-poison classes. Mongo upserts with `{w:"majority"}` give the same idempotency, but the retry-classification metric labels (`ack_timeout`, `broker_unavailable`, `ensure_stream_failed`, `cross_tenant_attempt`) must be preserved verbatim — they're referenced in dashboards (`.sdd/changes/adapter-internal-sync-durable/specs/`).
5. **Schema-drift detection**: today `ensureSchema(tenantId)` runs `CREATE TABLE IF NOT EXISTS` lazily. Mongo's equivalent is `createIndexes` with `ensureOnly` semantics — make sure new indexes are added by code, not by ops, so they replay on every tenant.

---

## 8. Sources cited

- `packages/database/src/tenant-connection-manager.ts`
- `packages/database/src/tenant-deletion-eviction-listener.ts`
- `packages/shared/src/adapter-schema.ts`
- `packages/shared/src/channel-schema.ts`
- `packages/shared/src/workflow-schema.ts`
- `packages/shared/src/channel-usage-schema.ts`
- `packages/shared/src/tenant-auth-schema.ts`
- `services/audit-service/src/modules/audit/audit.repository.ts:42-69`
- `services/audit-service/src/modules/gateway-audit/gateway-audit.service.ts:232-291`
- `services/connector-admin/src/modules/adapters/adapters.repository.ts:251-304`
- `services/registry-service/src/providers/postgres.provider.ts:7-49`
- `services/tenant-service/src/providers/platform-postgres.provider.ts:18-61`
- `services/tenant-service/src/providers/postgres.provider.ts:66-88`
- `services/usage-aggregator-service/src/.../batch-inserter.ts:51-71`
- `services/workflow-service/src/modules/.../executions.repository.ts:53-62`
- `services/yoizenclaw-admin-service/src/providers/yoizenclaw-schema-initializer.ts`
- `services/yoizenclaw-runtime/alembic/versions/001_initial_schema.py:82-93`
- `services/yoizenclaw-runtime/.../scheduler_leader.py:29-49`

---

### Bottom line

Only **three services** should move: `connector-admin`, the append-only part of `audit-service`, and `yoizenclaw-admin-service`. Everything else is either riding on Postgres extensions that have no Mongo equivalent (TimescaleDB, pgvector, advisory locks) or depends on relational invariants (FKs, JOINs, CHECK constraints) that you'd just end up re-implementing in application code if you migrated. The one-time platform tax (~1.5–3 weeks) is real; account for it before you commit to any of the three migrations.
