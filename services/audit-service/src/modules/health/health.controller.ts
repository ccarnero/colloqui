import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import {
  TenantConnectionManager,
  getNatsTenantPostgresHealthStatus,
} from "@yoizen/database";

@Controller()
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  @Get("readyz")
  ready(): { status: "ok" } {
    return { status: "ok" };
  }

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
