import { Module } from "@nestjs/common";
import { createRepositoryProvider } from "@yoizen/database";
import { auditServiceConfig } from "../../config";
import { ChannelAuditController } from "./channel-audit.controller";
import { ChannelAuditMongoRepository } from "./channel-audit.mongo.repository";
import { ChannelAuditPostgresRepository } from "./channel-audit.postgres.repository";
import {
  CHANNEL_AUDIT_REPOSITORY,
  type IChannelAuditRepository,
} from "./channel-audit.repository.interface";
import { ChannelAuditService } from "./channel-audit.service";

@Module({
  controllers: [ChannelAuditController],
  providers: [
    createRepositoryProvider<IChannelAuditRepository>({
      token: CHANNEL_AUDIT_REPOSITORY,
      engine: auditServiceConfig.dbEngine,
      postgresClass: ChannelAuditPostgresRepository,
      mongoClass: ChannelAuditMongoRepository,
    }),
    ChannelAuditService,
  ],
  exports: [ChannelAuditService],
})
export class ChannelAuditModule {}
