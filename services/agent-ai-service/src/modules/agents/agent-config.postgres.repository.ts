import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { type VariableDeclaration } from "@yoizen/shared";
import { AgentAiTenantConnectionManager } from "../../providers/tenant-connection.manager";
import type {
  IAgentConfig,
  IAgentConfigRepository,
} from "./agent-config.repository.interface";

const AGENT_COLUMNS =
  "id, name, description, system_prompt, model_config, tools, enabled_tools, enabled_mcp_servers, channels, input_variables, output_variables, knowledge_base_ids, status, is_active, published_at, created_at, updated_at";

interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_config: Record<string, unknown>;
  tools: unknown[];
  enabled_tools: string[] | null;
  enabled_mcp_servers: string[] | null;
  channels: unknown[];
  input_variables: unknown[];
  output_variables: unknown[];
  knowledge_base_ids: string[] | null;
  status: "draft" | "published" | "archived";
  is_active: boolean;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function rowToConfig(row: AgentRow): IAgentConfig {
  const modelConfig = row.model_config ?? {};
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.system_prompt,
    modelConfig,
    tools: Array.isArray(row.tools) ? row.tools : [],
    enabledTools: Array.isArray(row.enabled_tools) ? row.enabled_tools : null,
    enabledMcpServers: Array.isArray(row.enabled_mcp_servers) ? row.enabled_mcp_servers : null,
    skills: (() => {
      const skills = (modelConfig as Record<string, unknown>).skills as unknown[] | undefined;
      const subagents = (modelConfig as Record<string, unknown>).subagents as unknown[] | undefined;
      if (skills && skills.length > 0) return skills;
      if (subagents && subagents.length > 0) return subagents;
      return [];
    })(),
    rules: Array.isArray((modelConfig as Record<string, unknown>).rules)
      ? ((modelConfig as Record<string, unknown>).rules as unknown[])
      : [],
    channels: Array.isArray(row.channels) ? row.channels : [],
    inputVariables: Array.isArray(row.input_variables) ? row.input_variables as VariableDeclaration[] : [],
    outputVariables: Array.isArray(row.output_variables) ? row.output_variables as VariableDeclaration[] : [],
    knowledgeBaseIds: (row.knowledge_base_ids as string[]) ?? [],
    status: row.status,
    isActive: row.is_active,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

@Injectable()
export class AgentConfigPostgresRepository implements IAgentConfigRepository {
  private readonly logger = new PinoLoggerService(
    AgentConfigPostgresRepository.name,
  );

  constructor(
    @Inject(AgentAiTenantConnectionManager)
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  async findById(
    tenantId: string,
    agentId: string,
  ): Promise<IAgentConfig | null> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const results = await sql<AgentRow[]>`
      SELECT ${sql.unsafe(AGENT_COLUMNS)}
      FROM agents
      WHERE id = ${agentId}
        AND is_active = true
        AND status = 'published'
      LIMIT 1
    `;
    const row = results[0] ?? null;
    return row ? rowToConfig(row) : null;
  }

  async findAll(tenantId: string): Promise<IAgentConfig[]> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const results = await sql<AgentRow[]>`
      SELECT ${sql.unsafe(AGENT_COLUMNS)}
      FROM agents
      WHERE is_active = true
        AND status = 'published'
      ORDER BY created_at DESC
    `;
    return results.map(rowToConfig);
  }

  async findByTenant(
    tenantId: string,
    options?: { status?: string },
  ): Promise<IAgentConfig[]> {
    const sql = await this.connectionManager.ensureSchema(tenantId);
    const statusFilter = options?.status ?? "published";
    const results = await sql<AgentRow[]>`
      SELECT ${sql.unsafe(AGENT_COLUMNS)}
      FROM agents
      WHERE is_active = true
        AND status = ${statusFilter}
      ORDER BY created_at DESC
    `;
    return results.map(rowToConfig);
  }
}
