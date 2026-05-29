import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Document, Filter, WithId } from "mongodb";
import type { IStringIdDoc, TenantMongoConnectionManager } from "@yoizen/database";
import { TenantScopedMongoRepository } from "../../providers/tenant-scoped.repository";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IAgent,
  IAgentsRepository,
  ICreateAgentData,
  IFindAllAgentsOptions,
  IUpdateAgentData,
} from "./agents.repository.interface";

function docToAgent(doc: WithId<IStringIdDoc>): IAgent {
  return {
    id: String(doc._id),
    name: String(doc.name ?? ""),
    description:
      doc.description === null || doc.description === undefined
        ? null
        : String(doc.description),
    system_prompt: String(doc.system_prompt ?? ""),
    model_config: (doc.model_config as Record<string, unknown>) ?? {},
    tools: Array.isArray(doc.tools) ? doc.tools : [],
    channels: Array.isArray(doc.channels) ? doc.channels : [],
    status: String(doc.status ?? "draft") as IAgent["status"],
    is_active: Boolean(doc.is_active ?? true),
    published_at:
      doc.published_at instanceof Date
        ? doc.published_at
        : doc.published_at
          ? new Date(String(doc.published_at))
          : null,
    created_at:
      doc.created_at instanceof Date
        ? doc.created_at
        : new Date(String(doc.created_at ?? Date.now())),
    updated_at:
      doc.updated_at instanceof Date
        ? doc.updated_at
        : new Date(String(doc.updated_at ?? Date.now())),
  };
}

@Injectable()
export class AgentsMongoRepository extends TenantScopedMongoRepository implements IAgentsRepository {
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantMongoConnectionManager,
  ) {
    super(connectionManager);
  }

  async findAll(
    tenantId: string,
    options: IFindAllAgentsOptions = {},
  ): Promise<{ agents: IAgent[]; total: number }> {
    const db = await this.getDb(tenantId);
    const col = db.collection<IStringIdDoc>("agents");
    const {
      status,
      is_active: isActiveFilter,
      limit = 20,
      offset = 0,
    } = options;
    const isActiveEq = isActiveFilter === undefined ? true : isActiveFilter;
    const filter: Filter<IStringIdDoc> = { is_active: isActiveEq };
    if (status) filter.status = status;

    const total = await col.countDocuments(filter);
    const docs = await col
      .find(filter)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return { agents: docs.map(docToAgent), total };
  }

  async findById(tenantId: string, id: string): Promise<IAgent | null> {
    const db = await this.getDb(tenantId);
    const doc = await db.collection<IStringIdDoc>("agents").findOne({
      _id: id,
      is_active: true,
    });
    return doc ? docToAgent(doc) : null;
  }

  async create(tenantId: string, data: ICreateAgentData): Promise<IAgent> {
    const db = await this.getDb(tenantId);
    const now = new Date();
    const doc = {
      _id: randomUUID(),
      name: data.name,
      description: data.description ?? null,
      system_prompt: data.system_prompt,
      model_config: data.model_config ?? {},
      tools: data.tools ?? [],
      channels: data.channels ?? [],
      status: "draft",
      is_active: true,
      published_at: null,
      created_at: now,
      updated_at: now,
    };
    await db.collection<IStringIdDoc>("agents").insertOne(doc);
    return docToAgent(doc as WithId<IStringIdDoc>);
  }

  async update(
    tenantId: string,
    id: string,
    data: IUpdateAgentData,
  ): Promise<IAgent | null> {
    const db = await this.getDb(tenantId);
    const setFields: Document = { updated_at: new Date() };
    if (data.name !== undefined) setFields.name = data.name;
    if (data.description !== undefined) setFields.description = data.description;
    if (data.system_prompt !== undefined) {
      setFields.system_prompt = data.system_prompt;
    }
    if (data.model_config !== undefined) {
      setFields.model_config = data.model_config;
    }
    if (data.tools !== undefined) setFields.tools = data.tools;
    if (data.channels !== undefined) setFields.channels = data.channels;
    if (data.status !== undefined) setFields.status = data.status;
    if (data.is_active !== undefined) setFields.is_active = data.is_active;

    if (Object.keys(setFields).length > 1) {
      await db.collection<IStringIdDoc>("agents").updateOne(
        { _id: id, is_active: true },
        { $set: setFields },
      );
    }

    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const db = await this.getDb(tenantId);
    const result = await db.collection<IStringIdDoc>("agents").updateOne(
      { _id: id, is_active: true },
      { $set: { is_active: false, updated_at: new Date() } },
    );
    return result.modifiedCount > 0;
  }

  async publish(tenantId: string, id: string): Promise<IAgent | null> {
    const db = await this.getDb(tenantId);
    const result = await db.collection<IStringIdDoc>("agents").findOneAndUpdate(
      { _id: id, is_active: true },
      {
        $set: {
          status: "published",
          published_at: new Date(),
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return result ? docToAgent(result) : null;
  }

  async unpublish(tenantId: string, id: string): Promise<IAgent | null> {
    const db = await this.getDb(tenantId);
    const result = await db.collection<IStringIdDoc>("agents").findOneAndUpdate(
      { _id: id, is_active: true },
      {
        $set: {
          status: "draft",
          published_at: null,
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" },
    );
    return result ? docToAgent(result) : null;
  }
}
