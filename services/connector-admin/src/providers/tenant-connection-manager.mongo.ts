import { Injectable } from "@nestjs/common";
import { TenantMongoConnectionManager } from "@yoizen/database";
import { ADAPTER_MONGO_SCHEMA } from "@yoizen/shared";

export type { Db } from "mongodb";

/**
 * Per-tenant Mongo connection manager for connector-admin.
 */
@Injectable()
export class AdapterTenantConnectionManagerMongo extends TenantMongoConnectionManager {
  constructor() {
    super();
    this.setSchema(ADAPTER_MONGO_SCHEMA);
  }
}
