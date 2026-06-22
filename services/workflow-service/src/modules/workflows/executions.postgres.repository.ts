import { Inject, Injectable } from "@nestjs/common";
import type { Sql, TenantConnectionManager } from "@yoizen/database";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  ICreateExecutionParams,
  IExecutionsCountByDefinition,
  IExecutionsRepository,
  IFindExecutionsParams,
  ITopDefinitionRow,
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
    params: ICreateExecutionParams
  ): Promise<IWorkflowExecutionRow> {
    const {
      id,
      definitionId,
      tenantId,
      temporalWorkflowId,
      temporalRunId,
      correlationId,
      request,
    } = params;
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<IWorkflowExecutionRow[]>`
      INSERT INTO workflow_executions
        (id, definition_id, temporal_workflow_id,
         temporal_run_id, correlation_id, request)
      VALUES
        (${id}, ${definitionId},
         ${temporalWorkflowId}, ${temporalRunId},
         ${correlationId ?? null}, ${sql.json(request as never)})
      RETURNING id, definition_id,
                temporal_workflow_id, temporal_run_id,
                correlation_id, request, status, created_at, updated_at
    `;
    return row!;
  }

  async updateExecutionStatus(
    id: string,
    tenantId: string,
    status: string
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
    tenantId: string
  ): Promise<IWorkflowExecutionRow | undefined> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<IWorkflowExecutionRow[]>`
      SELECT id, definition_id,
             temporal_workflow_id, temporal_run_id,
             correlation_id, request, status, created_at, updated_at
      FROM workflow_executions
      WHERE id = ${id}
    `;
    return row;
  }

  async findExecutionsByDefinition(
    params: IFindExecutionsParams
  ): Promise<IWorkflowExecutionRow[]> {
    const { definitionId, tenantId, limit, offset, sort } = params;
    const sql = await this.sqlFor(tenantId);
    const orderFragment =
      sort === "asc" ? sql`created_at ASC` : sql`created_at DESC`;
    return sql<IWorkflowExecutionRow[]>`
      SELECT id, definition_id,
             temporal_workflow_id, temporal_run_id,
             correlation_id, request, status, created_at, updated_at
      FROM workflow_executions
      WHERE definition_id = ${definitionId}
      ORDER BY ${orderFragment}
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  async findExecutionsByCorrelation(
    correlationId: string,
    tenantId: string
  ): Promise<IWorkflowExecutionRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IWorkflowExecutionRow[]>`
      SELECT id, definition_id,
             temporal_workflow_id, temporal_run_id,
             correlation_id, request, status, created_at, updated_at
      FROM workflow_executions
      WHERE correlation_id = ${correlationId}
      ORDER BY created_at ASC
    `;
  }

  async countExecutionsByDefinition(
    definitionId: string,
    tenantId: string
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
    tenantId: string
  ): Promise<IExecutionsCountByDefinition[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IExecutionsCountByDefinition[]>`
      SELECT definition_id, COUNT(*)::int AS count
      FROM workflow_executions
      GROUP BY definition_id
    `;
  }

  async countFailingByLastRun(tenantId: string): Promise<number> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<{ total: number }[]>`
      WITH latest AS (
        SELECT DISTINCT ON (e.definition_id)
          e.definition_id, e.status
        FROM workflow_executions e
        JOIN workflow_definitions d ON d.id = e.definition_id AND d.deleted_at IS NULL
        WHERE e.status = ANY(ARRAY['COMPLETED','FAILED','TIMED_OUT','CANCELLED','TERMINATED'])
        ORDER BY e.definition_id, e.created_at DESC
      )
      SELECT COUNT(*)::int AS total FROM latest WHERE status != 'COMPLETED'
    `;
    return row?.total ?? 0;
  }

  async countFailingByWindow7d(tenantId: string, since: Date): Promise<number> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<{ total: number }[]>`
      SELECT COUNT(DISTINCT definition_id)::int AS total
      FROM workflow_executions
      WHERE status = ANY(ARRAY['FAILED','TIMED_OUT','CANCELLED','TERMINATED'])
        AND created_at >= ${since}
    `;
    return row?.total ?? 0;
  }

  async countExecutionsByStatusSince(
    tenantId: string,
    statuses: string[],
    since: Date
  ): Promise<number> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<{ total: number }[]>`
      SELECT COUNT(*)::int AS total
      FROM workflow_executions
      WHERE status = ANY(${sql.array(statuses)}::text[])
        AND created_at >= ${since}
    `;
    return row?.total ?? 0;
  }

  async topDefinitionsByExecutionCount(
    tenantId: string,
    since: Date,
    limit: number
  ): Promise<ITopDefinitionRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<ITopDefinitionRow[]>`
      SELECT e.definition_id, d.name, d.application, COUNT(*)::int AS count
      FROM workflow_executions e
      JOIN workflow_definitions d ON d.id = e.definition_id
      WHERE e.created_at >= ${since}
      GROUP BY e.definition_id, d.name, d.application
      ORDER BY count DESC
      LIMIT ${limit}
    `;
  }
}
