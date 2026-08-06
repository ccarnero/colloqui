import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { PinoLoggerService } from "@yoizen/observability";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import { validateSelectOnly } from "./skb-sql-safety";

const BATCH_SIZE = 5000;

@Injectable()
export class SKBRowsRepository extends TenantScopedPostgresRepository {
  private readonly logger = new PinoLoggerService(SKBRowsRepository.name);

  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  /**
   * Executes a dynamic query against skb_rows for the NL→SQL pipeline.
   *
   * `whereClause`/`orderBy` are spliced in as raw SQL text on purpose — they
   * are LLM-generated fragments already allowlist-validated by
   * `isSafe`/`validateWhereClause` (skb-sql-safety.ts) in the only current
   * caller, SKBQueryService.query, before they ever reach this method.
   * `containerId`, `tenantId` and `categories` are caller-controlled VALUES,
   * not SQL syntax, so they are bound as parameters instead. `limit`/`offset`
   * are bound too; the limit is already clamped by `clampLimit()` in
   * SKBQueryService.query, which passes the same clamped value to `buildSql()`.
   *
   * Defense in depth: both assembled statements are re-checked with
   * `validateSelectOnly()` immediately before execution, so the guarantee is
   * asserted on the exact text that reaches Postgres and not only on the
   * fragments the service validated.
   */
  async executeQuery(
    tenantId: string,
    containerId: string,
    options: {
      whereClause: string;
      orderBy?: string;
      categories: string[];
      limit: number;
      offset: number;
    }
  ): Promise<{ results: Record<string, unknown>[]; totalCount: number }> {
    const sql = await this.getSql(tenantId);

    const whereParts: string[] = ["container_id = $1", "tenant_id = $2"];
    const whereParams: unknown[] = [containerId, tenantId];

    if (options.whereClause.trim()) {
      whereParts.push(`(${options.whereClause})`);
    }

    if (options.categories.length > 0) {
      // Raw array, NOT pre-stringified — same reasoning as insertRows: the
      // ::jsonb cast has the driver serialize it, stringifying here would
      // double-encode.
      whereParams.push(options.categories);
      whereParts.push(`categories @> $${whereParams.length}::jsonb`);
    }

    const where = whereParts.join(" AND ");
    const orderClause = options.orderBy?.trim()
      ? `ORDER BY ${options.orderBy}`
      : "ORDER BY created_at DESC";

    const dataParams = [...whereParams, options.limit, options.offset];
    const dataQuery = `SELECT data FROM skb_rows WHERE ${where} ${orderClause} LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`;
    const countQuery = `SELECT COUNT(*)::bigint AS count FROM skb_rows WHERE ${where}`;

    // Layer 2 re-applied on the final statements, before they are executed.
    // The fixed template contains no blocked keyword (`created_at` does not
    // match `\bCREATE\b`), so only a hostile spliced fragment can trip this.
    for (const [label, statement] of [
      ["data", dataQuery],
      ["count", countQuery],
    ] as const) {
      try {
        validateSelectOnly(statement);
      } catch (err) {
        this.logger.warn(
          `SKB ${label} query rejected by validateSelectOnly for container ${containerId} (tenant ${tenantId}): ${statement}`
        );
        throw err;
      }
    }

    const [dataResult, countResult] = await Promise.all([
      sql.unsafe(dataQuery, dataParams as any),
      sql.unsafe(countQuery, whereParams as any),
    ]);

    const results = (
      dataResult as unknown as Array<{ data: Record<string, unknown> }>
    ).map((r) => r.data);

    const totalCount = Number(
      (countResult as unknown as Array<{ count: string }>)[0]?.count ?? 0
    );

    return { results, totalCount };
  }

  /**
   * Returns total row count for a container.
   */
  async countByContainer(
    tenantId: string,
    containerId: string
  ): Promise<number> {
    const sql = await this.getSql(tenantId);

    const result = await sql`
      SELECT COUNT(*)::bigint AS count FROM skb_rows
      WHERE container_id = ${containerId} AND tenant_id = ${tenantId}
    `;

    return Number(
      (result as unknown as Array<{ count: string }>)[0]?.count ?? 0
    );
  }
  /**
   * Inserts rows into skb_rows table with tenant, container, and file metadata.
   * Batches inserts in groups of 5000 for performance.
   * Returns the total number of rows inserted.
   */
  async insertRows(
    sql: any,
    tenantId: string,
    containerId: string,
    fileId: string,
    rows: Record<string, unknown>[],
    categories: string[]
  ): Promise<number> {
    if (rows.length === 0) {
      return 0;
    }

    // Raw values, NOT pre-stringified: the $n::jsonb casts make Postgres
    // type the parameters as jsonb, so the driver's jsonb serializer
    // JSON.stringifies them — stringifying here double-encodes and stores
    // a JSON string instead of an object (breaking data->>'col' filters).
    const categoriesValue = categories.length > 0 ? categories : null;

    let inserted = 0;
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const values = batch
        .map(
          (row, idx) =>
            `($${idx * 6 + 1}, $${idx * 6 + 2}, $${idx * 6 + 3}, $${idx * 6 + 4}, $${idx * 6 + 5}::jsonb, $${idx * 6 + 6}::jsonb)`
        )
        .join(", ");

      const params: unknown[] = [];
      batch.forEach((row, idx) => {
        params.push(
          tenantId,
          containerId,
          fileId,
          row.file_index ?? i + idx,
          row,
          categoriesValue
        );
      });

      const sqlStr = `INSERT INTO skb_rows (tenant_id, container_id, file_id, file_index, data, categories) VALUES ${values}`;
      await sql.unsafe(sqlStr, params);
      inserted += batch.length;
    }

    return inserted;
  }

  /**
   * Queries rows by tenant, container, and file.
   * Returns the data column from each row.
   */
  async getRows(
    sql: any,
    tenantId: string,
    containerId: string,
    fileId: string
  ): Promise<Record<string, unknown>[]> {
    const result = await sql.unsafe(
      `SELECT data FROM skb_rows WHERE tenant_id = $1 AND container_id = $2 AND file_id = $3 ORDER BY file_index ASC`,
      [tenantId, containerId, fileId]
    );

    return (result as Array<{ data: Record<string, unknown> }>).map(
      (r) => r.data
    );
  }

  /**
   * Deletes rows matching file_id and tenant_id.
   * Accepts a sql-like object with an `unsafe` method.
   * Returns the number of deleted rows.
   */
  async deleteRowsByFileId(
    sql: any,
    tenantId: string,
    fileId: string
  ): Promise<number> {
    const raw = await sql.unsafe(
      `DELETE FROM skb_rows WHERE tenant_id = $1 AND file_id = $2`,
      [tenantId, fileId]
    );

    return (raw as { count: number })?.count ?? 0;
  }

  /**
   * Deletes rows for a file (skb_files PK). Used by the ingestion worker's
   * post-insert death check to undo the insert when the container was
   * deleted mid-flight.
   */
  async deleteRowsForFile(tenantId: string, fileId: string): Promise<number> {
    const sql = await this.getSql(tenantId);

    const result = await sql`
      DELETE FROM skb_rows
      WHERE file_id = ${fileId} AND tenant_id = ${tenantId}
    `;

    return (result as unknown as { count?: number }).count ?? 0;
  }

  /**
   * Returns row count for a container and tenant.
   */
  async getRowCount(
    sql: any,
    tenantId: string,
    containerId: string
  ): Promise<number> {
    const result = await sql.unsafe(
      `SELECT COUNT(*) as count FROM skb_rows WHERE container_id = $1 AND tenant_id = $2`,
      [containerId, tenantId]
    );

    const rows = result as Array<{ count: string }>;
    return rows.length > 0 ? Number(rows[0].count) : 0;
  }
}
