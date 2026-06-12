import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { TenantConnectionManager } from "@yoizen/database";
import { TenantScopedPostgresRepository } from "../../../providers/tenant-scoped.repository";
import { AgentMemoryTenantConnectionManager } from "../../../providers/tenant-connection-manager";
import type {
  IMemory,
  IMemoryRepository,
  ICreateMemoryData,
  IUpdateMemoryData,
  IMemoryQueryOptions,
} from "../domain/memory.repository.interface";
import { MemoryScope, MemoryStatus } from "../domain/enums";
import type { JsonValue } from "@yoizen/shared";
import { agentMemoryServiceConfig } from "../../../config";

const ftsLanguage = agentMemoryServiceConfig.ftsLanguage;

const MEMORY_COLUMNS = [
  'id',
  'tenant_id AS "tenantId"',
  'user_id AS "userId"',
  'session_id AS "sessionId"',
  'scope',
  'kind',
  'status',
  'title',
  'content',
  'metadata',
  'topic_key AS "topicKey"',
  'expires_at AS "expiresAt"',
  'created_at AS "createdAt"',
  'updated_at AS "updatedAt"',
].join(", ");

@Injectable()
export class MemoryPostgresRepository
  extends TenantScopedPostgresRepository
  implements IMemoryRepository
{
  constructor(
    @Inject(AgentMemoryTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  async findAll(
    tenantId: string,
    options: IMemoryQueryOptions = {},
  ): Promise<{ items: IMemory[]; total: number }> {
    const sql = await this.getSql(tenantId);
    const {
      scope,
      kind,
      status,
      search,
      limit = 20,
      offset = 0,
      includeExpired,
      sessionId,
      userId,
    } = options;

    const statusEq = status ?? MemoryStatus.ACTIVE;

    let where = sql`WHERE tenant_id = ${tenantId} AND status = ${statusEq}`;
    if (sessionId) where = sql`${where} AND session_id = ${sessionId}`;
    if (scope) where = sql`${where} AND scope = ${scope}`;
    if (kind) where = sql`${where} AND kind = ${kind}`;
    if (userId) where = sql`${where} AND user_id = ${userId}`;
    if (!includeExpired)
      where = sql`${where} AND (expires_at IS NULL OR expires_at > NOW())`;
    if (search)
      where = sql`${where} AND search_vector @@ websearch_to_tsquery(${ftsLanguage}::regconfig, ${search})`;

    const results = await sql<
      Array<IMemory & { total: string }>
    >`
      SELECT ${sql.unsafe(MEMORY_COLUMNS)}, COUNT(*) OVER() AS total
      FROM memories
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const total =
      results.length > 0 ? parseInt(results[0].total, 10) : 0;
    const items = results.map(({ total: _, ...memory }) => memory) as IMemory[];

    return { items, total };
  }

  async findById(tenantId: string, id: string): Promise<IMemory | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IMemory[]>`
      SELECT ${sql.unsafe(MEMORY_COLUMNS)}
      FROM memories
      WHERE id = ${id} AND tenant_id = ${tenantId} AND status != ${MemoryStatus.ARCHIVED}
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  async findByTopicKey(
    tenantId: string,
    topicKey: string,
    scope?: MemoryScope,
  ): Promise<IMemory | null> {
    const sql = await this.getSql(tenantId);

    const results = scope
      ? await sql<IMemory[]>`
          SELECT ${sql.unsafe(MEMORY_COLUMNS)}
          FROM memories
          WHERE tenant_id = ${tenantId} AND topic_key = ${topicKey} AND scope = ${scope}
          ORDER BY created_at DESC
          LIMIT 1
        `
      : await sql<IMemory[]>`
          SELECT ${sql.unsafe(MEMORY_COLUMNS)}
          FROM memories
          WHERE tenant_id = ${tenantId} AND topic_key = ${topicKey}
          ORDER BY created_at DESC
          LIMIT 1
        `;

    return results[0] ?? null;
  }

  async findTimeline(
    tenantId: string,
    filters: {
      sessionId?: string;
      userId?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<IMemory[]> {
    const sql = await this.getSql(tenantId);
    const { sessionId, userId, limit = 20, offset = 0 } = filters;

    let where = sql`WHERE tenant_id = ${tenantId}`;
    if (sessionId) where = sql`${where} AND session_id = ${sessionId}`;
    if (userId) where = sql`${where} AND user_id = ${userId}`;

    const results = await sql<IMemory[]>`
      SELECT ${sql.unsafe(MEMORY_COLUMNS)}
      FROM memories
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    return results;
  }

  async create(tenantId: string, data: ICreateMemoryData): Promise<IMemory> {
    const sql = await this.getSql(tenantId);
    const id = randomUUID();
    const expiresAt = data.ttl
      ? new Date(Date.now() + data.ttl * 1000)
      : null;

    const results = await sql<IMemory[]>`
      INSERT INTO memories (
        id,
        tenant_id,
        user_id,
        session_id,
        scope,
        kind,
        status,
        title,
        content,
        metadata,
        topic_key,
        expires_at,
        created_at,
        updated_at
      ) VALUES (
        ${id},
        ${tenantId},
        ${data.userId ?? null},
        ${data.sessionId ?? null},
        ${data.scope},
        ${data.kind},
        ${data.status ?? MemoryStatus.ACTIVE},
        ${data.title ?? null},
        ${data.content},
        ${sql.json((data.metadata ?? {}) as JsonValue)},
        ${data.topicKey ?? null},
        ${expiresAt},
        NOW(),
        NOW()
      )
      RETURNING ${sql.unsafe(MEMORY_COLUMNS)}
    `;

    return results[0];
  }

  async update(
    tenantId: string,
    id: string,
    data: IUpdateMemoryData,
  ): Promise<IMemory | null> {
    const sql = await this.getSql(tenantId);

    const sets: postgres.Fragment[] = [];
    if (data.title !== undefined) sets.push(sql`title = ${data.title}`);
    if (data.content !== undefined)
      sets.push(sql`content = ${data.content}`);
    if (data.metadata !== undefined)
      sets.push(
        sql`metadata = ${sql.json(data.metadata as JsonValue)}`,
      );
    if (data.status !== undefined) sets.push(sql`status = ${data.status}`);
    if (data.topicKey !== undefined)
      sets.push(sql`topic_key = ${data.topicKey}`);

    if (sets.length === 0) return null;

    sets.push(sql`updated_at = NOW()`);

    let setClause = sets[0];
    for (let i = 1; i < sets.length; i++) {
      setClause = sql`${setClause}, ${sets[i]}`;
    }

    const results = await sql<IMemory[]>`
      UPDATE memories
      SET ${setClause}
      WHERE id = ${id} AND tenant_id = ${tenantId} AND status != ${MemoryStatus.ARCHIVED}
      RETURNING ${sql.unsafe(MEMORY_COLUMNS)}
    `;
    return results[0] ?? null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.getSql(tenantId);

    const results = await sql<{ id: string }[]>`
      UPDATE memories
      SET status = ${MemoryStatus.ARCHIVED}, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND status = ${MemoryStatus.ACTIVE}
      RETURNING id
    `;

    return results.length > 0;
  }
}
