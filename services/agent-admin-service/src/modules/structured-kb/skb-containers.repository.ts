import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import type { FileRow, SKBContainerRow } from "./types/skb.types";

export interface SKBFileRow {
  /** skb_files primary key — the value skb_rows.file_id references. */
  id: string;
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
    data: { name: string; description?: string }
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
    id: string
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
    data: { name?: string; description?: string; status?: string }
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

  /**
   * Creates the `skb_files` row for a newly-uploaded file. Status starts at
   * 'pending' — the ingestion worker (skb-ingestion-worker.service.ts) flips
   * it to 'processing'/'completed'/'failed' as it consumes the corresponding
   * ingestion event.
   */
  async createFile(
    tenantId: string,
    containerId: string,
    data: { fileId: string; originalName: string; categories: string[] }
  ): Promise<FileRow> {
    const sql = await this.getSql(tenantId);

    // Raw array, NOT pre-stringified: the ::jsonb cast makes the driver's
    // jsonb serializer stringify the parameter, so stringifying here
    // double-encodes and stores a JSON string instead of an array.
    const [result] = await sql<FileRow[]>`
      INSERT INTO skb_files (container_id, tenant_id, file_id, original_name, categories, status)
      VALUES (${containerId}, ${tenantId}, ${data.fileId}, ${data.originalName}, ${data.categories ?? []}::jsonb, 'pending')
      RETURNING *
    `;
    return result;
  }

  // NOTE: file status tracking lives in `skb_files` (created by
  // schema-initializer.ts), not a separate `skb_container_files` table.
  // `skb_files` already carries file_id/container_id/tenant_id/status/
  // error_message/updated_at plus file metadata (original_name, categories,
  // row_count), so repointing these queries here is the smaller correct fix
  // vs. standing up a near-duplicate table nothing else needs.
  async findFile(
    tenantId: string,
    containerId: string,
    fileId: string
  ): Promise<SKBFileRow | null> {
    const sql = await this.getSql(tenantId);

    const results = await sql<SKBFileRow[]>`
      SELECT id, file_id, container_id, tenant_id, status, error_message AS error, updated_at
      FROM skb_files
      WHERE file_id = ${fileId}
        AND container_id = ${containerId}
        AND tenant_id = ${tenantId}
        AND is_active = true
      LIMIT 1
    `;

    return results[0] ?? null;
  }

  async updateFileStatus(
    tenantId: string,
    _containerId: string,
    fileId: string,
    status: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const sql = await this.getSql(tenantId);

    if (metadata?.error) {
      await sql`
        UPDATE skb_files
        SET status = ${status},
            error_message = ${String(metadata.error)},
            updated_at = NOW()
        WHERE file_id = ${fileId} AND tenant_id = ${tenantId}
      `;
    } else {
      await sql`
        UPDATE skb_files
        SET status = ${status},
            updated_at = NOW()
        WHERE file_id = ${fileId} AND tenant_id = ${tenantId}
      `;
    }
  }

  async updateContainerStatus(
    tenantId: string,
    containerId: string,
    status?: string
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

  /**
   * Finds files stuck in 'processing' for longer than `thresholdMinutes`,
   * across every tenant this process has already opened a connection for.
   *
   * Mirrors `DocumentsService.resetStuckProcessingDocuments()`: there is no
   * single cross-tenant database, so we fan out over
   * `connectionManager.getKnownTenantIds()` and query each tenant schema
   * individually. A lookup failure for one tenant is logged and skipped so
   * it never blocks the watchdog check for the rest.
   */
  async findProcessingFilesOlderThan(
    thresholdMinutes: number
  ): Promise<SKBFileRow[]> {
    const tenantIds = this.connectionManager.getKnownTenantIds();
    if (tenantIds.length === 0) {
      return [];
    }

    const stuckFiles: SKBFileRow[] = [];
    const intervalLiteral = `${thresholdMinutes} minutes`;

    for (const tenantId of tenantIds) {
      try {
        const sql = await this.getSql(tenantId);
        const rows = await sql<SKBFileRow[]>`
          SELECT id, file_id, container_id, tenant_id, status, error_message AS error, updated_at
          FROM skb_files
          WHERE status = 'processing'
            AND is_active = true
            AND updated_at < NOW() - ${intervalLiteral}::INTERVAL
        `;
        stuckFiles.push(...rows);
      } catch (err: unknown) {
        console.error(
          `SKB watchdog: failed to check stuck files for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    return stuckFiles;
  }
}
