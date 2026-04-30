import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { GatewayHealthService } from "./gateway-health.service";

@Module({
  controllers: [HealthController],
  providers: [GatewayHealthService],
})
export class HealthModule {}
