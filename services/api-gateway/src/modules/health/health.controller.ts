import { Controller, Get } from "@nestjs/common";
import type { IApiGatewayHealthResponse } from "@yoizen/shared";
import { Public } from "../../decorators/public.decorator";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { GatewayHealthService } from "./gateway-health.service";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("health")
@Controller()
export class HealthController {
  constructor(private readonly gatewayHealth: GatewayHealthService) {}

  @Public()
  @SkipTenant()
  @Get("readyz")
  ready(): { status: "ok" } {
    return { status: "ok" };
  }

  @Public()
  @SkipTenant()
  @Get("health")
  async check(): Promise<IApiGatewayHealthResponse> {
    return this.gatewayHealth.check();
  }
}
