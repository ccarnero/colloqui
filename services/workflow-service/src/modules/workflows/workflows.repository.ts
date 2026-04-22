import { Injectable } from "@nestjs/common";
import type { Sql } from "postgres";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";

export interface IWorkflowDefinitionRow {
  id: string;
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

/**
 * Persistence for workflow definitions and executions.
 *
 * Each tenant has a dedicated Postgres instance (provisioned by
 * `tenant-service` in its own Kubernetes namespace), so no `tenant_id`
 * column is stored — the DB itself is the tenant boundary. The
 * `tenantId` method parameter is used purely to resolve the correct
 * pool from `WorkflowTenantConnectionManager`.
 */
@Injectable()
export class WorkflowsRepository {
  constructor(
    private readonly connections: WorkflowTenantConnectionManager,
  ) {}

  private sqlFor(tenantId: string): Promise<Sql> {
    return this.connections.ensureSchema(tenantId);
  }

  async createDefinition(
    params: ICreateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow> {
    const { id, tenantId, name, application, actions, trigger } = params;
    const sql = await this.sqlFor(tenantId);
    const triggerJson = trigger ? sql.json(trigger as never) : null;
    const [row] = await sql<IWorkflowDefinitionRow[]>`
      INSERT INTO workflow_definitions
        (id, name, application, actions, trigger)
      VALUES
        (${id}, ${name}, ${application},
         ${sql.json(actions as never)}, ${triggerJson})
      RETURNING id, name, application, actions, trigger,
                created_at, updated_at, deleted_at
    `;
    return row!;
  }

  async updateDefinition(
    params: IUpdateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow | undefined> {
    const { id, tenantId, name, application, actions, trigger } = params;
    const sql = await this.sqlFor(tenantId);
    const triggerJson = trigger ? sql.json(trigger as never) : null;
    const [row] = await sql<IWorkflowDefinitionRow[]>`
      UPDATE workflow_definitions
      SET name = ${name},
          application = ${application},
          actions = ${sql.json(actions as never)},
          trigger = ${triggerJson},
          updated_at = NOW()
      WHERE id = ${id}
        AND deleted_at IS NULL
      RETURNING id, name, application, actions, trigger,
                created_at, updated_at, deleted_at
    `;
    return row;
  }

  async findDefinitionById(
    id: string,
    tenantId: string,
  ): Promise<IWorkflowDefinitionRow | undefined> {
    const sql = await this.sqlFor(tenantId);
    const [row] = await sql<IWorkflowDefinitionRow[]>`
      SELECT id, name, application, actions, trigger,
             created_at, updated_at, deleted_at
      FROM workflow_definitions
      WHERE id = ${id}
        AND deleted_at IS NULL
    `;
    return row;
  }

  async findDefinitionsByTenant(
    tenantId: string,
  ): Promise<IWorkflowDefinitionRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IWorkflowDefinitionRow[]>`
      SELECT id, name, application, actions, trigger,
             created_at, updated_at, deleted_at
      FROM workflow_definitions
      WHERE deleted_at IS NULL
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
    const sql = await this.sqlFor(tenantId);
    return sql<IWorkflowDefinitionRow[]>`
      SELECT id, name, application, actions, trigger,
             created_at, updated_at, deleted_at
      FROM workflow_definitions
      WHERE deleted_at IS NULL
        AND trigger IS NOT NULL
        AND trigger->>'type' = ${triggerType}
      ORDER BY created_at ASC
    `;
  }

  async softDeleteDefinition(id: string, tenantId: string): Promise<boolean> {
    const sql = await this.sqlFor(tenantId);
    const result = await sql`
      UPDATE workflow_definitions
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${id}
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
    definitionId: string,
    tenantId: string,
  ): Promise<IWorkflowExecutionRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IWorkflowExecutionRow[]>`
      SELECT id, definition_id,
             temporal_workflow_id, temporal_run_id,
             request, status, created_at, updated_at
      FROM workflow_executions
      WHERE definition_id = ${definitionId}
      ORDER BY created_at DESC
    `;
  }
}
