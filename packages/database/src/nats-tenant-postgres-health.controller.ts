import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import { NATS_CONNECTION } from "./nats-provider";
import { TenantConnectionManager } from "./tenant-connection-manager";
import { getNatsTenantPostgresHealthStatus } from "./nats-tenant-postgres-health";

/**
 * Shared GET /health for services that use NATS + per-tenant Postgres pools.
 */
@Controller()
export class NatsTenantPostgresHealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: TenantConnectionManager,
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
