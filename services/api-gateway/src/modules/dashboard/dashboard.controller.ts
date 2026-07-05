import { Controller, Get, Req } from "@nestjs/common";
import { DashboardProxyService } from "./dashboard-proxy.service";
import type { DashboardStats } from "@yoizen/shared";
import type { ITenantScopedRequest } from "../../types/yoizen-request";
import { ApiTags } from "@nestjs/swagger";

@ApiTags("dashboard")
@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardProxy: DashboardProxyService) {}

  @Get("stats")
  async getStats(@Req() req: ITenantScopedRequest): Promise<DashboardStats> {
    return this.dashboardProxy.getStats(req.tenantId);
  }
}
