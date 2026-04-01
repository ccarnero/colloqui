import { Controller, Get, Inject } from "@nestjs/common";
import type { NatsConnection } from "nats";
import { checkNats } from "@yoizen/database";
import { NATS_CONNECTION } from "../../providers/nats.provider";
import { TenantConnectionManager } from "../../providers/tenant-connection-manager";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    private readonly tenantConnections: TenantConnectionManager,
  ) {}

  @Get()
  async check(): Promise<{
    status: "ok" | "degraded";
    nats: boolean;
    postgres: boolean;
  }> {
    const [natsOk, postgresOk] = await Promise.all([
      Promise.resolve(checkNats(this.nc)),
      this.tenantConnections.verifyConnectivity(),
    ]);
    return {
      status: natsOk && postgresOk ? "ok" : "degraded",
      nats: natsOk,
      postgres: postgresOk,
    };
  }
}
