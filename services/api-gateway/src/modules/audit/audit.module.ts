import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { ChannelAuditProxyController } from './channel-audit.controller';
import { AuditProxyService } from './audit.service';

@Module({
  controllers: [AuditController, ChannelAuditProxyController],
  providers: [AuditProxyService],
})
export class AuditModule {}
