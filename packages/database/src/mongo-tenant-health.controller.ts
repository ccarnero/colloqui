import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import { NATS_CONNECTION } from "./nats-provider";
import { TenantMongoConnectionManager } from "./tenant-mongo-connection-manager";
import { getNatsTenantMongoHealthStatus } from "./nats-tenant-mongo-health";

/**
 * Shared GET /health for services that use NATS + per-tenant Mongo clients.
 */
@Controller()
export class NatsTenantMongoHealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: TenantMongoConnectionManager,
  ) {}

  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    nats: boolean;
    mongo: boolean;
  }> {
    return getNatsTenantMongoHealthStatus({
      nc: this.nc,
      tenantConnections: this.tenantConnections,
    });
  }
}
