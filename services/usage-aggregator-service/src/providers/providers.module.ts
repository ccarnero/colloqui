import { Global, Module } from "@nestjs/common";
import {
  TenantConnectionManager,
  TenantDeletionEvictionListener,
} from "@yoizen/database";
import { UsageTenantConnectionManager } from "./tenant-connection-manager";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "./nats.provider";

/**
 * Global provider module for usage-aggregator-service. Exposes:
 *  - `UsageTenantConnectionManager` — per-tenant TimescaleDB pools
 *    (pointing at the `postgres-usage` service in each namespace).
 *  - `NATS_CONNECTION` / `JETSTREAM_MANAGER` / `JETSTREAM` — shared
 *    connection re-used by the aggregator engine + health probe.
 *  - `TenantDeletionEvictionListener` — closes/removes the cached pool
 *    on `platform.tenant.deleted` so a destroyed tenant doesn't pin a
 *    stale `postgres-usage` connection.
 *
 * The base-class alias is required because the listener (in
 * `@yoizen/database`) depends on the base `TenantConnectionManager`
 * token; the alias keeps subclass identity while letting the listener
 * resolve the concrete pool cache.
 */
@Global()
@Module({
  providers: [
    UsageTenantConnectionManager,
    {
      provide: TenantConnectionManager,
      useExisting: UsageTenantConnectionManager,
    },
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    TenantDeletionEvictionListener,
  ],
  exports: [
    UsageTenantConnectionManager,
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM,
  ],
})
export class ProvidersModule {}
