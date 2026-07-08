import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import type { JsonValue } from "@yoizen/shared";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import type {
  IAgent,
  IAgentsRepository,
  IAgentVersion,
  ICreateAgentData,
  IFindAllAgentsOptions,
  ISemverPublishContext,
  IUpdateAgentData,
} from "./agents.repository.interface";
import { AGENT_ROW_COLUMNS } from "./agents-sql.constants";

@Injectable()
export class AgentsPostgresRepository
  extends TenantScopedPostgresRepository
  implements IAgentsRepository
{
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  /**
   * Lists agents with optional filters and pagination.
   */
  async findAll(
    tenantId: string,
    options: IFindAllAgentsOptions = {}
  ): Promise<{ agents: IAgent[]; total: number }> {
    const sql = await this.getSql(tenantId);
    const {
      status,
      is_active: isActiveFilter,
      limit = 20,
      offset = 0,
    } = options;

    /** When omitted, list only active rows (soft-delete default). */
    const isActiveEq = isActiveFilter === undefined ? true : isActiveFilter;

    // Get total count
    const countResult = status
      ? await sql<{ count: string | number }[]>`
      SELECT COUNT(*)::bigint AS count FROM agents
      WHERE is_active = ${isActiveEq} AND status = ${status}
    `
      : await sql<{ count: string | number }[]>`
      SELECT COUNT(*)::bigint AS count FROM agents
      WHERE is_active = ${isActiveEq}
    `;
    const total = Number(countResult[0].count);

    // Get agents with pagination
    const agents = status
      ? await sql<IAgent[]>`
      SELECT ${sql.unsafe(AGENT_ROW_COLUMNS)}
      FROM agents
      WHERE is_active = ${isActiveEq} AND status = ${status}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `
      : await sql<IAgent[]>`
      SELECT ${sql.unsafe(AGENT_ROW_COLUMNS)}
      FROM agents
      WHERE is_active = ${isActiveEq}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return { agents, total };
  }

  /**
   * Finds an agent by ID.
   */
  async findById(tenantId: string, id: string): Promise<IAgent | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IAgent[]>`
      SELECT ${sql.unsafe(AGENT_ROW_COLUMNS)}
      FROM agents
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Creates a new agent.
   */
  async create(tenantId: string, data: ICreateAgentData): Promise<IAgent> {
    const sql = await this.getSql(tenantId);
    const agentId = randomUUID();

    const results = await sql<IAgent[]>`
      INSERT INTO agents (
        id,
        name,
        description,
        system_prompt,
        model_config,
        tools,
        channels,
        knowledge_base_ids,
        input_variables,
        output_variables,
        status,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        ${agentId},
        ${data.name},
        ${data.description ?? null},
        ${data.system_prompt},
        ${sql.json((data.model_config ?? {}) as JsonValue)},
        ${sql.json((data.tools ?? []) as JsonValue)},
        ${sql.json((data.channels ?? []) as JsonValue)},
        ${sql.json((data.knowledge_base_ids ?? []) as JsonValue)},
        ${sql.json((data.input_variables ?? []) as JsonValue)},
        ${sql.json((data.output_variables ?? []) as JsonValue)},
        'draft',
        true,
        NOW(),
        NOW()
      )
      RETURNING ${sql.unsafe(AGENT_ROW_COLUMNS)}
    `;

    return results[0];
  }

  /**
   * Updates an existing agent.
   */
  async update(
    tenantId: string,
    id: string,
    data: IUpdateAgentData
  ): Promise<IAgent | null> {
    const sql = await this.getSql(tenantId);

    if (data.name !== undefined) {
      await sql`UPDATE agents SET name = ${data.name}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.description !== undefined) {
      await sql`UPDATE agents SET description = ${data.description}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.system_prompt !== undefined) {
      await sql`UPDATE agents SET system_prompt = ${data.system_prompt}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.model_config !== undefined) {
      await sql`UPDATE agents SET model_config = ${sql.json(data.model_config as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.tools !== undefined) {
      await sql`UPDATE agents SET tools = ${sql.json(data.tools as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.enabled_tools !== undefined) {
      await sql`UPDATE agents SET enabled_tools = ${sql.json(data.enabled_tools as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.enabled_mcp_servers !== undefined) {
      await sql`UPDATE agents SET enabled_mcp_servers = ${sql.json(data.enabled_mcp_servers as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.enabled_mcp_tools !== undefined) {
      await sql`UPDATE agents SET enabled_mcp_tools = ${sql.json(data.enabled_mcp_tools as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.tool_description_overrides !== undefined) {
      await sql`UPDATE agents SET tool_description_overrides = ${sql.json(data.tool_description_overrides as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.channels !== undefined) {
      await sql`UPDATE agents SET channels = ${sql.json(data.channels as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.knowledge_base_ids !== undefined) {
      await sql`UPDATE agents SET knowledge_base_ids = ${sql.json(data.knowledge_base_ids as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.input_variables !== undefined) {
      await sql`UPDATE agents SET input_variables = ${sql.json(data.input_variables as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.output_variables !== undefined) {
      await sql`UPDATE agents SET output_variables = ${sql.json(data.output_variables as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.status !== undefined) {
      await sql`UPDATE agents SET status = ${data.status}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }
    if (data.is_active !== undefined) {
      await sql`UPDATE agents SET is_active = ${data.is_active}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
    }

    const results = await sql<IAgent[]>`
      SELECT ${sql.unsafe(AGENT_ROW_COLUMNS)}
      FROM agents
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Soft-deletes an agent.
   */
  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IAgent[]>`
      UPDATE agents
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING id
    `;

    return results.length > 0;
  }

  /**
   * Publishes an agent (sets status to `published`, `published_at`,
   * and snapshots current state into `published_config`).
   * Also creates a version history entry in `agent_versions`.
   */
  async publish(
    tenantId: string,
    id: string,
    context?: ISemverPublishContext
  ): Promise<IAgent | null> {
    const sql = await this.getSql(tenantId);

    // Read current state to build the snapshot
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

    const results = await sql<IAgent[]>`
      UPDATE agents
      SET 
        status = 'published',
        published_at = NOW(),
        published_config = ${sql.json(snapshot as JsonValue)},
        ${context?.publishedBy ? sql`published_by = ${context.publishedBy},` : sql``}
        updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING ${sql.unsafe(AGENT_ROW_COLUMNS)}
    `;

    if (results[0]) {
      // Create version history entry
      const versionCount = await sql<{ count: string }[]>`
        SELECT COUNT(*)::bigint AS count FROM agent_versions WHERE agent_id = ${id}
      `;
      const fallbackVersion = Number(versionCount[0].count) + 1;
      const versionNumber = context?.versionNumber ?? fallbackVersion;

      await sql`
        INSERT INTO agent_versions (
          agent_id, version_number, snapshot, published_at,
          semver_major, semver_minor, semver_patch, semver_label,
          bump_type, diff, published_by
        )
        VALUES (
          ${id}, ${versionNumber}, ${sql.json(snapshot as JsonValue)}, NOW(),
          ${context?.semver.major ?? null}, ${context?.semver.minor ?? null},
          ${context?.semver.patch ?? null}, ${context?.semver.label ?? null},
          ${context?.semver.bumpType ?? null},
          ${context ? sql.json(context.diff as unknown as JsonValue) : null},
          ${context?.publishedBy ?? null}
        )
      `;
    }

    return results[0] ?? null;
  }

  /**
   * Unpublishes an agent (sets status to `draft` and clears `published_at`).
   */
  async unpublish(tenantId: string, id: string): Promise<IAgent | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IAgent[]>`
      UPDATE agents
      SET 
        status = 'draft',
        published_at = NULL,
        updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING ${sql.unsafe(AGENT_ROW_COLUMNS)}
    `;

    return results[0] ?? null;
  }

  /**
   * Reverts the draft row to the last published snapshot.
   * Restores all configurable fields from `published_config`.
   */
  async revertToPublished(
    tenantId: string,
    id: string
  ): Promise<IAgent | null> {
    const sql = await this.getSql(tenantId);

    // Read current agent to get the published snapshot
    const current = await this.findById(tenantId, id);
    if (!current || !current.published_config) {
      return null;
    }

    const s = current.published_config;

    // Extract and type-narrow snapshot fields
    const name = (s.name as string) ?? current.name;
    const description = (s.description as string | null) ?? null;
    const systemPrompt = (s.system_prompt as string) ?? current.system_prompt;
    const modelConfig = (s.model_config as Record<string, unknown>) ?? {};
    const tools = (s.tools as unknown[]) ?? [];
    const enabledTools = (s.enabled_tools as string[] | null) ?? null;
    const enabledMcpServers =
      (s.enabled_mcp_servers as string[] | null) ?? null;
    const enabledMcpTools =
      (s.enabled_mcp_tools as Record<string, string[] | null> | null) ?? null;
    const toolDescriptionOverrides =
      (s.tool_description_overrides as Record<string, string> | null) ?? null;
    const channels = (s.channels as unknown[]) ?? [];
    const knowledgeBaseIds = (s.knowledge_base_ids as string[]) ?? [];
    const inputVariables = (s.input_variables as unknown[]) ?? [];
    const outputVariables = (s.output_variables as unknown[]) ?? [];

    const results = await sql<IAgent[]>`
      UPDATE agents
      SET
        name = ${name},
        description = ${description},
        system_prompt = ${systemPrompt},
        model_config = ${sql.json(modelConfig as JsonValue)},
        tools = ${sql.json(tools as JsonValue)},
        enabled_tools = ${sql.json(enabledTools as JsonValue)},
        enabled_mcp_servers = ${sql.json(enabledMcpServers as JsonValue)},
        enabled_mcp_tools = ${sql.json(enabledMcpTools as JsonValue)},
        tool_description_overrides = ${sql.json(toolDescriptionOverrides as JsonValue)},
        channels = ${sql.json(channels as JsonValue)},
        knowledge_base_ids = ${sql.json(knowledgeBaseIds as JsonValue)},
        input_variables = ${sql.json(inputVariables as JsonValue)},
        output_variables = ${sql.json(outputVariables as JsonValue)},
        updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING ${sql.unsafe(AGENT_ROW_COLUMNS)}
    `;

    return results[0] ?? null;
  }

  /**
   * Lists all version history entries for an agent.
   */
  async listVersions(
    tenantId: string,
    agentId: string
  ): Promise<IAgentVersion[]> {
    const sql = await this.getSql(tenantId);
    return sql<IAgentVersion[]>`
      SELECT id, agent_id, version_number, snapshot, published_at, created_at,
             semver_major, semver_minor, semver_patch, semver_label,
             bump_type, diff, published_by
      FROM agent_versions
      WHERE agent_id = ${agentId}
      ORDER BY version_number DESC
    `;
  }

  /**
   * Rolls back an agent to a specific version by restoring fields from the version snapshot.
   */
  async rollbackToVersion(
    tenantId: string,
    agentId: string,
    versionId: string
  ): Promise<IAgent | null> {
    const sql = await this.getSql(tenantId);

    // Get the version snapshot
    const versions = await sql<IAgentVersion[]>`
      SELECT snapshot FROM agent_versions
      WHERE id = ${versionId} AND agent_id = ${agentId}
      LIMIT 1
    `;
    if (!versions[0]) {
      return null;
    }

    const snapshot = versions[0].snapshot;

    // Extract and type-narrow snapshot fields
    const name = (snapshot.name as string) ?? "";
    const description = (snapshot.description as string | null) ?? null;
    const systemPrompt = (snapshot.system_prompt as string) ?? "";
    const modelConfig =
      (snapshot.model_config as Record<string, unknown>) ?? {};
    const tools = (snapshot.tools as unknown[]) ?? [];
    const enabledTools = (snapshot.enabled_tools as string[] | null) ?? null;
    const enabledMcpServers =
      (snapshot.enabled_mcp_servers as string[] | null) ?? null;
    const enabledMcpTools =
      (snapshot.enabled_mcp_tools as Record<string, string[] | null> | null) ??
      null;
    const toolDescriptionOverrides =
      (snapshot.tool_description_overrides as Record<string, string> | null) ??
      null;
    const channels = (snapshot.channels as unknown[]) ?? [];
    const knowledgeBaseIds = (snapshot.knowledge_base_ids as string[]) ?? [];
    const inputVariables = (snapshot.input_variables as unknown[]) ?? [];
    const outputVariables = (snapshot.output_variables as unknown[]) ?? [];

    // Apply snapshot to the agent (restore draft from version)
    const results = await sql<IAgent[]>`
      UPDATE agents SET
        name = ${name},
        description = ${description},
        system_prompt = ${systemPrompt},
        model_config = ${sql.json(modelConfig as JsonValue)},
        tools = ${sql.json(tools as JsonValue)},
        enabled_tools = ${sql.json(enabledTools as JsonValue)},
        enabled_mcp_servers = ${sql.json(enabledMcpServers as JsonValue)},
        enabled_mcp_tools = ${sql.json(enabledMcpTools as JsonValue)},
        tool_description_overrides = ${sql.json(toolDescriptionOverrides as JsonValue)},
        channels = ${sql.json(channels as JsonValue)},
        knowledge_base_ids = ${sql.json(knowledgeBaseIds as JsonValue)},
        input_variables = ${sql.json(inputVariables as JsonValue)},
        output_variables = ${sql.json(outputVariables as JsonValue)},
        updated_at = NOW()
      WHERE id = ${agentId} AND is_active = true
      RETURNING ${sql.unsafe(AGENT_ROW_COLUMNS)}
    `;
    return results[0] ?? null;
  }

  /**
   * Deletes a specific version history entry.
   */
  async deleteVersion(
    tenantId: string,
    agentId: string,
    versionId: string
  ): Promise<boolean> {
    const sql = await this.getSql(tenantId);
    const results = await sql`
      DELETE FROM agent_versions
      WHERE id = ${versionId} AND agent_id = ${agentId}
      RETURNING id
    `;
    return results.length > 0;
  }
}
