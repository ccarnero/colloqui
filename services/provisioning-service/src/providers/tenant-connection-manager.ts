import { Injectable } from "@nestjs/common";

/**
 * DI token class for provisioning-service's tenant-scoped Postgres
 * connection manager. Mirrors `agent-memory-service`'s
 * `AgentMemoryTenantConnectionManager` pattern: an empty subclass gives
 * Nest a stable, service-specific provide/inject token distinct from the
 * shared `@yoizen/database` `TenantConnectionManager` base class.
 */
@Injectable()
export class ProvisioningTenantConnectionManager {}
