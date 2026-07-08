import { Injectable } from "@nestjs/common";
import type {
  Db,
  IStringIdDoc,
  TenantMongoConnectionManager,
} from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import type { VariableDeclaration } from "@yoizen/shared";
import type {
  IAgentConfig,
  IAgentConfigRepository,
} from "./agent-config.repository.interface";

function docToConfig(doc: IStringIdDoc & { _id: unknown }): IAgentConfig {
  const modelConfig = (doc.model_config as Record<string, unknown>) ?? {};
  return {
    id: String(doc._id),
    name: String(doc.name ?? ""),
    description:
      doc.description === null || doc.description === undefined
        ? null
        : String(doc.description),
    systemPrompt: String(doc.system_prompt ?? ""),
    modelConfig,
    tools: Array.isArray(doc.tools) ? doc.tools : [],
    enabledTools: Array.isArray(doc.enabled_tools) ? doc.enabled_tools : null,
    enabledMcpServers: Array.isArray(doc.enabled_mcp_servers)
      ? (doc.enabled_mcp_servers as string[])
      : null,
    enabledMcpTools:
      doc.enabled_mcp_tools !== null &&
      doc.enabled_mcp_tools !== undefined &&
      typeof doc.enabled_mcp_tools === "object" &&
      !Array.isArray(doc.enabled_mcp_tools)
        ? (doc.enabled_mcp_tools as Record<string, string[] | null>)
        : null,
    toolDescriptionOverrides:
      doc.tool_description_overrides !== null &&
      doc.tool_description_overrides !== undefined &&
      typeof doc.tool_description_overrides === "object" &&
      !Array.isArray(doc.tool_description_overrides)
        ? (doc.tool_description_overrides as Record<string, string>)
        : null,
    skills: Array.isArray((modelConfig as Record<string, unknown>).skills)
      ? ((modelConfig as Record<string, unknown>).skills as unknown[])
      : [],
    rules: Array.isArray((modelConfig as Record<string, unknown>).rules)
      ? ((modelConfig as Record<string, unknown>).rules as unknown[])
      : [],
    channels: Array.isArray(doc.channels) ? doc.channels : [],
    inputVariables: Array.isArray(doc.input_variables)
      ? (doc.input_variables as VariableDeclaration[])
      : [],
    outputVariables: Array.isArray(doc.output_variables)
      ? (doc.output_variables as VariableDeclaration[])
      : [],
    knowledgeBaseIds: Array.isArray(doc.knowledge_base_ids)
      ? (doc.knowledge_base_ids as string[])
      : [],
    status: String(doc.status ?? "draft") as IAgentConfig["status"],
    isActive: Boolean(doc.is_active ?? true),
    publishedAt:
      doc.published_at instanceof Date
        ? doc.published_at
        : doc.published_at
          ? new Date(String(doc.published_at))
          : null,
    createdAt:
      doc.created_at instanceof Date
        ? doc.created_at
        : new Date(String(doc.created_at ?? Date.now())),
    updatedAt:
      doc.updated_at instanceof Date
        ? doc.updated_at
        : new Date(String(doc.updated_at ?? Date.now())),
  };
}

@Injectable()
export class AgentConfigMongoRepository implements IAgentConfigRepository {
  private readonly logger = new PinoLoggerService(
    AgentConfigMongoRepository.name
  );

  constructor(
    private readonly connectionManager: TenantMongoConnectionManager
  ) {}

  private async getCollection(tenantId: string) {
    const db: Db = await this.connectionManager.ensureSchema(tenantId);
    return db.collection<IStringIdDoc>("agents");
  }

  async findById(
    tenantId: string,
    agentId: string
  ): Promise<IAgentConfig | null> {
    const col = await this.getCollection(tenantId);
    const doc = await col.findOne({
      _id: agentId,
      is_active: true,
      status: "published",
    });
    return doc ? docToConfig(doc) : null;
  }

  async findAll(tenantId: string): Promise<IAgentConfig[]> {
    const col = await this.getCollection(tenantId);
    const docs = await col
      .find({ is_active: true, status: "published" })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map(docToConfig);
  }

  async findByTenant(
    tenantId: string,
    options?: { status?: string }
  ): Promise<IAgentConfig[]> {
    const col = await this.getCollection(tenantId);
    const filter: Record<string, unknown> = { is_active: true };
    if (options?.status) {
      filter.status = options.status;
    } else {
      filter.status = "published";
    }
    const docs = await col.find(filter).sort({ created_at: -1 }).toArray();
    return docs.map(docToConfig);
  }
}
