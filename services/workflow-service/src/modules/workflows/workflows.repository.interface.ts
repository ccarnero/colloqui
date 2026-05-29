export const WORKFLOWS_REPOSITORY = Symbol("WORKFLOWS_REPOSITORY");

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

export interface IWorkflowsRepository {
  createDefinition(
    params: ICreateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow>;
  updateDefinition(
    params: IUpdateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow | undefined>;
  findDefinitionById(
    id: string,
    tenantId: string,
  ): Promise<IWorkflowDefinitionRow | undefined>;
  findDefinitionsByTenant(tenantId: string): Promise<IWorkflowDefinitionRow[]>;
  findDefinitionsByTriggerType(
    tenantId: string,
    triggerType: string,
  ): Promise<IWorkflowDefinitionRow[]>;
  softDeleteDefinition(id: string, tenantId: string): Promise<boolean>;
}
