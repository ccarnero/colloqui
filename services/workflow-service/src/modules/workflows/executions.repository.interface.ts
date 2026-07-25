export const EXECUTIONS_REPOSITORY = Symbol("EXECUTIONS_REPOSITORY");

export interface IWorkflowExecutionRow {
  id: string;
  definition_id: string;
  temporal_workflow_id: string;
  temporal_run_id: string;
  correlation_id: string | null;
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
  readonly correlationId?: string | null;
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

export interface ITopDefinitionRow {
  readonly definition_id: string;
  readonly name: string;
  readonly application: string;
  readonly count: number;
}

export interface IExecutionsRepository {
  createExecution(
    params: ICreateExecutionParams
  ): Promise<IWorkflowExecutionRow>;
  updateExecutionStatus(
    id: string,
    tenantId: string,
    status: string
  ): Promise<boolean>;
  findExecutionById(
    id: string,
    tenantId: string
  ): Promise<IWorkflowExecutionRow | undefined>;
  findExecutionsByDefinition(
    params: IFindExecutionsParams
  ): Promise<IWorkflowExecutionRow[]>;
  findExecutionsByCorrelation(
    correlationId: string,
    tenantId: string
  ): Promise<IWorkflowExecutionRow[]>;
  countExecutionsByDefinition(
    definitionId: string,
    tenantId: string
  ): Promise<number>;
  countExecutionsGroupedByDefinition(
    tenantId: string
  ): Promise<IExecutionsCountByDefinition[]>;
  countFailingByLastRun(tenantId: string): Promise<number>;
  countFailingByWindow7d(tenantId: string, since: Date): Promise<number>;
  countExecutionsByStatusSince(
    tenantId: string,
    statuses: string[],
    since: Date
  ): Promise<number>;
  topDefinitionsByExecutionCount(
    tenantId: string,
    since: Date,
    limit: number
  ): Promise<ITopDefinitionRow[]>;
  /**
   * Distinct, non-null `correlation_id`s for a definition's executions
   * created since `since` — the first hop of T07's per-node stats join
   * (`manual-loops/admin-console/console-redesign-builder-v2.md`, "T06
   * findings"): `definitionId -> correlationIds[]`, handed to
   * tracking-ingester-service's `GET /node-stats` aggregate. Mirrors
   * `findExecutionsByDefinition`'s per-definition scoping and
   * `topDefinitionsByExecutionCount`'s windowed-since convention; `limit`
   * bounds the returned id count (never unbounded — see
   * `WorkflowsService.listCorrelationIdsForDefinition`).
   */
  findCorrelationIdsByDefinition(
    definitionId: string,
    tenantId: string,
    since: Date,
    limit: number
  ): Promise<string[]>;
}
