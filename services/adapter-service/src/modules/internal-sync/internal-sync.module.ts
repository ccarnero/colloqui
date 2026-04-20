import { Module } from "@nestjs/common";
import {
  JETSTREAM,
  JETSTREAM_MANAGER,
  NATS_CONNECTION,
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "../../providers/nats.provider";
import { AdaptersRepository } from "../adapters/adapters.repository";
import { InternalSyncService } from "./internal-sync.service";

/**
 * Consumes registry-service `service.{upserted,deleted}` events and
 * materializes them as `context=internal` adapters (mirrors). NATS
 * provider is local to this module so the rest of the service stays
 * HTTP-only.
 */
@Module({
  providers: [
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    AdaptersRepository,
    InternalSyncService,
  ],
  exports: [NATS_CONNECTION, JETSTREAM_MANAGER, JETSTREAM],
})
export class InternalSyncModule {}
