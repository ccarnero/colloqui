import { Module } from "@nestjs/common";
import { UsageController } from "./usage.controller";
import { UsageService } from "./usage.service";
import { UsageRepository } from "./usage.repository";
import { UsageTenantConnectionManager } from "./tenant-connection-manager";

@Module({
  controllers: [UsageController],
  providers: [UsageService, UsageRepository, UsageTenantConnectionManager],
  exports: [UsageTenantConnectionManager],
})
export class UsageModule {}
