import { Injectable } from "@nestjs/common";
import { TenantMongoConnectionManager } from "@yoizen/database";
import { WORKFLOW_MONGO_SCHEMA } from "@yoizen/shared";


/** Per-tenant Mongo for workflow definitions and executions. */
@Injectable()
export class WorkflowTenantConnectionManagerMongo extends TenantMongoConnectionManager {
  constructor() {
    super();
    this.setSchema(WORKFLOW_MONGO_SCHEMA);
  }
}
