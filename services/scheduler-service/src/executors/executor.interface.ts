import type { Schedule } from '../modules/schedules/schedules.service';
import type { ExecutionResult } from '../engine/engine.service';

export interface ScheduleExecutor {
  execute(schedule: Schedule, tenantId: string): Promise<ExecutionResult>;
}
