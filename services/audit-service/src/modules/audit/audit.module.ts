import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { auditServiceConfig } from "../../config";
import { AuditController } from "./audit.controller";
import { AuditMongoRepository } from "./audit.mongo.repository";
import { AuditPostgresRepository } from "./audit.postgres.repository";
import {
  AUDIT_REPOSITORY,
  type IAuditRepository,
} from "./audit.repository.interface";
import { AuditService } from "./audit.service";

@Module({
  controllers: [AuditController],
  providers: [
    createRepositoryProvider<IAuditRepository>({
      token: AUDIT_REPOSITORY,
      engine: auditServiceConfig.dbEngine,
      postgresClass: AuditPostgresRepository,
      mongoClass: AuditMongoRepository,
    }),
    AuditService,
  ],
  exports: [AuditService],
})
export class AuditModule {}
