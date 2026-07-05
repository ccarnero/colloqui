import { Controller, Get, Req } from "@nestjs/common";
import { RuntimeProxyService } from "../runtime/runtime-proxy.service";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { ApiTags } from "@nestjs/swagger";

/**
 * Proxies built-in tool discovery from the agent-ai-service
 * (via ai-agent-gateway) to the admin console frontend.
 */
@ApiTags("tools")
@Controller("admin/tools")
export class AdminToolsController {
  constructor(private readonly runtimeProxy: RuntimeProxyService) {}

  @Get("builtins")
  async listBuiltinTools(
    @Req() req: ITenantScopedRequest,
  ): Promise<object> {
    return this.runtimeProxy.proxy({
      method: "GET",
      path: "/tools/builtins",
      tenantId: req.tenantId,
    });
  }
}
