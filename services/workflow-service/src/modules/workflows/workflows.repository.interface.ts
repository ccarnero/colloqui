import type { WorkflowStatusValue } from "@yoizen/shared";

/** Thrown by `setStatus` implementations when no active row matches (id, tenant). */
export class WorkflowNotFoundError extends Error {
  constructor(
    readonly workflowId: string,
    readonly tenantId: string
  ) {
    super(
      `Workflow definition '${workflowId}' not found for tenant '${tenantId}'`
    );
    this.name = "WorkflowNotFoundError";
  }
}

export const WORKFLOWS_REPOSITORY = Symbol("WORKFLOWS_REPOSITORY");

export interface IWorkflowDefinitionRow {
  id: string;
  name: string;
  application: string;
  actions: unknown;
  trigger: unknown;
  variables: unknown;
  /** Per-tenant enable/disable toggle. Missing/legacy rows read as 'enabled'. */
  status: WorkflowStatusValue;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ICreateDefinitionParams {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly application: string;
  readonly actions: unknown[];
  readonly trigger?: unknown;
  readonly variables?: unknown;
}

export interface IUpdateDefinitionParams {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly application: string;
  readonly actions: unknown[];
  readonly trigger?: unknown;
  readonly variables?: unknown;
}

export interface IWorkflowsRepository {
  createDefinition(
    params: ICreateDefinitionParams
  ): Promise<IWorkflowDefinitionRow>;
  updateDefinition(
    params: IUpdateDefinitionParams
  ): Promise<IWorkflowDefinitionRow | undefined>;
  findDefinitionById(
    id: string,
    tenantId: string
  ): Promise<IWorkflowDefinitionRow | undefined>;
  findDefinitionsByTenant(tenantId: string): Promise<IWorkflowDefinitionRow[]>;
  findDefinitionsByTriggerType(
    tenantId: string,
    triggerType: string
  ): Promise<IWorkflowDefinitionRow[]>;
  softDeleteDefinition(id: string, tenantId: string): Promise<boolean>;
  countActiveDefinitions(tenantId: string): Promise<number>;
  /**
   * Sets the per-tenant enable/disable toggle on a workflow definition.
   * Returns the updated row. Throws `WorkflowNotFoundError` when no active
   * row matches (id, tenantId) — never returns `undefined` silently.
   */
  setStatus(
    tenantId: string,
    workflowId: string,
    status: WorkflowStatusValue
  ): Promise<IWorkflowDefinitionRow>;
}
