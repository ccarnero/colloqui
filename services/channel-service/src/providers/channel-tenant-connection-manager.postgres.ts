import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager as BaseTenantConnectionManager,
} from "@yoizen/database";
import {
  AUTO_REPLY_SCHEMA_SQL,
  CHANNEL_ACCOUNTS_SCHEMA_SQL,
} from "@yoizen/shared";


/**
 * Per-tenant OLTP pool for `channel_accounts` and `auto_reply_rules`.
 */
@Injectable()
export class ChannelTenantConnectionManagerPostgres extends BaseTenantConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchema([CHANNEL_ACCOUNTS_SCHEMA_SQL, AUTO_REPLY_SCHEMA_SQL]);
  }
}
