import { Inject, Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import { POSTGRES_SQL } from "../../providers/postgres.provider";

export interface IWorkflowDefinitionRow {
  id: string;
  tenant_id: string;
  name: string;
  application: string;
  actions: unknown;
  trigger: unknown;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface IWorkflowExecutionRow {
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

export interface ICreateDefinitionParams {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly application: string;
  readonly actions: unknown[];
  readonly trigger?: unknown;
}

export interface IUpdateDefinitionParams {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly application: string;
  readonly actions: unknown[];
  readonly trigger?: unknown;
}

export interface ICreateExecutionParams {
  readonly id: string;
  readonly definitionId: string;
  readonly tenantId: string;
  readonly temporalWorkflowId: string;
  readonly temporalRunId: string;
  readonly request: Record<string, unknown>;
}

@Injectable()
export class WorkflowsRepository {
  constructor(
    @Inject(POSTGRES_SQL) private readonly sql: Sql,
  ) {}

  async createDefinition(
    params: ICreateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow> {
    const { id, tenantId, name, application, actions, trigger } = params;
    const triggerJson = trigger ? this.sql.json(trigger as never) : null;
    const [row] = await this.sql<IWorkflowDefinitionRow[]>`
      INSERT INTO workflow_definitions
        (id, tenant_id, name, application, actions, trigger)
      VALUES
        (${id}, ${tenantId}, ${name}, ${application},
         ${this.sql.json(actions as never)}, ${triggerJson})
      RETURNING id, tenant_id, name, application, actions, trigger,
                created_at, updated_at, deleted_at
    `;
    return row;
  }

  async updateDefinition(
    params: IUpdateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow | undefined> {
    const { id, tenantId, name, application, actions, trigger } = params;
    const triggerJson = trigger ? this.sql.json(trigger as never) : null;
    const [row] = await this.sql<IWorkflowDefinitionRow[]>`
      UPDATE workflow_definitions
      SET name = ${name},
          application = ${application},
          actions = ${this.sql.json(actions as never)},
          trigger = ${triggerJson},
          updated_at = NOW()
      WHERE id = ${id}
        AND tenant_id = ${tenantId}
        AND deleted_at IS NULL
      RETURNING id, tenant_id, name, application, actions, trigger,
                created_at, updated_at, deleted_at
    `;
    return row;
  }

  async findDefinitionById(
    id: string,
    tenantId: string,
  ): Promise<IWorkflowDefinitionRow | undefined> {
    const [row] = await this.sql<IWorkflowDefinitionRow[]>`
      SELECT id, tenant_id, name, application, actions, trigger,
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
  ): Promise<IWorkflowDefinitionRow[]> {
    return this.sql<IWorkflowDefinitionRow[]>`
      SELECT id, tenant_id, name, application, actions, trigger,
             created_at, updated_at, deleted_at
      FROM workflow_definitions
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
      ORDER BY created_at DESC
    `;
  }

  /**
   * Finds active definitions with a trigger matching the given type,
   * scoped to a specific tenant.
   */
  async findDefinitionsByTriggerType(
    tenantId: string,
    triggerType: string,
  ): Promise<IWorkflowDefinitionRow[]> {
    return this.sql<IWorkflowDefinitionRow[]>`
      SELECT id, tenant_id, name, application, actions, trigger,
             created_at, updated_at, deleted_at
      FROM workflow_definitions
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND trigger IS NOT NULL
        AND trigger->>'type' = ${triggerType}
      ORDER BY created_at ASC
    `;
  }

  async softDeleteDefinition(id: string, tenantId: string): Promise<boolean> {
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
    const [row] = await this.sql<IWorkflowExecutionRow[]>`
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

  async updateExecutionStatus(id: string, status: string): Promise<boolean> {
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
  ): Promise<IWorkflowExecutionRow | undefined> {
    const [row] = await this.sql<IWorkflowExecutionRow[]>`
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
  ): Promise<IWorkflowExecutionRow[]> {
    return this.sql<IWorkflowExecutionRow[]>`
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
