import { Module } from "@nestjs/common";
import { ManifestsModule } from "../manifests/manifests.module";
import { PLATFORM_RESOURCE_CLIENTS } from "./domain/platform-resource-client.interface";
import { buildPlatformResourceClients } from "./infrastructure/platform-resource-clients.provider";
import { PlanController } from "./plan.controller";
import { PlanService } from "./plan.service";

@Module({
  imports: [ManifestsModule],
  providers: [
    PlanService,
    {
      provide: PLATFORM_RESOURCE_CLIENTS,
      useFactory: buildPlatformResourceClients,
    },
  ],
  controllers: [PlanController],
  exports: [PlanService],
})
export class PlanModule {}
