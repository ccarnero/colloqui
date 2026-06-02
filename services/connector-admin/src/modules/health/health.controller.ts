import { Inject, Controller, Get, HttpCode, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import type { NatsConnection } from "nats";
import {
  NATS_CONNECTION,
  getNatsTenantMongoHealthStatus,
  getNatsTenantPostgresHealthStatus,
  type TenantConnectionManager,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import { connectorAdminConfig } from "../../config";
import { AdapterTenantConnectionManager } from "../../providers/tenant-connection-manager";
import {
  HealthService,
  type ReadinessGate,
  type ServiceModeName,
} from "./health.service";

@Controller()
export class HealthController {
  constructor(
    @Inject(NATS_CONNECTION) private readonly nc: NatsConnection,
    @Inject(AdapterTenantConnectionManager)
    private readonly tenantConnections:
      | TenantConnectionManager
      | TenantMongoConnectionManager,
    private readonly health: HealthService,
  ) {}

  @Get("healthz")
  @HttpCode(200)
  liveness(): { status: "ok" } {
    return this.health.liveness();
  }

  @Get("readyz")
  async readiness(
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<{
    status: "ok" | "fail";
    mode: ServiceModeName;
    failed: readonly ReadinessGate[];
  }> {
    const result = await this.health.readiness();
    if (!result.ready) {
      reply.status(503);
    }
    return {
      status: result.status,
      mode: result.mode,
      failed: result.failed,
    };
  }

  @Get("health")
  async check(): Promise<{
    status: "ok" | "degraded";
    nats: boolean;
    mongo?: boolean;
    postgres?: boolean;
  }> {
    if (connectorAdminConfig.dbEngine === "mongo") {
      return getNatsTenantMongoHealthStatus({
        nc: this.nc,
        tenantConnections: this.tenantConnections,
      });
    }

    return getNatsTenantPostgresHealthStatus({
      nc: this.nc,
      tenantConnections: this.tenantConnections,
    });
  }
}
