import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminService } from "./admin.service";
import { AdminApiKeyGuard } from "./admin-api-key.guard";

@Controller("admin")
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("jobs")
  getJobs() {
    return this.adminService.getActiveJobs();
  }

  @Get("executions")
  getExecutions(@Query("limit") limit?: string) {
    const parsed = limit ? Number.parseInt(limit, 10) : undefined;
    return this.adminService.getExecutions(parsed);
  }

  @Get("tenants")
  getTenants() {
    return this.adminService.getTenants();
  }
}
