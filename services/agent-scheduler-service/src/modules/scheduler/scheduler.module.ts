import { Module } from "@nestjs/common";
import { SchedulerService } from "./scheduler.service";
import { JobReaderService } from "./job-reader.service";
import { JobTriggerService } from "./job-trigger.service";
import { LeaderElectionService } from "./leader-election.service";
import { ExecutionHistoryService } from "./execution-history.service";
import { TenantJobReconcilerService } from "./tenant-job-reconciler.service";

@Module({
  providers: [
    SchedulerService,
    JobReaderService,
    JobTriggerService,
    LeaderElectionService,
    ExecutionHistoryService,
    TenantJobReconcilerService,
  ],
  exports: [
    SchedulerService,
    ExecutionHistoryService,
  ],
})
export class SchedulerModule {}
