import { Module } from "@nestjs/common";
import { AdaptersModule } from "../adapters/adapters.module";
import { InternalSyncService } from "./internal-sync.service";

/**
 * Consumes registry-service `service.{upserted,deleted}.v1` events and
 * materializes them as `context=internal` adapters (mirrors) in each
 * tenant's own database.
 */
@Module({
  imports: [AdaptersModule],
  providers: [InternalSyncService],
  exports: [InternalSyncService],
})
export class InternalSyncModule {}
