import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  getNatsTenantPostgresHealthStatus,
} from "@yoizen/database";
import { AdapterTenantConnectionManager } from "../../providers/tenant-connection-manager";

/**
 * Aggregates health for NATS (internal-sync ingestion) and the per-tenant
 * Postgres pools (adapter state). Mirrors the shared
 * `NatsTenantPostgresHealthController` pattern used by audit/metrics.
 *
 * `verifyConnectivity` probes the first hot pool — no tenant fan-out,
 * so this stays O(1) even with many tenants cached.
 */
@Controller()
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: AdapterTenantConnectionManager,
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
