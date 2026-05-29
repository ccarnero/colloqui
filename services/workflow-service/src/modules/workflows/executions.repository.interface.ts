export const EXECUTIONS_REPOSITORY = Symbol("EXECUTIONS_REPOSITORY");

export interface IWorkflowExecutionRow {
  id: string;
  definition_id: string;
  temporal_workflow_id: string;
  temporal_run_id: string;
  request: unknown;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateExecutionParams {
  readonly id: string;
  readonly definitionId: string;
  readonly tenantId: string;
  readonly temporalWorkflowId: string;
  readonly temporalRunId: string;
  readonly request: Record<string, unknown>;
}

export type ExecutionsSortDirection = "asc" | "desc";

export interface IFindExecutionsParams {
  readonly definitionId: string;
  readonly tenantId: string;
  readonly limit: number;
  readonly offset: number;
  readonly sort: ExecutionsSortDirection;
}

export interface IExecutionsCountByDefinition {
  readonly definition_id: string;
  readonly count: number;
}

export interface IExecutionsRepository {
  createExecution(
    params: ICreateExecutionParams,
  ): Promise<IWorkflowExecutionRow>;
  updateExecutionStatus(
    id: string,
    tenantId: string,
    status: string,
  ): Promise<boolean>;
  findExecutionById(
    id: string,
    tenantId: string,
  ): Promise<IWorkflowExecutionRow | undefined>;
  findExecutionsByDefinition(
    params: IFindExecutionsParams,
  ): Promise<IWorkflowExecutionRow[]>;
  countExecutionsByDefinition(
    definitionId: string,
    tenantId: string,
  ): Promise<number>;
  countExecutionsGroupedByDefinition(
    tenantId: string,
  ): Promise<IExecutionsCountByDefinition[]>;
}
