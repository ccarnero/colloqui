import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import type {
  TenantConnectionManager,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import type { IPlatformHealthResponse } from "@yoizen/shared";
import { agentAdminServiceConfig } from "../../config";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";

/**
 * Service health checks.
 * Base path: `/health`.
 */
@Controller()
export class HealthController {
  private readonly logger = new PinoLoggerService(HealthController.name);

  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    private readonly tenantManager:
      | TenantConnectionManager
      | TenantMongoConnectionManager,
  ) {}

  /**
   * Health check endpoint (`GET /health`).
   * No tenant header: used by Knative/Docker/Kubernetes before routing traffic.
   */
  @Get("health")
  async check(): Promise<IPlatformHealthResponse> {
    const timestamp = new Date().toISOString();
    const poolCount = this.tenantManager.getKnownTenantIds().length;
    this.logger.debug(
      `Health check (${agentAdminServiceConfig.dbEngine}): ${String(poolCount)} active connection pools`,
    );

    const dbOk = await this.tenantManager.probeFirstPool();

    const body: IPlatformHealthResponse = {
      status: dbOk ? "ok" : "error",
      timestamp,
      checks: {
        database: dbOk ? "up" : "down",
      },
    };

    if (!dbOk) {
      throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    }

    return body;
  }
}
