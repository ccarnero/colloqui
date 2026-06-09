import { Injectable } from "@nestjs/common";
import { TenantMongoConnectionManager } from "@yoizen/database";
import { ADAPTER_MONGO_SCHEMA } from "@yoizen/shared";


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
