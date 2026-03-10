import type { HttpTransport } from '../transport';
import type {
  CreateScheduleParams,
  UpdateScheduleParams,
  Schedule,
  TriggerScheduleResult,
  ExecutionLog,
  ScheduleQuery,
  ExecutionQuery,
} from '../types';

export class SchedulesClient {
  constructor(private readonly transport: HttpTransport) {}

  async create(params: CreateScheduleParams): Promise<Schedule> {
    return this.transport.post<Schedule>('/schedulers/schedules', params);
  }

  async list(query?: ScheduleQuery): Promise<Schedule[]> {
    return this.transport.get<Schedule[]>('/schedulers/schedules', toStringRecord(query));
  }

  async get(id: string): Promise<Schedule> {
    return this.transport.get<Schedule>(`/schedulers/schedules/${encodeURIComponent(id)}`);
  }

  async update(id: string, params: UpdateScheduleParams): Promise<Schedule> {
    return this.transport.patch<Schedule>(`/schedulers/schedules/${encodeURIComponent(id)}`, params);
  }

  async delete(id: string): Promise<void> {
    await this.transport.delete(`/schedulers/schedules/${encodeURIComponent(id)}`);
  }

  async trigger(id: string): Promise<TriggerScheduleResult> {
    return this.transport.post<TriggerScheduleResult>(
      `/schedulers/schedules/${encodeURIComponent(id)}/trigger`,
    );
  }

  async listExecutions(query?: ExecutionQuery & { scheduleId?: string }): Promise<ExecutionLog[]> {
    if (query?.scheduleId) {
      const { scheduleId, ...rest } = query;
      return this.transport.get<ExecutionLog[]>(
        `/schedulers/schedules/${encodeURIComponent(scheduleId)}/executions`,
        toStringRecord(rest),
      );
    }
    return this.transport.get<ExecutionLog[]>('/schedulers/executions', toStringRecord(query));
  }

  async getExecution(id: string): Promise<ExecutionLog> {
    return this.transport.get<ExecutionLog>(`/schedulers/executions/${encodeURIComponent(id)}`);
  }
}

function toStringRecord(
  obj?: object,
): Record<string, string | number | boolean | undefined> | undefined {
  if (!obj) return undefined;
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        ? v
        : String(v);
    }
  }
  return out;
}
