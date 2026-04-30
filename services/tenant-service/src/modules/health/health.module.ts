import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";
import { TenantProvisionModule } from "../provisioning/tenant-provision.module";

@Module({
  imports: [TenantProvisionModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
