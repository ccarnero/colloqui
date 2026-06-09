import { Inject, Injectable } from "@nestjs/common";
import type { Filter, WithId } from "mongodb";
import type { TenantMongoConnectionManager } from "@yoizen/database";
import { WorkflowTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  ICreateDefinitionParams,
  IUpdateDefinitionParams,
  IWorkflowDefinitionRow,
  IWorkflowsRepository,
} from "./workflows.repository.interface";

interface IWorkflowDefinitionDoc {
  _id: string;
  name: string;
  application: string;
  actions: unknown[];
  trigger: unknown;
  variables: unknown;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

const ACTIVE_FILTER: Filter<IWorkflowDefinitionDoc> = { deleted_at: null };

function toDate(value: unknown): Date {
  if (value instanceof Date) return value;
  return new Date(String(value ?? Date.now()));
}

function docToDefinitionRow(
  doc: WithId<IWorkflowDefinitionDoc>,
): IWorkflowDefinitionRow {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ""),
    application: String(doc.application ?? ""),
    actions: doc.actions ?? [],
    trigger: doc.trigger ?? null,
    variables: doc.variables ?? null,
    created_at: toDate(doc.created_at),
    updated_at: toDate(doc.updated_at),
    deleted_at:
      doc.deleted_at === null || doc.deleted_at === undefined
        ? null
        : toDate(doc.deleted_at),
  };
}

@Injectable()
export class WorkflowsMongoRepository implements IWorkflowsRepository {
  constructor(
    @Inject(WorkflowTenantConnectionManager)
    private readonly connections: TenantMongoConnectionManager,
  ) {}

  private async definitions(tenantId: string) {
    const db = await this.connections.ensureSchema(tenantId);
    return db.collection<IWorkflowDefinitionDoc>("workflow_definitions");
  }

  async createDefinition(
    params: ICreateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow> {
    const { id, tenantId, name, application, actions, trigger, variables } = params;
    const now = new Date();
    const doc: IWorkflowDefinitionDoc = {
      _id: id,
      name,
      application,
      actions,
      trigger: trigger ?? null,
      variables: variables ?? null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    const col = await this.definitions(tenantId);
    await col.insertOne(doc);
    return docToDefinitionRow(doc);
  }

  async updateDefinition(
    params: IUpdateDefinitionParams,
  ): Promise<IWorkflowDefinitionRow | undefined> {
    const { id, tenantId, name, application, actions, trigger, variables } = params;
    const now = new Date();
    const col = await this.definitions(tenantId);
    const result = await col.findOneAndUpdate(
      { _id: id, ...ACTIVE_FILTER },
      {
        $set: {
          name,
          application,
          actions,
          trigger: trigger ?? null,
          variables: variables ?? null,
          updated_at: now,
        },
      },
      { returnDocument: "after" },
    );
    return result ? docToDefinitionRow(result) : undefined;
  }

  async findDefinitionById(
    id: string,
    tenantId: string,
  ): Promise<IWorkflowDefinitionRow | undefined> {
    const col = await this.definitions(tenantId);
    const doc = await col.findOne({ _id: id, ...ACTIVE_FILTER });
    return doc ? docToDefinitionRow(doc) : undefined;
  }

  async findDefinitionsByTenant(
    tenantId: string,
  ): Promise<IWorkflowDefinitionRow[]> {
    const col = await this.definitions(tenantId);
    const docs = await col
      .find(ACTIVE_FILTER)
      .sort({ created_at: -1 })
      .toArray();
    return docs.map(docToDefinitionRow);
  }

  async findDefinitionsByTriggerType(
    tenantId: string,
    triggerType: string,
  ): Promise<IWorkflowDefinitionRow[]> {
    const col = await this.definitions(tenantId);
    const filter: Filter<IWorkflowDefinitionDoc> = {
      ...ACTIVE_FILTER,
      trigger: { $exists: true, $ne: null },
      "trigger.type": triggerType,
    };
    const docs = await col.find(filter).sort({ created_at: 1 }).toArray();
    return docs.map(docToDefinitionRow);
  }

  async softDeleteDefinition(id: string, tenantId: string): Promise<boolean> {
    const now = new Date();
    const col = await this.definitions(tenantId);
    const result = await col.updateOne(
      { _id: id, ...ACTIVE_FILTER },
      { $set: { deleted_at: now, updated_at: now } },
    );
    return result.modifiedCount > 0;
  }
}
