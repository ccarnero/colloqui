import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "@yoizen/database";
import { TENANT_AUTH_SCHEMA_SQL } from "@yoizen/shared";


/**
 * Per-tenant Postgres for `tenant_roles`, `tenant_role_permissions`, `tenant_users`.
 */
@Injectable()
export class AuthTenantConnectionManagerPostgres extends TenantConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchema([TENANT_AUTH_SCHEMA_SQL]);
  }
}
