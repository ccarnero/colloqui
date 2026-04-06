import { Controller, Get } from "@nestjs/common";
import { TenantConnectionManager } from "../../providers/tenant-connection-manager";

@Controller()
export class HealthController {
  constructor(private readonly tenantConnections: TenantConnectionManager) {}

  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    postgres: boolean;
  }> {
    const postgresOk = await this.tenantConnections.verifyConnectivity();
    return {
      status: postgresOk ? "ok" : "degraded",
      postgres: postgresOk,
    };
  }
}
