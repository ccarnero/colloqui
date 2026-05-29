export const EXECUTIONS_PROJECTION_REPOSITORY = Symbol(
  "EXECUTIONS_PROJECTION_REPOSITORY",
);

export interface IExecutionStatusRow {
  id: string;
  status: string;
}

export interface IExecutionsProjectionRepository {
  applyStatusBatch(
    tenantId: string,
    rows: IExecutionStatusRow[],
  ): Promise<number>;
}
