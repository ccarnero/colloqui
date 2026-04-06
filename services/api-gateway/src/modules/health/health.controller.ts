import { Controller, Get } from "@nestjs/common";
import type { IApiGatewayHealthResponse } from "@yoizen/shared";
import { Public } from "../../decorators/public.decorator";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { GatewayHealthService } from "./gateway-health.service";

@Controller()
export class HealthController {
  constructor(private readonly gatewayHealth: GatewayHealthService) {}

  @Public()
  @SkipTenant()
  @Get("health")
  async check(): Promise<IApiGatewayHealthResponse> {
    return this.gatewayHealth.check();
  }
}
