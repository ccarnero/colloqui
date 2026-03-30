import { Controller, Get, Req } from "@nestjs/common";
import { DashboardProxyService } from "./dashboard-proxy.service";
import { REQUEST_TENANT_KEY } from "../../guards/tenant.guard";
import type { DashboardStats } from "@yoizen/shared";

@Controller("dashboard")
export class DashboardController {
  constructor(
    private readonly dashboardProxy: DashboardProxyService,
  ) {}

  @Get("stats")
  async getStats(@Req() req: Record<string, unknown>): Promise<DashboardStats> {
    return this.dashboardProxy.getStats(
      req[REQUEST_TENANT_KEY] as string,
    );
  }
}
