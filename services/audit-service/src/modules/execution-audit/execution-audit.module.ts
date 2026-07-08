import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { auditServiceConfig } from "../../config";
import { ExecutionAuditController } from "./execution-audit.controller";
import { ExecutionAuditMongoRepository } from "./execution-audit.mongo.repository";
import { ExecutionAuditPostgresRepository } from "./execution-audit.postgres.repository";
import {
  EXECUTION_AUDIT_REPOSITORY,
  type IExecutionAuditRepository,
} from "./execution-audit.repository.interface";
import { ExecutionAuditService } from "./execution-audit.service";

@Module({
  controllers: [ExecutionAuditController],
  providers: [
    createRepositoryProvider<IExecutionAuditRepository>({
      token: EXECUTION_AUDIT_REPOSITORY,
      engine: auditServiceConfig.dbEngine,
      postgresClass: ExecutionAuditPostgresRepository,
      mongoClass: ExecutionAuditMongoRepository,
    }),
    ExecutionAuditService,
  ],
  exports: [ExecutionAuditService],
})
export class ExecutionAuditModule {}
