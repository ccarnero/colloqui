import { Module } from "@nestjs/common";
import { ChannelAuditController } from "./channel-audit.controller";
import { ChannelAuditService } from "./channel-audit.service";

@Module({
  controllers: [ChannelAuditController],
  providers: [ChannelAuditService],
  exports: [ChannelAuditService],
})
export class ChannelAuditModule {}
