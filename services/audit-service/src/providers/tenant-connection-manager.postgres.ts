import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "@yoizen/database";

export type { Sql } from "@yoizen/database";

/** Per-tenant Postgres for audit events, gateway audit, and channel audit. */
@Injectable()
export class AuditTenantConnectionManagerPostgres extends TenantConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
  }
}
