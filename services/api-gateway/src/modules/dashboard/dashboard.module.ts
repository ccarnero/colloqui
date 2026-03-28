import { Module } from "@nestjs/common";
import { DashboardController } from "./dashboard.controller";
import { DashboardProxyService } from "./dashboard-proxy.service";

@Module({
  controllers: [DashboardController],
  providers: [DashboardProxyService],
})
export class DashboardModule {}
