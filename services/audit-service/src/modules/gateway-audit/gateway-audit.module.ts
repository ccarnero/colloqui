import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { auditServiceConfig } from "../../config";
import { GatewayAuditController } from "./gateway-audit.controller";
import { GatewayAuditMongoRepository } from "./gateway-audit.mongo.repository";
import { GatewayAuditPostgresRepository } from "./gateway-audit.postgres.repository";
import {
  GATEWAY_AUDIT_REPOSITORY,
  type IGatewayAuditRepository,
} from "./gateway-audit.repository.interface";
import { GatewayAuditService } from "./gateway-audit.service";

@Module({
  controllers: [GatewayAuditController],
  providers: [
    createRepositoryProvider<IGatewayAuditRepository>({
      token: GATEWAY_AUDIT_REPOSITORY,
      engine: auditServiceConfig.dbEngine,
      postgresClass: GatewayAuditPostgresRepository,
      mongoClass: GatewayAuditMongoRepository,
    }),
    GatewayAuditService,
  ],
  exports: [GatewayAuditService],
})
export class GatewayAuditModule {}
