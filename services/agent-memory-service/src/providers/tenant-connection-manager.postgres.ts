import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "@yoizen/database";
import { initAgentMemoryTenantSchema } from "./schema-initializer";


@Injectable()
export class AgentMemoryTenantConnectionManagerPostgres extends TenantConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchemaInitializer(initAgentMemoryTenantSchema);
  }
}
