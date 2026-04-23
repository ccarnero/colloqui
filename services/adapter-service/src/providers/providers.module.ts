import { Global, Module } from "@nestjs/common";
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
 *
 * Consolidating these here keeps every module that needs them (adapters,
 * internal-sync, health) a single import away with zero duplication.
 */
@Global()
@Module({
  providers: [
    AdapterTenantConnectionManager,
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
  ],
  exports: [
    AdapterTenantConnectionManager,
    NATS_CONNECTION,
    JETSTREAM_MANAGER,
    JETSTREAM,
  ],
})
export class ProvidersModule {}
