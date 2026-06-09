import { Inject, Injectable } from "@nestjs/common";
import type { Sql, TenantConnectionManager } from "@yoizen/database";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  ICreateDefinitionParams,
  IUpdateDefinitionParams,
  IWorkflowDefinitionRow,
  IWorkflowsRepository,
} from "./workflows.repository.interface";

@Injectable()
export class WorkflowsPostgresRepository implements IWorkflowsRepository {
  constructor(
    @Inject(WorkflowTenantConnectionManager)
    private readonly connections: TenantConnectionManager,
  ) {}

  private sqlFor(tenantId: string): Promise<Sql> {
    return this.connections.ensureSchema(tenantId);
  }

  async createDefinition(
    params: ICreateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow> {
    const { id, tenantId, name, application, actions, trigger, variables } = params;
    const sql = await this.sqlFor(tenantId);
    const triggerJson = trigger ? sql.json(trigger as never) : null;
    const variablesJson = variables ? sql.json(variables as never) : null;
    const [row] = await sql<IWorkflowDefinitionRow[]>`
      INSERT INTO workflow_definitions
        (id, name, application, actions, trigger, variables)
      VALUES
        (${id}, ${name}, ${application},
         ${sql.json(actions as never)}, ${triggerJson}, ${variablesJson})
      RETURNING id, name, application, actions, trigger, variables,
                created_at, updated_at, deleted_at
    `;
    return row!;
  }

  async updateDefinition(
    params: IUpdateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow | undefined> {
    const { id, tenantId, name, application, actions, trigger, variables } = params;
    const sql = await this.sqlFor(tenantId);
    const triggerJson = trigger ? sql.json(trigger as never) : null;
    const variablesJson = variables ? sql.json(variables as never) : null;
    const [row] = await sql<IWorkflowDefinitionRow[]>`
      UPDATE workflow_definitions
      SET name = ${name},
          application = ${application},
          actions = ${sql.json(actions as never)},
          trigger = ${triggerJson},
          variables = ${variablesJson},
          updated_at = NOW()
      WHERE id = ${id}
        AND deleted_at IS NULL
      RETURNING id, name, application, actions, trigger, variables,
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
      SELECT id, name, application, actions, trigger, variables,
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
      SELECT id, name, application, actions, trigger, variables,
             created_at, updated_at, deleted_at
      FROM workflow_definitions
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `;
  }

  async findDefinitionsByTriggerType(
    tenantId: string,
    triggerType: string,
  ): Promise<IWorkflowDefinitionRow[]> {
    const sql = await this.sqlFor(tenantId);
    return sql<IWorkflowDefinitionRow[]>`
      SELECT id, name, application, actions, trigger, variables,
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
}
