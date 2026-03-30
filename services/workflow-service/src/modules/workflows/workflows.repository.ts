import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import { POSTGRES_SQL } from "../../providers/postgres.provider";

export interface WorkflowDefinitionRow {
  id: string;
  tenant_id: string;
  name: string;
  application: string;
  actions: unknown;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface WorkflowExecutionRow {
  id: string;
  definition_id: string;
  tenant_id: string;
  temporal_workflow_id: string;
  temporal_run_id: string;
  request: unknown;
  status: string;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class WorkflowsRepository {
  constructor(
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
  ) {}

  async createDefinition(
    id: string,
    tenantId: string,
    name: string,
    application: string,
    actions: unknown[],
  ): Promise<WorkflowDefinitionRow> {
    const [row] = await this.sql<WorkflowDefinitionRow[]>`
      INSERT INTO workflow_definitions (id, tenant_id, name, application, actions)
      VALUES (${id}, ${tenantId}, ${name}, ${application}, ${this.sql.json(actions as never)})
      RETURNING id, tenant_id, name, application, actions,
                created_at, updated_at, deleted_at
    `;
    return row;
  }

  async findDefinitionById(
    id: string,
    tenantId: string,
  ): Promise<WorkflowDefinitionRow | undefined> {
    const [row] = await this.sql<WorkflowDefinitionRow[]>`
      SELECT id, tenant_id, name, application, actions,
             created_at, updated_at, deleted_at
      FROM workflow_definitions
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
    `;
    return row;
  }

  async findDefinitionsByTenant(
    tenantId: string,
  ): Promise<WorkflowDefinitionRow[]> {
    return this.sql<WorkflowDefinitionRow[]>`
      SELECT id, tenant_id, name, application, actions,
             created_at, updated_at, deleted_at
      FROM workflow_definitions
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
  }

  async softDeleteDefinition(
    id: string,
    tenantId: string,
  ): Promise<boolean> {
    const result = await this.sql`
      UPDATE workflow_definitions
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
    `;
    return result.count > 0;
  }

  async createExecution(
    id: string,
    definitionId: string,
    tenantId: string,
    temporalWorkflowId: string,
    temporalRunId: string,
    request: Record<string, unknown>,
  ): Promise<WorkflowExecutionRow> {
    const [row] = await this.sql<WorkflowExecutionRow[]>`
      INSERT INTO workflow_executions
        (id, definition_id, tenant_id, temporal_workflow_id,
         temporal_run_id, request)
      VALUES
        (${id}, ${definitionId}, ${tenantId},
         ${temporalWorkflowId}, ${temporalRunId},
         ${this.sql.json(request as never)})
      RETURNING id, definition_id, tenant_id,
                temporal_workflow_id, temporal_run_id,
                request, status, created_at, updated_at
    `;
    return row;
  }

  async updateExecutionStatus(
    id: string,
    status: string,
  ): Promise<boolean> {
    const result = await this.sql`
      UPDATE workflow_executions
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
    `;
    return result.count > 0;
  }

  async findExecutionById(
    id: string,
    tenantId: string,
  ): Promise<WorkflowExecutionRow | undefined> {
    const [row] = await this.sql<WorkflowExecutionRow[]>`
      SELECT id, definition_id, tenant_id,
             temporal_workflow_id, temporal_run_id,
             request, status, created_at, updated_at
      FROM workflow_executions
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
    `;
    return row;
  }

  async findExecutionsByDefinition(
    definitionId: string,
    tenantId: string,
  ): Promise<WorkflowExecutionRow[]> {
    return this.sql<WorkflowExecutionRow[]>`
      SELECT id, definition_id, tenant_id,
             temporal_workflow_id, temporal_run_id,
             request, status, created_at, updated_at
      FROM workflow_executions
      WHERE definition_id = ${definitionId}
        AND tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `;
  }
}
