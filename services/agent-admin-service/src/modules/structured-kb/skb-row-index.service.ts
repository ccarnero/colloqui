import { Inject, Injectable } from "@nestjs/common";
import type { SchemaAnalysisResult, SKBColumnType } from "./types/skb.types";
import { sanitizeIdentifier } from "./skb-sql-safety";

const FILTERABLE_TYPES: SKBColumnType[] = ["numeric", "categorical", "date"];

@Injectable()
export class SKBRowIndexService {
  constructor(
    @Inject("RowIndexSqlProvider")
    private readonly sqlProvider: {
      getSql(tenantId: string): Promise<{ unsafe: (sql: string, params?: unknown[]) => Promise<unknown> }>;
    },
  ) {}

  async ensureIndexes(
    tenantId: string,
    containerId: string,
    schema: SchemaAnalysisResult,
  ): Promise<string[]> {
    const created: string[] = [];
    const sql = await this.sqlProvider.getSql(tenantId);

    for (const col of schema.columns) {
      if (!col.is_filterable) continue;
      if (!FILTERABLE_TYPES.includes(col.type)) continue;

      const safeCol = sanitizeIdentifier(col.name);
      if (!safeCol || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(safeCol)) continue;

      const idxName = `idx_skb_dyn_${containerId.replace(/-/g, "_")}_${safeCol}`.slice(0, 63);

      const isNumeric = col.type === "numeric";
      const expression = isNumeric
        ? `((data->>'${safeCol}')::numeric)`
        : `(data->>'${safeCol}')`;

      const ddl = `
        CREATE INDEX IF NOT EXISTS ${idxName}
          ON skb_rows (${expression})
          WHERE container_id = $1
      `;

      await sql.unsafe(ddl, [containerId]);
      created.push(idxName);
    }

    return created;
  }

  async dropIndexes(
    tenantId: string,
    containerId: string,
  ): Promise<number> {
    const sql = await this.sqlProvider.getSql(tenantId);

    const prefix = `idx_skb_dyn_${containerId.replace(/-/g, "_")}`;

    const rows = await sql.unsafe(
      `SELECT indexname FROM pg_indexes WHERE indexname LIKE $1`,
      [`${prefix}%`],
    ) as Array<{ indexname: string }>;

    for (const row of rows) {
      await sql.unsafe(`DROP INDEX IF EXISTS ${row.indexname}`);
    }

    return rows.length;
  }
}
