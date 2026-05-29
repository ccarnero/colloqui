import { Global, Module } from "@nestjs/common";
import { channelServiceConfig } from "../config";
import { ChannelTenantConnectionManager } from "./channel-tenant-connection-manager";
import { ChannelTenantConnectionManagerMongo } from "./channel-tenant-connection-manager.mongo";
import { ChannelTenantConnectionManagerPostgres } from "./channel-tenant-connection-manager.postgres";

const engine = channelServiceConfig.dbEngine;
const managerClass =
  engine === "postgres"
    ? ChannelTenantConnectionManagerPostgres
    : ChannelTenantConnectionManagerMongo;

@Global()
@Module({
  providers: [
    {
      provide: ChannelTenantConnectionManager,
      useClass: managerClass,
    },
  ],
  exports: [ChannelTenantConnectionManager],
})
export class ChannelTenantDbModule {}
