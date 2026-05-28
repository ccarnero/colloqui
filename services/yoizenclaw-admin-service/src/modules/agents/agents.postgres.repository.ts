import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "@yoizen/shared";
import type { TenantConnectionManager } from "@yoizen/database";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { AGENT_ROW_COLUMNS } from "./agents-sql.constants";
import type {
  IAgent,
  IAgentsRepository,
  ICreateAgentData,
  IFindAllAgentsOptions,
  IUpdateAgentData,
} from "./agents.repository.interface";

@Injectable()
export class AgentsPostgresRepository extends TenantScopedPostgresRepository implements IAgentsRepository {
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
    options: IFindAllAgentsOptions = {},
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
    data: IUpdateAgentData,
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
    if (data.channels !== undefined) {
      await sql`UPDATE agents SET channels = ${sql.json(data.channels as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND is_active = true`;
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
   * Publishes an agent (sets status to `published` and `published_at`).
   */
  async publish(tenantId: string, id: string): Promise<IAgent | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IAgent[]>`
      UPDATE agents
      SET 
        status = 'published',
        published_at = NOW(),
        updated_at = NOW()
      WHERE id = ${id} AND is_active = true
      RETURNING ${sql.unsafe(AGENT_ROW_COLUMNS)}
    `;

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
}
