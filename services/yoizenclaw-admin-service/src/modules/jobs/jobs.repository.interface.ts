export const JOBS_REPOSITORY = Symbol("JOBS_REPOSITORY");

export interface IJob {
  id: string;
  name: string;
  agent_id: string;
  schedule: string;
  payload: Record<string, unknown>;
  is_active: boolean;
  last_run: Date | null;
  next_run: Date | null;
  created_at: Date;
  updated_at: Date;
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

export interface IFindAllJobsOptions {
  agent_id?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface IJobsRepository {
  findAll(
    tenantId: string,
    options?: IFindAllJobsOptions,
  ): Promise<{ jobs: IJob[]; total: number }>;
  findById(tenantId: string, id: string): Promise<IJob | null>;
  create(tenantId: string, data: ICreateJobData): Promise<IJob>;
  update(
    tenantId: string,
    id: string,
    data: IUpdateJobData,
  ): Promise<IJob | null>;
  delete(tenantId: string, id: string): Promise<boolean>;
  enable(tenantId: string, id: string): Promise<IJob | null>;
  disable(tenantId: string, id: string): Promise<IJob | null>;
  updateLastRun(
    tenantId: string,
    id: string,
    schedule: string,
  ): Promise<IJob | null>;
}
