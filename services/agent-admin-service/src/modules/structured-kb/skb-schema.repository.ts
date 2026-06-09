import { Inject, Injectable } from "@nestjs/common";
import type { TenantConnectionManager } from "@yoizen/database";
import { TenantScopedPostgresRepository } from "../../providers/tenant-scoped.repository";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";

@Injectable()
export class SKBSchemaRepository extends TenantScopedPostgresRepository {
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantConnectionManager,
  ) {
    super(connectionManager);
  }

  async loadAllSchemas(
    tenantId: string,
    containerId: string,
  ): Promise<
    Array<{
      table_description: string;
      query_rules: string;
      columns: Array<{
        name: string;
        original_name: string;
        type: string;
        description: string;
        sample_values: string[];
        is_filterable: boolean;
        query_hints: string[];
      }>;
      row_count: number;
      analyzed_at: string;
    }>
  > {
    const sql = await this.getSql(tenantId);

    const rows = await sql`
      SELECT table_description, query_rules, columns, row_count, analyzed_at
      FROM skb_schemas
      WHERE container_id = ${containerId}
        AND tenant_id = ${tenantId}
    `;

    return (rows as unknown as Array<{
      table_description: string | null;
      query_rules: string | null;
      columns: Array<{
        name: string;
        original_name: string;
        type: string;
        description: string;
        sample_values: string[];
        is_filterable: boolean;
        query_hints: string[];
      }>;
      row_count: number;
      analyzed_at: Date;
    }>).map((r) => ({
      table_description: r.table_description ?? "",
      query_rules: r.query_rules ?? "",
      columns: Array.isArray(r.columns) ? r.columns : [],
      row_count: r.row_count ?? 0,
      analyzed_at: r.analyzed_at?.toISOString?.() ?? String(r.analyzed_at ?? ""),
    }));
  }
}
