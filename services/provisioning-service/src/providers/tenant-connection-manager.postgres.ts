import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "@yoizen/database";
import { initProvisioningTenantSchema } from "./schema-initializer";

@Injectable()
export class ProvisioningTenantConnectionManagerPostgres extends TenantConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchemaInitializer(initProvisioningTenantSchema);
  }
}
