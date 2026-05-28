import { Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  TenantConnectionManager,
} from "@yoizen/database";
import { initYoizenClawTenantSchema } from "./yoizenclaw-schema-initializer";

export type { Sql } from "@yoizen/database";

/** Per-tenant Postgres for YoizenClaw admin entities. */
@Injectable()
export class YoizenclawTenantConnectionManagerPostgres extends TenantConnectionManager {
  constructor() {
    super();
    this.configure({
      sharedDatabaseMode: SharedTenantDatabaseMode.PerTenantDatabase,
    });
    this.setSchemaInitializer(initYoizenClawTenantSchema);
  }
}
