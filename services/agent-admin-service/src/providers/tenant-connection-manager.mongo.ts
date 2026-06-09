import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { PLATFORM_ADMIN_MONGO_SCHEMA } from "@yoizen/shared";


/** Per-tenant Mongo for YoizenClaw admin entities. */
@Injectable()
export class YoizenclawTenantConnectionManagerMongo extends TenantMongoConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchema(PLATFORM_ADMIN_MONGO_SCHEMA);
  }
}
