import { Module } from "@nestjs/common";
import {
  jetStreamManagerProvider,
  jetStreamProvider,
  natsProvider,
} from "../../providers/nats.provider";
import { ManifestsModule } from "../manifests/manifests.module";
import { PlanModule } from "../plan/plan.module";
import { SecretsModule } from "../secrets/secrets.module";
import { ApplyController } from "./apply.controller";
import { ApplyService } from "./apply.service";
import { APPLY_EVENT_PUBLISHER } from "./domain/apply-event-publisher.interface";
import { PLATFORM_RESOURCE_WRITERS } from "./domain/platform-resource-writer.interface";
import type { ISecretValueResolver } from "./domain/secret-value-resolver.interface";
import { ApplyEventsPublisher } from "./infrastructure/apply-events.publisher";
import { BrokerSecretResolver } from "./infrastructure/broker-secret-resolver";
import { buildPlatformResourceWriters } from "./infrastructure/platform-resource-writers.provider";

@Module({
  imports: [ManifestsModule, PlanModule, SecretsModule],
  providers: [
    ApplyService,
    natsProvider,
    jetStreamManagerProvider,
    jetStreamProvider,
    ApplyEventsPublisher,
    { provide: APPLY_EVENT_PUBLISHER, useExisting: ApplyEventsPublisher },
    BrokerSecretResolver,
    {
      provide: PLATFORM_RESOURCE_WRITERS,
      useFactory: (resolver: ISecretValueResolver) =>
        buildPlatformResourceWriters(resolver),
      inject: [BrokerSecretResolver],
    },
  ],
  controllers: [ApplyController],
  exports: [ApplyService],
})
export class ApplyModule {}
