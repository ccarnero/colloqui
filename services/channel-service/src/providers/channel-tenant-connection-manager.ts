import { Injectable } from "@nestjs/common";

/**
 * DI token for the active per-tenant channel OLTP connection manager.
 * Concrete implementation is bound in {@link ChannelTenantDbModule} by storage engine.
 */
@Injectable()
export class ChannelTenantConnectionManager {}

export { ChannelTenantConnectionManagerPostgres } from "./channel-tenant-connection-manager.postgres";
export { ChannelTenantConnectionManagerMongo } from "./channel-tenant-connection-manager.mongo";
