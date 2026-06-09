import { Controller, Get } from "@nestjs/common";
import { Public } from "../../decorators/public.decorator";
import { SkipTenant } from "../../decorators/skip-tenant.decorator";
import { RuntimeProxyService } from "./runtime-proxy.service";

@Controller("runtime")
export class RuntimeHealthController {
  constructor(private readonly proxy: RuntimeProxyService) {}

  @Public()
  @SkipTenant()
  @Get("health")
  async checkHealth(): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: "/health",
      tenantId: "system",
    });
  }
}
