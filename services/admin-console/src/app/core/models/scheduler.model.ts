// ---------------------------------------------------------------------------
// Scheduler / Jobs types (mirrors @yoizen/shared scheduler.interfaces.ts)
// ---------------------------------------------------------------------------

export interface IJob {
  id: string;
  name: string;
  agent_id: string;
  agent_name?: string;
  schedule: string;
  schedule_type?: "cron" | "interval" | "event";
  payload: Record<string, unknown>;
  is_active: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
  updated_at: string;
}

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
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface ICreateJobData {
  name: string;
  agent_id: string;
  schedule: string;
  payload?: Record<string, unknown>;
  is_active?: boolean;
}

export interface IUpdateJobData {
  name?: string;
  agent_id?: string;
  schedule?: string;
  payload?: Record<string, unknown>;
  is_active?: boolean;
}

export interface ITriggerJobData {
  event_payload?: Record<string, unknown>;
}

export interface IJobListQuery {
  agent_id?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface IJobListResponse {
  jobs: IJob[];
  total: number;
}

export interface IExecutionListQuery {
  job_id?: string;
  status?: "pending" | "running" | "completed" | "failed";
  limit?: number;
  offset?: number;
}

export interface IExecutionListResponse {
  executions: IJobExecution[];
  total: number;
}
