import { Module } from "@nestjs/common";
import { AdaptersRepository } from "../adapters/adapters.repository";
import { InternalSyncService } from "./internal-sync.service";

/**
 * Consumes registry-service `service.{upserted,deleted}.v1` events and
 * materializes them as `context=internal` adapters (mirrors) in each
 * tenant's own Postgres.
 *
 * The module is loaded into `AppModule` regardless of `SERVICE_MODE`:
 *   - in `worker` mode the durable consumer pulls and acks messages,
 *   - in `api` mode the durable is registered in `ensureOnly` mode so
 *     `jetstream_consumer_num_pending` series exist before KEDA scales
 *     the worker from 0 (cold-start chicken-and-egg fix).
 *
 * `JETSTREAM_MANAGER` and `JETSTREAM` come from the global
 * `ProvidersModule` via `nats.provider.ts`, so this module only wires
 * the consumer service itself and the repository handle.
 */
@Module({
  providers: [AdaptersRepository, InternalSyncService],
  exports: [InternalSyncService],
})
export class InternalSyncModule {}
