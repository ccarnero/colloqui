import { Module } from "@nestjs/common";
import { GatewayAuditController } from "./gateway-audit.controller";
import { GatewayAuditService } from "./gateway-audit.service";

@Module({
  controllers: [GatewayAuditController],
  providers: [GatewayAuditService],
  exports: [GatewayAuditService],
})
export class GatewayAuditModule {}
