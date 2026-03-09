import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditProxyService } from './audit.service';

@Module({
  controllers: [AuditController],
  providers: [AuditProxyService],
})
export class AuditModule {}
