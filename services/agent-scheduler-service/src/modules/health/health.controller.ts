import { Controller, Get } from "@nestjs/common";
import { SchedulerTenantConnectionManager } from "../../providers/tenant-connection.manager";
import { PinoLoggerService } from "@yoizen/observability";

@Controller()
export class HealthController {
  private readonly logger = new PinoLoggerService(HealthController.name);

  constructor(
    private readonly tenantManager: SchedulerTenantConnectionManager,
  ) {}

  @Get("health")
  async check() {
    const timestamp = new Date().toISOString();
    const tenantCount = this.tenantManager.getKnownTenantIds().length;

    this.logger.debug(
      `Health check: ${tenantCount} active tenant connections`,
    );

    return {
      status: "ok",
      timestamp,
      checks: {
        database: tenantCount > 0 ? "up" : "idle",
      },
    };
  }
}
