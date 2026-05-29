import { Inject, Injectable } from "@nestjs/common";
import type { Sql, TenantConnectionManager } from "@yoizen/database";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  ICreateExecutionParams,
  IExecutionsCountByDefinition,
  IExecutionsRepository,
  IFindExecutionsParams,
  IWorkflowExecutionRow,
} from "./executions.repository.interface";

@Injectable()
export class ExecutionsPostgresRepository implements IExecutionsRepository {
  constructor(
    @Inject(WorkflowTenantConnectionManager)
    private readonly connections: TenantConnectionManager,
  ) {}

  private sqlFor(tenantId: string): Promise<Sql> {
    return this.connections.ensureSchema(tenantId);
  }

  async createExecution(
    params: ICreateExecutionParams,
  ): Promise<IWorkflowExecutionRow> {
    const {
      id,
      definitionId,
      tenantId,
      temporalWorkflowId,
      temporalRunId,
      request,
    } = params;
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<IWorkflowExecutionRow[]>`
      INSERT INTO workflow_executions
        (id, definition_id, temporal_workflow_id,
         temporal_run_id, request)
      VALUES
        (${id}, ${definitionId},
         ${temporalWorkflowId}, ${temporalRunId},
         ${sql.json(request as never)})
      RETURNING id, definition_id,
                temporal_workflow_id, temporal_run_id,
                request, status, created_at, updated_at
    `;
    return row!;
  }

  async updateExecutionStatus(
    id: string,
    tenantId: string,
    status: string,
  ): Promise<boolean> {
    const sql = await this.sqlFor(tenantId);
    const result = await sql`
      UPDATE workflow_executions
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
    `;
    return result.count > 0;
  }

  async findExecutionById(
    id: string,
    tenantId: string,
  ): Promise<IWorkflowExecutionRow | undefined> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<IWorkflowExecutionRow[]>`
      SELECT id, definition_id,
             temporal_workflow_id, temporal_run_id,
             request, status, created_at, updated_at
      FROM workflow_executions
      WHERE id = ${id}
    `;
    return row;
  }

  async findExecutionsByDefinition(
    params: IFindExecutionsParams,
  ): Promise<IWorkflowExecutionRow[]> {
    const { definitionId, tenantId, limit, offset, sort } = params;
    const sql = await this.sqlFor(tenantId);
    const orderFragment =
      sort === "asc" ? sql`created_at ASC` : sql`created_at DESC`;
    return sql<IWorkflowExecutionRow[]>`
      SELECT id, definition_id,
             temporal_workflow_id, temporal_run_id,
             request, status, created_at, updated_at
      FROM workflow_executions
      WHERE definition_id = ${definitionId}
      ORDER BY ${orderFragment}
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async countExecutionsByDefinition(
    definitionId: string,
    tenantId: string,
  ): Promise<number> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM workflow_executions
      WHERE definition_id = ${definitionId}
    `;
    return row?.total ?? 0;
  }

  async countExecutionsGroupedByDefinition(
    tenantId: string,
  ): Promise<IExecutionsCountByDefinition[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IExecutionsCountByDefinition[]>`
      SELECT definition_id, COUNT(*)::int AS count
      FROM workflow_executions
      GROUP BY definition_id
    `;
  }
}
