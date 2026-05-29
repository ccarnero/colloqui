import { Injectable } from "@nestjs/common";

/**
 * DI token for the active per-tenant usage connection manager.
 * Concrete implementation is bound in {@link UsageModule} by storage engine.
 */
@Injectable()
export class UsageTenantConnectionManager {}

export { UsageTenantConnectionManagerPostgres } from "./tenant-connection-manager.postgres";
export { UsageTenantConnectionManagerMongo } from "./tenant-connection-manager.mongo";
