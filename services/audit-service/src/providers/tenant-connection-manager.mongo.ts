import { Injectable } from "@nestjs/common";
import { TenantMongoConnectionManager } from "@yoizen/database";


/** Per-tenant Mongo for audit events, gateway audit, and channel audit. */
@Injectable()
export class AuditTenantConnectionManagerMongo extends TenantMongoConnectionManager {}
