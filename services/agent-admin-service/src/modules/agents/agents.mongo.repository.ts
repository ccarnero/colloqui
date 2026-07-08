import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  IStringIdDoc,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import type { Document, Filter, WithId } from "mongodb";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { TenantScopedMongoRepository } from "../../providers/tenant-scoped.repository";
import type {
  IAgent,
  IAgentsRepository,
  IAgentVersion,
  ICreateAgentData,
  IFindAllAgentsOptions,
  ISemverPublishContext,
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
    enabled_tools: Array.isArray(doc.enabled_tools) ? doc.enabled_tools : null,
    enabled_mcp_servers: Array.isArray(doc.enabled_mcp_servers)
      ? doc.enabled_mcp_servers
      : null,
    enabled_mcp_tools:
      doc.enabled_mcp_tools !== null &&
      doc.enabled_mcp_tools !== undefined &&
      typeof doc.enabled_mcp_tools === "object" &&
      !Array.isArray(doc.enabled_mcp_tools)
        ? (doc.enabled_mcp_tools as Record<string, string[] | null>)
        : null,
    tool_description_overrides:
      doc.tool_description_overrides !== null &&
      doc.tool_description_overrides !== undefined &&
      typeof doc.tool_description_overrides === "object" &&
      !Array.isArray(doc.tool_description_overrides)
        ? (doc.tool_description_overrides as Record<string, string>)
        : null,
    channels: Array.isArray(doc.channels) ? doc.channels : [],
    knowledge_base_ids: Array.isArray(doc.knowledge_base_ids)
      ? doc.knowledge_base_ids.map(String)
      : [],
    input_variables: Array.isArray(doc.input_variables)
      ? doc.input_variables
      : [],
    output_variables: Array.isArray(doc.output_variables)
      ? doc.output_variables
      : [],
    status: String(doc.status ?? "draft") as IAgent["status"],
    is_active: Boolean(doc.is_active ?? true),
    published_at:
      doc.published_at instanceof Date
        ? doc.published_at
        : doc.published_at
          ? new Date(String(doc.published_at))
          : null,
    published_config:
      doc.published_config !== null &&
      doc.published_config !== undefined &&
      typeof doc.published_config === "object" &&
      !Array.isArray(doc.published_config)
        ? (doc.published_config as Record<string, unknown>)
        : null,
    created_at:
      doc.created_at instanceof Date
        ? doc.created_at
        : new Date(String(doc.created_at ?? Date.now())),
    updated_at:
      doc.updated_at instanceof Date
        ? doc.updated_at
        : new Date(String(doc.updated_at ?? Date.now())),
    published_by:
      doc.published_by !== null && doc.published_by !== undefined
        ? String(doc.published_by)
        : null,
  };
}

@Injectable()
export class AgentsMongoRepository
  extends TenantScopedMongoRepository
  implements IAgentsRepository
{
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantMongoConnectionManager,
  ) {
    super(connectionManager);
  }

  async findAll(
    tenantId: string,
    options: IFindAllAgentsOptions = {}
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
    if (status) {
      filter.status = status;
    }

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
      knowledge_base_ids: data.knowledge_base_ids ?? [],
      input_variables: data.input_variables ?? [],
      output_variables: data.output_variables ?? [],
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
    data: IUpdateAgentData
  ): Promise<IAgent | null> {
    const db = await this.getDb(tenantId);
    const setFields: Document = { updated_at: new Date() };
    if (data.name !== undefined) {
      setFields.name = data.name;
    }
    if (data.description !== undefined) {
      setFields.description = data.description;
    }
    if (data.system_prompt !== undefined) {
      setFields.system_prompt = data.system_prompt;
    }
    if (data.model_config !== undefined) {
      setFields.model_config = data.model_config;
    }
    if (data.tools !== undefined) {
      setFields.tools = data.tools;
    }
    if (data.enabled_tools !== undefined) {
      setFields.enabled_tools = data.enabled_tools;
    }
    if (data.enabled_mcp_servers !== undefined) {
      setFields.enabled_mcp_servers = data.enabled_mcp_servers;
    }
    if (data.enabled_mcp_tools !== undefined) {
      setFields.enabled_mcp_tools = data.enabled_mcp_tools;
    }
    if (data.tool_description_overrides !== undefined) {
      setFields.tool_description_overrides = data.tool_description_overrides;
    }
    if (data.channels !== undefined) {
      setFields.channels = data.channels;
    }
    if (data.knowledge_base_ids !== undefined) {
      setFields.knowledge_base_ids = data.knowledge_base_ids;
    }
    if (data.input_variables !== undefined) {
      setFields.input_variables = data.input_variables;
    }
    if (data.output_variables !== undefined) {
      setFields.output_variables = data.output_variables;
    }
    if (data.status !== undefined) {
      setFields.status = data.status;
    }
    if (data.is_active !== undefined) {
      setFields.is_active = data.is_active;
    }

    if (Object.keys(setFields).length > 1) {
      await db
        .collection<IStringIdDoc>("agents")
        .updateOne({ _id: id, is_active: true }, { $set: setFields });
    }

    return this.findById(tenantId, id);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const db = await this.getDb(tenantId);
    const result = await db
      .collection<IStringIdDoc>("agents")
      .updateOne(
        { _id: id, is_active: true },
        { $set: { is_active: false, updated_at: new Date() } }
      );
    return result.modifiedCount > 0;
  }

  async publish(
    tenantId: string,
    id: string,
    context?: ISemverPublishContext
  ): Promise<IAgent | null> {
    const current = await this.findById(tenantId, id);
    if (!current) {
      return null;
    }

    const snapshot = {
      name: current.name,
      description: current.description,
      system_prompt: current.system_prompt,
      model_config: current.model_config,
      tools: current.tools,
      enabled_tools: current.enabled_tools,
      enabled_mcp_servers: current.enabled_mcp_servers,
      enabled_mcp_tools: current.enabled_mcp_tools,
      tool_description_overrides: current.tool_description_overrides,
      channels: current.channels,
      knowledge_base_ids: current.knowledge_base_ids,
      input_variables: current.input_variables,
      output_variables: current.output_variables,
    };

    const db = await this.getDb(tenantId);
    const result = await db.collection<IStringIdDoc>("agents").findOneAndUpdate(
      { _id: id, is_active: true },
      {
        $set: {
          status: "published",
          published_at: new Date(),
          published_config: snapshot,
          ...(context?.publishedBy && { published_by: context.publishedBy }),
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" }
    );

    if (result) {
      // Create version history entry
      const versionsCol = db.collection<IStringIdDoc>("agent_versions");
      const versionCount = await versionsCol.countDocuments({ agent_id: id });
      await versionsCol.insertOne({
        _id: randomUUID(),
        agent_id: id,
        version_number: context?.versionNumber ?? versionCount + 1,
        snapshot,
        published_at: new Date(),
        created_at: new Date(),
        ...(context && {
          semver_major: context.semver.major,
          semver_minor: context.semver.minor,
          semver_patch: context.semver.patch,
          semver_label: context.semver.label,
          bump_type: context.semver.bumpType,
          diff: context.diff,
          published_by: context.publishedBy,
        }),
      });
    }

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
      { returnDocument: "after" }
    );
    return result ? docToAgent(result) : null;
  }

  async revertToPublished(
    tenantId: string,
    id: string
  ): Promise<IAgent | null> {
    const current = await this.findById(tenantId, id);
    if (!current || !current.published_config) {
      return null;
    }

    const snapshot = current.published_config;

    const db = await this.getDb(tenantId);
    const result = await db.collection<IStringIdDoc>("agents").findOneAndUpdate(
      { _id: id, is_active: true },
      {
        $set: {
          name: snapshot.name ?? current.name,
          description: snapshot.description ?? null,
          system_prompt: snapshot.system_prompt ?? current.system_prompt,
          model_config: snapshot.model_config ?? {},
          tools: snapshot.tools ?? [],
          enabled_tools: snapshot.enabled_tools ?? null,
          enabled_mcp_servers: snapshot.enabled_mcp_servers ?? null,
          enabled_mcp_tools: snapshot.enabled_mcp_tools ?? null,
          tool_description_overrides:
            snapshot.tool_description_overrides ?? null,
          channels: snapshot.channels ?? [],
          knowledge_base_ids: snapshot.knowledge_base_ids ?? [],
          input_variables: snapshot.input_variables ?? [],
          output_variables: snapshot.output_variables ?? [],
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" }
    );
    return result ? docToAgent(result) : null;
  }

  async listVersions(
    tenantId: string,
    agentId: string
  ): Promise<IAgentVersion[]> {
    const db = await this.getDb(tenantId);
    const docs = await db
      .collection<IStringIdDoc>("agent_versions")
      .find({ agent_id: agentId })
      .sort({ version_number: -1 })
      .toArray();

    return docs.map((doc) => ({
      id: String(doc._id),
      agent_id: String(doc.agent_id),
      version_number: Number(doc.version_number),
      snapshot:
        doc.snapshot !== null &&
        doc.snapshot !== undefined &&
        typeof doc.snapshot === "object" &&
        !Array.isArray(doc.snapshot)
          ? (doc.snapshot as Record<string, unknown>)
          : {},
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
    }));
  }

  async rollbackToVersion(
    tenantId: string,
    agentId: string,
    versionId: string
  ): Promise<IAgent | null> {
    const db = await this.getDb(tenantId);
    const versionDoc = await db
      .collection<IStringIdDoc>("agent_versions")
      .findOne({
        _id: versionId,
        agent_id: agentId,
      });
    if (!versionDoc) {
      return null;
    }

    const snapshot = (versionDoc.snapshot as Record<string, unknown>) ?? {};

    const result = await db.collection<IStringIdDoc>("agents").findOneAndUpdate(
      { _id: agentId, is_active: true },
      {
        $set: {
          name: (snapshot.name as string) ?? "",
          description: (snapshot.description as string | null) ?? null,
          system_prompt: (snapshot.system_prompt as string) ?? "",
          model_config:
            (snapshot.model_config as Record<string, unknown>) ?? {},
          tools: (snapshot.tools as unknown[]) ?? [],
          enabled_tools: (snapshot.enabled_tools as string[] | null) ?? null,
          enabled_mcp_servers:
            (snapshot.enabled_mcp_servers as string[] | null) ?? null,
          enabled_mcp_tools:
            (snapshot.enabled_mcp_tools as Record<
              string,
              string[] | null
            > | null) ?? null,
          tool_description_overrides:
            (snapshot.tool_description_overrides as Record<
              string,
              string
            > | null) ?? null,
          channels: (snapshot.channels as unknown[]) ?? [],
          knowledge_base_ids: (snapshot.knowledge_base_ids as string[]) ?? [],
          input_variables: (snapshot.input_variables as unknown[]) ?? [],
          output_variables: (snapshot.output_variables as unknown[]) ?? [],
          updated_at: new Date(),
        },
      },
      { returnDocument: "after" }
    );
    return result ? docToAgent(result) : null;
  }

  async deleteVersion(
    tenantId: string,
    agentId: string,
    versionId: string
  ): Promise<boolean> {
    const db = await this.getDb(tenantId);
    const result = await db
      .collection<IStringIdDoc>("agent_versions")
      .deleteOne({
        _id: versionId,
        agent_id: agentId,
      });
    return result.deletedCount > 0;
  }
}
