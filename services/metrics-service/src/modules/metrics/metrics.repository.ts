import { Injectable } from "@nestjs/common";
import {
  TenantConnectionManager,
  type Sql,
} from "@yoizen/database";
import { METRICS_SCHEMA_SQL } from "@yoizen/shared";
import type { EventEnvelope, MetricsPayload } from "@yoizen/shared";

import type { IMetricsQueryParams } from "../../common/metrics-query-params";

export interface IMetricRecord {
  id: string;
  source: string;
  name: string;
  value: number;
  tags: Record<string, string>;
  metadata: Record<string, unknown>;
  created_at: string;
}

@Injectable()
export class MetricsRepository {
  constructor(private readonly tenantConnections: TenantConnectionManager) {}

  async ensureTable(sql: Sql, tenantId: string): Promise<void> {
    if (this.tenantConnections.isInitialized(tenantId)) return;

    await sql.unsafe(METRICS_SCHEMA_SQL);

    this.tenantConnections.markInitialized(tenantId);
  }

  async insertMetricFromEnvelope(
    sql: Sql,
    tenantId: string,
    envelope: EventEnvelope,
  ): Promise<void> {
    await this.ensureTable(sql, tenantId);

    const payload = (envelope.data.payload ?? {}) as unknown as MetricsPayload;

    const source = payload.source ?? "unknown";
    const name = payload.name ?? "unnamed";
    const value = typeof payload.value === "number" ? payload.value : 0;
    const tags = payload.tags ?? {};
    const metadata = {
      tenant: envelope.tenant,
      source: envelope.source,
      correlation_id: envelope.correlation_id,
      traceid: envelope.traceid,
    };
    const createdAtIso = payload.timestamp
      ? new Date(payload.timestamp).toISOString()
      : null;

    await sql`
      INSERT INTO metrics (id, source, name, value, tags, metadata, created_at)
      VALUES (
        ${envelope.id}, ${source}, ${name}, ${value},
        ${JSON.stringify(tags)}, ${JSON.stringify(metadata)},
        COALESCE(${createdAtIso}, NOW())
      )
      ON CONFLICT (id) DO NOTHING
    `;
  }

  async queryMetrics(
    sql: Sql,
    tenantId: string,
    params: IMetricsQueryParams,
  ): Promise<IMetricRecord[]> {
    const { source, name, from, to, limit, offset } = params;
    await this.ensureTable(sql, tenantId);

    return sql<IMetricRecord[]>`
      SELECT id, source, name, value, tags, metadata, created_at
      FROM metrics
      WHERE 1=1
        ${source ? sql`AND source = ${source}` : sql``}
        ${name ? sql`AND name = ${name}` : sql``}
        ${from ? sql`AND created_at >= ${from}` : sql``}
        ${to ? sql`AND created_at <= ${to}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
  }

  async getMetricById(
    sql: Sql,
    tenantId: string,
    id: string,
  ): Promise<IMetricRecord | null> {
    await this.ensureTable(sql, tenantId);

    const rows = await sql<IMetricRecord[]>`
      SELECT id, source, name, value, tags, metadata, created_at
      FROM metrics
      WHERE id = ${id}
        AND (metadata->>'tenant' = ${tenantId} OR metadata->>'tenant' IS NULL)
    `;
    return rows[0] ?? null;
  }
}
