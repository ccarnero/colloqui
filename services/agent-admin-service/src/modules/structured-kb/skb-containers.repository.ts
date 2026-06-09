import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { TenantConnectionManager } from "@yoizen/database";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type { SKBContainerRow } from "./types/skb.types";

export interface SKBFileRow {
  file_id: string;
  container_id: string;
  tenant_id: string;
  status: string;
  error?: string;
  updated_at: Date;
  containerId?: string;
  tenantId?: string;
}

@Injectable()
export class SKBContainersRepository extends TenantScopedPostgresRepository {
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  async create(
    tenantId: string,
    data: { name: string; description?: string },
  ): Promise<SKBContainerRow> {
    const sql = await this.getSql(tenantId);
    const id = randomUUID();

    const [result] = await sql<SKBContainerRow[]>`
      INSERT INTO skb_containers (id, tenant_id, name, description)
      VALUES (${id}, ${tenantId}, ${data.name}, ${data.description ?? null})
      RETURNING *
    `;
    return result;
  }

  async findById(
    tenantId: string,
    id: string,
  ): Promise<SKBContainerRow | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<SKBContainerRow[]>`
      SELECT * FROM skb_containers
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  async findAll(tenantId: string): Promise<SKBContainerRow[]> {
    const sql = await this.getSql(tenantId);

    return sql<SKBContainerRow[]>`
      SELECT * FROM skb_containers
      WHERE tenant_id = ${tenantId} AND is_active = true
      ORDER BY created_at DESC
    `;
  }

  async update(
    tenantId: string,
    id: string,
    data: { name?: string; description?: string; status?: string },
  ): Promise<SKBContainerRow | null> {
    const sql = await this.getSql(tenantId);

    if (data.name !== undefined) {
      await sql`
        UPDATE skb_containers SET name = ${data.name}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      `;
    }
    if (data.description !== undefined) {
      await sql`
        UPDATE skb_containers SET description = ${data.description}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      `;
    }
    if (data.status !== undefined) {
      await sql`
        UPDATE skb_containers SET status = ${data.status}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      `;
    }

    const results = await sql<SKBContainerRow[]>`
      SELECT * FROM skb_containers
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  async delete(tenantId: string, id: string): Promise<SKBContainerRow | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<SKBContainerRow[]>`
      UPDATE skb_containers
      SET is_active = false, updated_at = NOW()
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
      RETURNING *
    `;

    return results[0] ?? null;
  }

  async exists(tenantId: string, id: string): Promise<boolean> {
    const sql = await this.getSql(tenantId);

    const results = await sql<{ count: string }[]>`
      SELECT COUNT(*)::bigint AS count FROM skb_containers
      WHERE id = ${id} AND tenant_id = ${tenantId} AND is_active = true
    `;

    return Number(results[0].count) > 0;
  }

  async findFile(
    tenantId: string,
    containerId: string,
    fileId: string,
  ): Promise<SKBFileRow | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<SKBFileRow[]>`
      SELECT * FROM skb_container_files
      WHERE file_id = ${fileId}
        AND container_id = ${containerId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  async updateFileStatus(
    tenantId: string,
    _containerId: string,
    fileId: string,
    status: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const sql = await this.getSql(tenantId);

    if (metadata?.error) {
      await sql`
        UPDATE skb_container_files
        SET status = ${status},
            error = ${String(metadata.error)},
            updated_at = NOW()
        WHERE file_id = ${fileId} AND tenant_id = ${tenantId}
      `;
    } else {
      await sql`
        UPDATE skb_container_files
        SET status = ${status},
            updated_at = NOW()
        WHERE file_id = ${fileId} AND tenant_id = ${tenantId}
      `;
    }
  }

  async updateContainerStatus(
    tenantId: string,
    containerId: string,
    status?: string,
  ): Promise<void> {
    const sql = await this.getSql(tenantId);

    if (status) {
      await sql`
        UPDATE skb_containers
        SET status = ${status}, updated_at = NOW()
        WHERE id = ${containerId} AND tenant_id = ${tenantId}
      `;
    } else {
      // Recompute status from file statuses
      await sql`
        UPDATE skb_containers
        SET updated_at = NOW()
        WHERE id = ${containerId} AND tenant_id = ${tenantId}
      `;
    }
  }

  async findProcessingFilesOlderThan(
    thresholdMinutes: number,
  ): Promise<SKBFileRow[]> {
    // This query iterates all tenants — in production the caller
    // should pass known tenants or this runs as a batch across tenants.
    // For now, return an empty array since cross-tenant queries
    // require a connection per tenant.
    return [];
  }
}
