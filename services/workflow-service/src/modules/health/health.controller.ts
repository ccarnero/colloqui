import { Controller, Get, Inject } from "@nestjs/common";
import type { Client } from "@temporalio/client";
import { PinoLoggerService } from "@yoizen/observability";
import { TEMPORAL_CLIENT } from "../../providers/temporal.provider";

@Controller()
export class HealthController {
  private readonly logger = new PinoLoggerService(HealthController.name);

  constructor(
    @Inject(TEMPORAL_CLIENT) private readonly temporal: Client,
  ) {}

  @Get("health")
  async check(): Promise<{ status: string; temporal: boolean }> {
    let temporalOk = false;
    try {
      await this.temporal.workflowService.getSystemInfo({});
      temporalOk = true;
    } catch (err) {
      temporalOk = false;
      this.logger.warn(
        "Temporal health check failed",
        err instanceof Error ? err.message : String(err),
      );
    }
    const status = temporalOk ? "ok" : "degraded";
    return { status, temporal: temporalOk };
  }
}
