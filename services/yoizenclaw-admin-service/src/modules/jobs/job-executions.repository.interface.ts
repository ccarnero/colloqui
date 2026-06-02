export const JOB_EXECUTIONS_REPOSITORY = Symbol("JOB_EXECUTIONS_REPOSITORY");

export interface IJobExecution {
  id: string;
  job_id: string;
  job_name?: string;
  status: "pending" | "running" | "completed" | "failed";
  event_payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  logs: string[];
  error_message: string | null;
  retry_count: number;
  triggered_by: string | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
}

export interface ICreateExecutionData {
  job_id: string;
  status: "pending" | "running" | "completed" | "failed";
  event_payload?: Record<string, unknown>;
  triggered_by?: string;
}

export interface IFindAllExecutionsOptions {
  job_id?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface IJobExecutionsRepository {
  findAll(
    tenantId: string,
    options?: IFindAllExecutionsOptions,
  ): Promise<{ executions: IJobExecution[]; total: number }>;
  create(tenantId: string, data: ICreateExecutionData): Promise<IJobExecution>;
}
