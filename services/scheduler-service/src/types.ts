export type ExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "timeout";

/** Shared list filters for schedule queries (service + repository). */
export interface IScheduleQueryParams {
  enabled?: string;
  type?: string;
  limit: number;
  offset: number;
}

/** Shared list filters for execution log queries (service + repository). */
export interface IExecutionQueryParams {
  status?: string;
  limit: number;
  offset: number;
}
