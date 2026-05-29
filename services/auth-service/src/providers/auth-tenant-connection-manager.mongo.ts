import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { TENANT_AUTH_MONGO_SCHEMA } from "@yoizen/shared";

/**
 * Per-tenant MongoDB for `tenant_roles`, `tenant_role_permissions`, `tenant_users`.
 */
@Injectable()
export class AuthTenantConnectionManagerMongo extends TenantMongoConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchema(TENANT_AUTH_MONGO_SCHEMA);
  }
}
