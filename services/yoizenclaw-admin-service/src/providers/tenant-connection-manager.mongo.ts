import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { YOIZENCLAW_ADMIN_MONGO_SCHEMA } from "@yoizen/shared";

export type { Db } from "mongodb";

/** Per-tenant Mongo for YoizenClaw admin entities. */
@Injectable()
export class YoizenclawTenantConnectionManagerMongo extends TenantMongoConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchema(YOIZENCLAW_ADMIN_MONGO_SCHEMA);
  }
}
