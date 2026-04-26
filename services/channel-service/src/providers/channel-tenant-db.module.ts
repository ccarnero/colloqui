import { Global, Module } from "@nestjs/common";
import { ChannelTenantConnectionManager } from "./channel-tenant-connection-manager";

@Global()
@Module({
  providers: [ChannelTenantConnectionManager],
  exports: [ChannelTenantConnectionManager],
})
export class ChannelTenantDbModule {}
