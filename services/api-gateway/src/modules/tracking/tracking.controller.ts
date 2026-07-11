import { Controller, Get, Param, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { TrackingProxyService } from "./tracking-proxy.service";

@ApiTags("tracking")
@Controller("tracking")
export class TrackingController {
  constructor(private readonly proxy: TrackingProxyService) {}

  @Get("chains/:correlationId")
  async getChain(
    @Req() req: ITenantScopedRequest,
    @Param("correlationId") correlationId: string
  ): Promise<object> {
    return this.proxy.proxy({
      method: "GET",
      path: `/chains/${encodeURIComponent(correlationId)}`,
      tenantId: req[REQUEST_TENANT_KEY],
    });
  }
}
