import { Global, Module } from "@nestjs/common";
import {
  TenantConnectionManager,
  TenantDeletionEvictionListener,
} from "@yoizen/database";
import { AdapterTenantConnectionManager } from "./tenant-connection-manager";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "./nats.provider";

/**
 * Global provider module for adapter-service. Exposes:
 *  - `AdapterTenantConnectionManager` — per-tenant Postgres pools for
 *    `AdaptersRepository` and internal-sync writes.
 *  - `NATS_CONNECTION` / `JETSTREAM` — shared by the internal-sync consumer
 *    and the NATS+Postgres aggregate health probe.
 *  - `TenantDeletionEvictionListener` — closes/removes the cached pool
 *    on `platform.tenant.deleted` so `/readyz` doesn't get pinned to
 *    503 by a stale pool after a tenant is destroyed (the failure mode
 *    diagnosed against `tenant_acme` cleanup on 2026-04-28).
 *
 * The eviction listener is aliased onto the base
 * {@link TenantConnectionManager} provider token so it operates on the
 * same instance the rest of the service injects (subclass identity is
 * preserved).
 *
 * Consolidating these here keeps every module that needs them (adapters,
 * internal-sync, health) a single import away with zero duplication.
 */
@Global()
@Module({
  providers: [
    AdapterTenantConnectionManager,
    {
      provide: TenantConnectionManager,
      useExisting: AdapterTenantConnectionManager,
    },
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    TenantDeletionEvictionListener,
  ],
  exports: [
    AdapterTenantConnectionManager,
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM,
  ],
})
export class ProvidersModule {}
