import { Controller, Get } from "@nestjs/common";
import { HealthService } from "./health.service";
import type { ITenantHealthResponse } from "@yoizen/shared";

@Controller()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get("health")
  async check(): Promise<ITenantHealthResponse> {
    return this.healthService.getStatus();
  }
}
