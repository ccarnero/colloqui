import { Injectable, OnModuleInit } from "@nestjs/common";
import { PinoLoggerService } from "@yoizen/observability";
import { SchedulerService } from "./scheduler.service";

@Injectable()
export class TenantJobReconcilerService implements OnModuleInit {
  private readonly logger = new PinoLoggerService(
    TenantJobReconcilerService.name,
  );

  constructor(private readonly schedulerService: SchedulerService) {}

  async onModuleInit(): Promise<void> {
    this.logger.log("Starting scheduler on module init...");
    await this.schedulerService.start();
  }
}
