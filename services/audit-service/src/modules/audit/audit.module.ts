import { Module } from "@nestjs/common";
import { AuditController } from "./audit.controller";
import { AuditRepository } from "./audit.repository";
import { AuditService } from "./audit.service";

@Module({
  controllers: [AuditController],
  providers: [AuditRepository, AuditService],
  exports: [AuditService],
})
export class AuditModule {}
