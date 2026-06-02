import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  TenantConnectionManager,
  TenantMongoConnectionManager,
  getNatsTenantMongoHealthStatus,
  getNatsTenantPostgresHealthStatus,
} from "@yoizen/database";
import { usageAggregatorServiceConfig } from "../../config";
import { UsageTenantConnectionManager } from "../../providers/tenant-connection-manager";

/** Aggregates health for NATS and per-tenant usage connection pools. */
@Controller()
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(UsageTenantConnectionManager)
    private readonly tenantConnections:
      | TenantConnectionManager
      | TenantMongoConnectionManager,
  ) {}

  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    nats: boolean;
    mongo?: boolean;
    postgres?: boolean;
  }> {
    if (usageAggregatorServiceConfig.dbEngine === "postgres") {
      const result = await getNatsTenantPostgresHealthStatus({
        nc: this.nc,
        tenantConnections: this.tenantConnections,
      });
      return result;
    }

    const result = await getNatsTenantMongoHealthStatus({
      nc: this.nc,
      tenantConnections: this.tenantConnections,
    });
    return result;
  }
}
