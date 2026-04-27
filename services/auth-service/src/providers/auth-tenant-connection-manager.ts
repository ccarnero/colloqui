import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager as BaseTenantConnectionManager,
} from "@yoizen/database";
import { TENANT_AUTH_SCHEMA_SQL } from "@yoizen/shared";

export type { Sql } from "@yoizen/database";

/**
 * Per-tenant pool for `tenant_roles`, `tenant_role_permissions`, `tenant_users`.
 */
@Injectable()
export class AuthTenantConnectionManager extends BaseTenantConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchema([TENANT_AUTH_SCHEMA_SQL]);
  }
}
