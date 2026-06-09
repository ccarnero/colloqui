import { Injectable } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { SchedulerTenantConnectionManager } from "../../providers/tenant-connection.manager";
import { SchedulerService } from "../scheduler/scheduler.service";
import { ExecutionHistoryService } from "../scheduler/execution-history.service";

@Injectable()
export class AdminService {
  private readonly logger = new PinoLoggerService(AdminService.name);

  constructor(
    private readonly tenantManager: SchedulerTenantConnectionManager,
    private readonly schedulerService: SchedulerService,
    private readonly executionHistory: ExecutionHistoryService,
  ) {}

  getActiveJobs() {
    return this.schedulerService.getActiveSchedulesSummary();
  }

  async getExecutions(limit?: number) {
    return this.executionHistory.getRecentExecutions(limit);
  }

  getTenants() {
    return this.tenantManager.getKnownTenantIds();
  }
}
