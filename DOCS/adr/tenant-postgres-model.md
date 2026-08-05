---
status: accepted
date: 2026-06-12
decision-makers: Architect
consulted: ""
informed: ""
---

Class: RECORD
Summary: ADR (accepted 2026-06-12): the one-database-per-tenant isolation model — the database is the tenancy boundary, not a tenant_id column.

# ADR: Tenant Postgres Model

> Extracted verbatim from `DOCS/guides/onboarding.md` on 2026-07-30
> (`manual-loops/architecture/docs-consistency.md` T05). The record first
> entered the repo in commit `cbbdca6c` (2026-06-12), which is the `date`
> above.
>
> Related decision-log entries: no D-number covers the two-tier Postgres
> model directly. The closest cross-reference is the
> "Historical: Single-Tenant → Multi-Tenant Migration" section of
> `DOCS/architecture/decision-log.md`, whose data-isolation row describes the
> same shared-CNPG / dedicated-StatefulSet split.

**Decision**: Two-tier isolation model — `shared` tier uses a logical database on the shared CloudNativePG cluster (`postgres-shared`), accessed via an `ExternalName` Service in the tenant namespace; `dedicated` tier gets a per-tenant Postgres StatefulSet.

**Rationale**:
- `shared` tier: low operational overhead for most tenants; connection pooling via CNPG's built-in pooler
- `dedicated` tier: full physical isolation for tenants that require it (compliance, scaling, custom extensions)
- In both cases each tenant sees a `postgres` ExternalName or direct Service in their own namespace — application code is identical

**Tradeoff**: Dedicated-tier tenants add a StatefulSet per tenant; shared-tier tenants have logical (not physical) isolation

**Mitigation**: Connection management via `TenantConnectionManager`; provisioning orchestrated by `tenant-service`

---

## Where this is implemented

Pointers only; the decision text above is unchanged.

- Tier enum and default: `TenantDatabaseTier` (`Shared` / `Dedicated`) in
  `packages/shared/src/tenant-database-tier.ts`; the platform `tenants` table's
  `tier` column is declared `NOT NULL DEFAULT '${TenantDatabaseTier.Shared}'`
  with a matching CHECK constraint in
  `services/tenant-service/src/providers/platform-postgres.provider.ts`.
- Both tiers are implemented in `PostgresProvider` (`postgres.provider.ts`):
  `provisionShared` does `CREATE ROLE`/`CREATE DATABASE` on the CNPG cluster and
  then `createSharedExternalNameService`, while the dedicated branch calls
  `createNamespacedStatefulSet` — matching the decision as recorded.
- Provisioning: `services/tenant-service/src/modules/provisioning/tenant-provisioning-executor.service.ts`.
- Connection management: `TenantConnectionManager` and `SharedTenantDatabaseMode` in `packages/database/src/tenant-connection-manager.ts` — see `packages/database/README.md`.
