import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "@yoizen/database";
import { initAgentAdminTenantSchema } from "./schema-initializer";


/** Per-tenant Postgres for YoizenClaw admin entities. */
@Injectable()
export class YoizenclawTenantConnectionManagerPostgres extends TenantConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchemaInitializer(initAgentAdminTenantSchema);
  }
}
