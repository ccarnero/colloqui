import { Injectable } from "@nestjs/common";

/**
 * DI token for the active per-tenant connection manager (Postgres or Mongo).
 * Concrete implementation is bound in {@link ProvidersModule} by storage engine.
 */
@Injectable()
export class AuditTenantConnectionManager {}
