import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { TenantConnectionManager } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import type { IYoizenClawHealthResponse } from "@yoizen/shared";

/**
 * Service health checks.
 * Base path: `/health`.
 *
 * Liveness: TenantConnectionManager is constructible; pool count is diagnostic only.
 */
@Controller()
export class HealthController {
  private readonly logger = new PinoLoggerService(HealthController.name);

  constructor(private readonly tenantManager: TenantConnectionManager) {}

  /**
   * Health check endpoint (`GET /health`).
   * No tenant header: used by Knative/Docker/Kubernetes before routing traffic.
   */
  @Get("health")
  async check(): Promise<IYoizenClawHealthResponse> {
    const timestamp = new Date().toISOString();
    const poolCount = this.tenantManager.getKnownTenantIds().length;
    this.logger.debug(`Health check: ${String(poolCount)} active connection pools`);

    const dbOk = await this.tenantManager.probeFirstPool();

    const body: IYoizenClawHealthResponse = {
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
