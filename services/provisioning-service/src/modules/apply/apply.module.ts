import { Module } from "@nestjs/common";
import {
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "../../providers/nats.provider";
import { ManifestsModule } from "../manifests/manifests.module";
import { PlanModule } from "../plan/plan.module";
import { ApplyController } from "./apply.controller";
import { ApplyService } from "./apply.service";
import { APPLY_EVENT_PUBLISHER } from "./domain/apply-event-publisher.interface";
import { PLATFORM_RESOURCE_WRITERS } from "./domain/platform-resource-writer.interface";
import { ApplyEventsPublisher } from "./infrastructure/apply-events.publisher";
import { buildPlatformResourceWriters } from "./infrastructure/platform-resource-writers.provider";

@Module({
  imports: [ManifestsModule, PlanModule],
  providers: [
    ApplyService,
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    ApplyEventsPublisher,
    { provide: APPLY_EVENT_PUBLISHER, useExisting: ApplyEventsPublisher },
    {
      provide: PLATFORM_RESOURCE_WRITERS,
      useFactory: buildPlatformResourceWriters,
    },
  ],
  controllers: [ApplyController],
  exports: [ApplyService],
})
export class ApplyModule {}
