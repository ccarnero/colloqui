import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  getNatsTenantPostgresHealthStatus,
} from "@yoizen/database";
import { UsageTenantConnectionManager } from "../../providers/tenant-connection-manager";

/**
 * Aggregates health for NATS (stream consumer) and the per-tenant
 * TimescaleDB pools (usage writes). Re-uses the shared helper so
 * probes stay O(1) regardless of tenant cardinality.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: UsageTenantConnectionManager,
  ) {}

  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    nats: boolean;
    postgres: boolean;
  }> {
    return getNatsTenantPostgresHealthStatus({
      nc: this.nc,
      tenantConnections: this.tenantConnections,
    });
  }
}
