import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import {
  getNatsTenantMongoHealthStatus,
  getNatsTenantPostgresHealthStatus,
  type ITenantMongoConnectivity,
  type ITenantPostgresConnectivity,
} from "@yoizen/database";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { auditServiceConfig } from "../../config";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";

@Controller()
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: AuditTenantConnectionManager,
  ) {}

  @Get("readyz")
  ready(): { status: "ok" } {
    return { status: "ok" };
  }

  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    nats: boolean;
    mongo?: boolean;
    postgres?: boolean;
  }> {
    if (auditServiceConfig.dbEngine === "mongo") {
      const result = await getNatsTenantMongoHealthStatus({
        nc: this.nc,
        tenantConnections: this
          .tenantConnections as unknown as ITenantMongoConnectivity,
      });
      return result;
    }

    const result = await getNatsTenantPostgresHealthStatus({
      nc: this.nc,
      tenantConnections: this
        .tenantConnections as unknown as ITenantPostgresConnectivity,
    });
    return result;
  }
}
