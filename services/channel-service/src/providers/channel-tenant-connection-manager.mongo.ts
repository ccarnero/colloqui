import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { CHANNEL_MONGO_SCHEMA } from "@yoizen/shared";

export type { Db } from "mongodb";

/**
 * Per-tenant MongoDB for `channel_accounts` and `auto_reply_rules`.
 */
@Injectable()
export class ChannelTenantConnectionManagerMongo extends TenantMongoConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchema(CHANNEL_MONGO_SCHEMA);
  }
}
