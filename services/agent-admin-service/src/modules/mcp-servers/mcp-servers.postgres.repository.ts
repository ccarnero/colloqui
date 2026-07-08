import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import type { JsonValue } from "@yoizen/shared";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import type {
  ICreateMcpServerData,
  IMcpServer,
  IMcpServersRepository,
  IUpdateMcpServerData,
} from "./mcp-servers.repository.interface";
import { MCP_SERVER_ROW_COLUMNS } from "./mcp-servers-sql.constants";

@Injectable()
export class McpServersPostgresRepository
  extends TenantScopedPostgresRepository
  implements IMcpServersRepository
{
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  async findAll(tenantId: string): Promise<IMcpServer[]> {
    const sql = await this.getSql(tenantId);

    return sql<IMcpServer[]>`
      SELECT ${sql.unsafe(MCP_SERVER_ROW_COLUMNS)}
      FROM mcp_servers
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY created_at DESC
    `;
  }

  async findById(tenantId: string, id: string): Promise<IMcpServer | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IMcpServer[]>`
      SELECT ${sql.unsafe(MCP_SERVER_ROW_COLUMNS)}
      FROM mcp_servers
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  async create(
    tenantId: string,
    data: ICreateMcpServerData
  ): Promise<IMcpServer> {
    const sql = await this.getSql(tenantId);
    const serverId = randomUUID();

    const results = await sql<IMcpServer[]>`
      INSERT INTO mcp_servers (
        id,
        tenant_id,
        name,
        description,
        transport_type,
        url,
        headers,
        auth_type,
        auth_config,
        enabled,
        is_active,
        created_at,
        updated_at
      ) VALUES (
        ${serverId},
        ${tenantId},
        ${data.name},
        ${data.description ?? null},
        ${data.transport_type},
        ${data.url},
        ${sql.json((data.headers ?? {}) as JsonValue)},
        ${data.auth_type ?? "none"},
        ${data.auth_config === undefined ? null : sql.json(data.auth_config as JsonValue)},
        ${data.enabled ?? true},
        true,
        NOW(),
        NOW()
      )
      RETURNING ${sql.unsafe(MCP_SERVER_ROW_COLUMNS)}
    `;

    return results[0];
  }

  async update(
    tenantId: string,
    id: string,
    data: IUpdateMcpServerData
  ): Promise<IMcpServer | null> {
    const sql = await this.getSql(tenantId);

    if (data.name !== undefined) {
      await sql`UPDATE mcp_servers SET name = ${data.name}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }
    if (data.description !== undefined) {
      await sql`UPDATE mcp_servers SET description = ${data.description}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }
    if (data.transport_type !== undefined) {
      await sql`UPDATE mcp_servers SET transport_type = ${data.transport_type}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }
    if (data.url !== undefined) {
      await sql`UPDATE mcp_servers SET url = ${data.url}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }
    if (data.headers !== undefined) {
      await sql`UPDATE mcp_servers SET headers = ${sql.json(data.headers as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }
    if (data.auth_type !== undefined) {
      await sql`UPDATE mcp_servers SET auth_type = ${data.auth_type}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }
    if (data.auth_config !== undefined) {
      await sql`UPDATE mcp_servers SET auth_config = ${sql.json(data.auth_config as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }
    if (data.enabled !== undefined) {
      await sql`UPDATE mcp_servers SET enabled = ${data.enabled}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }
    if (data.managed_by !== undefined) {
      await sql`UPDATE mcp_servers SET managed_by = ${data.managed_by}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }
    if (data.managed_locked_fields !== undefined) {
      await sql`UPDATE mcp_servers SET managed_locked_fields = ${data.managed_locked_fields === null ? null : sql.json(data.managed_locked_fields as JsonValue)}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true`;
    }

    const results = await sql<IMcpServer[]>`
      SELECT ${sql.unsafe(MCP_SERVER_ROW_COLUMNS)}
      FROM mcp_servers
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.getSql(tenantId);

    const results = await sql<IMcpServer[]>`
      UPDATE mcp_servers
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      RETURNING id
    `;

    return results.length > 0;
  }
}
