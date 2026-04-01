import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { TenantConnectionManager, type Sql } from '../../providers/tenant-connection-manager';

export interface IAgent {
  id: string;
  name: string;
  description: string | null;
  system_prompt: string;
  model_config: Record<string, unknown>;
  tools: unknown[];
  channels: unknown[];
  status: 'draft' | 'published' | 'archived';
  is_active: boolean;
  published_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface ICreateAgentData {
  name: string;
  description?: string;
  system_prompt: string;
  model_config?: Record<string, unknown>;
  tools?: unknown[];
  channels?: unknown[];
}

export interface UpdateAgentData {
  name?: string;
  description?: string;
  system_prompt?: string;
  model_config?: Record<string, unknown>;
  tools?: unknown[];
  channels?: unknown[];
  status?: 'draft' | 'published' | 'archived';
  is_active?: boolean;
}

export interface IFindAllOptions {
  status?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

// Helper type for JSON values compatible with postgres.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonValue = any;

@Injectable()
export class AgentsRepository {
  constructor(
    private readonly connectionManager: TenantConnectionManager,
  ) {}

  private async getSql(tenantId: string): Promise<Sql> {
    await this.connectionManager.ensureSchema(tenantId);
    return this.connectionManager.getConnection(tenantId);
  }

  /**
   * Lista todos los agents con filtros opcionales y paginación.
   */
  async findAll(
    tenantId: string,
    options: IFindAllOptions = {},
  ): Promise<{ agents: IAgent[]; total: number }> {
    const sql = await this.getSql(tenantId);
    const { status, limit = 20, offset = 0 } = options;

    // Build where clause with parameterized conditions
    const conditions: string[] = ['is_active = true'];
    const params: (string | boolean | number)[] = [];
    let paramIndex = 1;

    if (status) {
      conditions.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;
    }

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countResult = await sql<{ count: number }[]>`
      SELECT COUNT(*) as count FROM agents WHERE ${sql.unsafe(whereClause)}
    `;
    const total = Number(countResult[0].count);

    // Get agents with pagination
    const agents = await sql<IAgent[]>`
      SELECT 
        id,
        name,
        description,
        system_prompt,
        model_config,
        tools,
        channels,
        status,
        is_active,
        published_at,
        created_at,
        updated_at
      FROM agents
      WHERE ${sql.unsafe(whereClause)}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return { agents, total };
  }

  /**
   * Busca un agent por su ID.
   */
  async findById(tenantId: string, id: string): Promise<IAgent | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IAgent[]>`
      SELECT 
        id,
        name,
        description,
        system_prompt,
        model_config,
        tools,
        channels,
        status,
        is_active,
        published_at,
        created_at,
        updated_at
      FROM agents
      WHERE id = ${id} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  /**
   * Crea un nuevo agent.
   */
  async create(
    tenantId: string,
    data: ICreateAgentData,
  ): Promise<IAgent> {
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
      RETURNING 
        id,
        name,
        description,
        system_prompt,
        model_config,
        tools,
        channels,
        status,
        is_active,
        published_at,
        created_at,
        updated_at
    `;

    return results[0];
  }

  /**
   * Actualiza un agent existente.
   */
  async update(
    tenantId: string,
    id: string,
    data: UpdateAgentData,
  ): Promise<IAgent | null> {
    const sql = await this.getSql(tenantId);

    // Build dynamic update using sql.assignment for proper parameterization
    const updates: string[] = ['updated_at = NOW()'];
    
    if (data.name !== undefined) {
      updates.push(sql`name = ${data.name}` as unknown as string);
    }
    if (data.description !== undefined) {
      updates.push(sql`description = ${data.description}` as unknown as string);
    }
    if (data.system_prompt !== undefined) {
      updates.push(sql`system_prompt = ${data.system_prompt}` as unknown as string);
    }
    if (data.model_config !== undefined) {
      updates.push(sql`model_config = ${sql.json(data.model_config as JsonValue)}` as unknown as string);
    }
    if (data.tools !== undefined) {
      updates.push(sql`tools = ${sql.json(data.tools as JsonValue)}` as unknown as string);
    }
    if (data.channels !== undefined) {
      updates.push(sql`channels = ${sql.json(data.channels as JsonValue)}` as unknown as string);
    }
    if (data.status !== undefined) {
      updates.push(sql`status = ${data.status}` as unknown as string);
    }
    if (data.is_active !== undefined) {
      updates.push(sql`is_active = ${data.is_active}` as unknown as string);
    }

    const setClause = updates.join(', ');

    const results = await sql<IAgent[]>`
      UPDATE agents
      SET ${sql.unsafe(setClause)}
      WHERE id = ${id} AND is_active = true
      RETURNING 
        id,
        name,
        description,
        system_prompt,
        model_config,
        tools,
        channels,
        status,
        is_active,
        published_at,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }

  /**
   * Elimina (soft delete) un agent.
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
   * Publica un agent (cambia status a 'published' y setea published_at).
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
      RETURNING 
        id,
        name,
        description,
        system_prompt,
        model_config,
        tools,
        channels,
        status,
        is_active,
        published_at,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }

  /**
   * Despublica un agent (cambia status a 'draft' y limpia published_at).
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
      RETURNING 
        id,
        name,
        description,
        system_prompt,
        model_config,
        tools,
        channels,
        status,
        is_active,
        published_at,
        created_at,
        updated_at
    `;

    return results[0] ?? null;
  }
}
