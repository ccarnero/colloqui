import { Module } from "@nestjs/common";
import { AdaptersRepository } from "../adapters/adapters.repository";
import { InternalSyncService } from "./internal-sync.service";

/**
 * Consumes registry-service `service.{upserted,deleted}` events and
 * materializes them as `context=internal` adapters (mirrors) in each
 * tenant's own Postgres.
 *
 * NATS + per-tenant Postgres providers come from the global
 * `ProvidersModule`, so this module only wires the consumer itself.
 */
@Module({
  providers: [AdaptersRepository, InternalSyncService],
})
export class InternalSyncModule {}
