import { Module } from "@nestjs/common";
import { SchedulerService } from "./scheduler.service";
import { TriggerManagerService } from "./trigger-manager.service";
import { LeaderElectionService } from "./leader-election.service";

@Module({
  providers: [
    LeaderElectionService,
    TriggerManagerService,
    SchedulerService,
  ],
  exports: [SchedulerService, TriggerManagerService],
})
export class SchedulerModule {}
