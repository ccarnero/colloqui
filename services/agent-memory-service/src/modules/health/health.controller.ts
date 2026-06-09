import { Controller, Get, HttpException, HttpStatus, Inject } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { AgentMemoryTenantConnectionManager } from "../../providers/tenant-connection-manager";

@Controller()
export class HealthController {
  private readonly logger = new PinoLoggerService(HealthController.name);

  constructor(
    @Inject(AgentMemoryTenantConnectionManager)
    private readonly tenantManager: TenantConnectionManager,
  ) {}

  @Get("health")
  async check() {
    const timestamp = new Date().toISOString();
    const poolCount = this.tenantManager.getKnownTenantIds().length;
    this.logger.debug(
      `Health check: ${String(poolCount)} active connection pools`,
    );

    const dbOk = await this.tenantManager.probeFirstPool();

    const body = {
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
