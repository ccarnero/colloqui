import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { PLATFORM_ADMIN_MONGO_SCHEMA } from "@yoizen/shared";


@Injectable()
export class AgentAiTenantConnectionManagerMongo extends TenantMongoConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchema(PLATFORM_ADMIN_MONGO_SCHEMA);
  }
}
