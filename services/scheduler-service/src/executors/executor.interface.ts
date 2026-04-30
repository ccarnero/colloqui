import type { ISchedule } from "../modules/schedules/schedules.service";
import type { IExecutionResult } from "../engine/engine.service";

export interface IScheduleExecutor {
  execute(schedule: ISchedule, tenantId: string): Promise<IExecutionResult>;
}
