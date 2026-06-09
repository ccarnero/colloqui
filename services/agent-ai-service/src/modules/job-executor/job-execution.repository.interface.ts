import type { InjectionToken } from "@nestjs/common";

export const JOB_EXECUTION_REPOSITORY: InjectionToken =
  "JOB_EXECUTION_REPOSITORY";

export type JobExecutionStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface JobExecutionRecord {
  readonly id: string;
  readonly jobId: string;
  readonly tenantId: string;
  readonly status: JobExecutionStatus;
  readonly triggeredBy: string | null;
  readonly eventPayload: Record<string, unknown> | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly result: Record<string, unknown> | null;
  readonly errorMessage: string | null;
  readonly retryCount: number;
}

export interface CreateJobExecutionParams {
  readonly jobId: string;
  readonly tenantId: string;
  readonly triggeredBy?: string;
  readonly eventPayload?: Record<string, unknown>;
}

export interface UpdateJobStatusParams {
  readonly status: JobExecutionStatus;
  readonly result?: Record<string, unknown>;
  readonly errorMessage?: string;
  readonly startedAt?: Date;
  readonly finishedAt?: Date;
}

export interface IJobExecutionRepository {
  createExecution(
    params: CreateJobExecutionParams,
  ): Promise<JobExecutionRecord>;

  updateStatus(
    id: string,
    params: UpdateJobStatusParams,
  ): Promise<JobExecutionRecord | null>;

  findById(id: string): Promise<JobExecutionRecord | null>;
}
