import { Inject, Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  type Sql,
  type TenantConnectionManager,
} from "@yoizen/database";
import { UsageTenantConnectionManager } from "./tenant-connection-manager";
import type { IUsageBucketRow, IUsageTotalsRow } from "./usage.dto";
import type {
  IUsageQueryFilters,
  IUsageRepository,
  IUsageSummaryChannelRow,
  IUsageTotalsFilters,
} from "./usage.repository.interface";

interface IBucketRawRow {
  bucket: string;
  account_id: string;
  channel: string;
  direction: string;
  events: string | number;
}

interface ITotalsRawRow {
  direction: string;
  events: string | number;
  first_ts: Date | string | null;
  last_ts: Date | string | null;
}

interface ISummaryRawRow {
  channel: string;
  direction: string;
  events: string | number;
}

/**
 * Read-only repository over the dedicated per-tenant TimescaleDB.
 * Bucket queries use continuous aggregates (`channel_events_hourly` /
 * `channel_events_daily`). Totals read the raw `channel_events` hypertable
 * so `MIN(ts)` / `MAX(ts)` match the selected range (CAGG buckets would
 * truncate window edges).
 *
 * Query filters are composed with tagged template literals so the
 * `postgres` driver parametrises them; no string concatenation.
 */
@Injectable()
export class UsagePostgresRepository implements IUsageRepository {
  constructor(
    @Inject(UsageTenantConnectionManager)
    private readonly connections: TenantConnectionManager,
  ) {}

  async getBuckets(
    filters: IUsageQueryFilters
  ): Promise<readonly IUsageBucketRow[]> {
    const target = await this.connections.resolveDatabaseTarget(
      filters.tenantId
    );
    const sql = await this.connections.ensureSchema(filters.tenantId);
    if (target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase) {
      return this.getSharedBuckets(sql, filters);
    }
    const view =
      filters.bucket === "day"
        ? "channel_events_daily"
        : "channel_events_hourly";
    const bucketInterval = filters.bucket === "day" ? "1 day" : "1 hour";

    const rows = (await sql.unsafe(
      `
      WITH bounds AS (
        SELECT time_bucket($6::interval, now() - INTERVAL '10 minutes') AS tail_bucket
      ),
      cagg AS (
        SELECT
          bucket,
          account_id,
          channel,
          direction,
          events
        FROM ${view}
        CROSS JOIN bounds
        WHERE bucket >= $1
          AND bucket < LEAST($2::timestamptz, bounds.tail_bucket)
          AND ($3::text IS NULL OR account_id = $3)
          AND ($4::text IS NULL OR channel = $4)
          AND ($5::text IS NULL OR direction = $5)
      ),
      tail AS (
        SELECT
          time_bucket($6::interval, ts) AS bucket,
          account_id,
          channel,
          direction,
          count(*)::BIGINT AS events
        FROM channel_events
        CROSS JOIN bounds
        WHERE ts >= GREATEST($1::timestamptz, bounds.tail_bucket)
          AND ts < $2
          AND ($3::text IS NULL OR account_id = $3)
          AND ($4::text IS NULL OR channel = $4)
          AND ($5::text IS NULL OR direction = $5)
        GROUP BY bucket, account_id, channel, direction
      )
      SELECT * FROM cagg
      UNION ALL
      SELECT * FROM tail
      ORDER BY bucket ASC
    `,
      [
        filters.from,
        filters.to,
        filters.accountId ?? null,
        filters.channel ?? null,
        filters.direction ?? null,
        bucketInterval,
      ]
    )) as IBucketRawRow[];

    const out: IUsageBucketRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      out[i] = {
        bucket: new Date(r.bucket).toISOString(),
        accountId: r.account_id,
        channel: r.channel,
        direction: r.direction as "ingress" | "egress" | "dlq",
        events: Number(r.events),
      };
    }
    return out;
  }

  async getTotals(
    filters: IUsageTotalsFilters
  ): Promise<readonly IUsageTotalsRow[]> {
    const target = await this.connections.resolveDatabaseTarget(
      filters.tenantId
    );
    const sql = await this.connections.ensureSchema(filters.tenantId);
    if (target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase) {
      return this.getSharedTotals(sql, filters);
    }
    const rows = (await sql.unsafe(
      `
      SELECT
        direction,
        count(*)::BIGINT AS events,
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts
      FROM channel_events
      WHERE ts >= $1
        AND ts <  $2
        AND ($3::text IS NULL OR account_id = $3)
        AND ($4::text IS NULL OR channel = $4)
      GROUP BY direction
    `,
      [
        filters.from,
        filters.to,
        filters.accountId ?? null,
        filters.channel ?? null,
      ]
    )) as ITotalsRawRow[];

    const out: IUsageTotalsRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      const firstTs =
        r.first_ts == null
          ? null
          : new Date(r.first_ts as string | number | Date).toISOString();
      const lastTs =
        r.last_ts == null
          ? null
          : new Date(r.last_ts as string | number | Date).toISOString();
      out[i] = {
        direction: r.direction as "ingress" | "egress" | "dlq",
        events: Number(r.events),
        firstTs,
        lastTs,
      };
    }
    return out;
  }

  async getSummary(
    tenantId: string
  ): Promise<readonly IUsageSummaryChannelRow[]> {
    const target = await this.connections.resolveDatabaseTarget(tenantId);
    const sql = await this.connections.ensureSchema(tenantId);
    if (target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase) {
      return this.getSharedSummary(sql, tenantId);
    }
    const rows = (await sql.unsafe(
      `
      SELECT
        channel,
        direction,
        SUM(events)::BIGINT AS events
      FROM channel_events
      WHERE ts >= NOW() - INTERVAL '24 hours'
      GROUP BY channel, direction
      ORDER BY channel, direction
    `,
      []
    )) as ISummaryRawRow[];
    return mapSummaryRows(rows);
  }

  private async getSharedBuckets(
    sql: Sql,
    filters: IUsageQueryFilters
  ): Promise<readonly IUsageBucketRow[]> {
    const view =
      filters.bucket === "day"
        ? "channel_events_daily"
        : "channel_events_hourly";
    const bucketInterval = filters.bucket === "day" ? "1 day" : "1 hour";
    const rows = (await sql.unsafe(
      `
      WITH bounds AS (
        SELECT time_bucket($7::interval, now() - INTERVAL '10 minutes') AS tail_bucket
      ),
      cagg AS (
        SELECT
          bucket,
          account_id,
          channel,
          direction,
          events
        FROM ${view}
        CROSS JOIN bounds
        WHERE tenant_id = $1
          AND bucket >= $2
          AND bucket < LEAST($3::timestamptz, bounds.tail_bucket)
          AND ($4::text IS NULL OR account_id = $4)
          AND ($5::text IS NULL OR channel = $5)
          AND ($6::text IS NULL OR direction = $6)
      ),
      tail AS (
        SELECT
          time_bucket($7::interval, ts) AS bucket,
          account_id,
          channel,
          direction,
          count(*)::BIGINT AS events
        FROM channel_events
        CROSS JOIN bounds
        WHERE tenant_id = $1
          AND ts >= GREATEST($2::timestamptz, bounds.tail_bucket)
          AND ts < $3
          AND ($4::text IS NULL OR account_id = $4)
          AND ($5::text IS NULL OR channel = $5)
          AND ($6::text IS NULL OR direction = $6)
        GROUP BY bucket, account_id, channel, direction
      )
      SELECT * FROM cagg
      UNION ALL
      SELECT * FROM tail
      ORDER BY bucket ASC
    `,
      [
        filters.tenantId,
        filters.from,
        filters.to,
        filters.accountId ?? null,
        filters.channel ?? null,
        filters.direction ?? null,
        bucketInterval,
      ]
    )) as IBucketRawRow[];

    return mapBucketRows(rows);
  }

  private async getSharedTotals(
    sql: Sql,
    filters: IUsageTotalsFilters
  ): Promise<readonly IUsageTotalsRow[]> {
    const rows = (await sql.unsafe(
      `
      SELECT
        direction,
        count(*)::BIGINT AS events,
        MIN(ts) AS first_ts,
        MAX(ts) AS last_ts
      FROM channel_events
      WHERE tenant_id = $1
        AND ts >= $2
        AND ts <  $3
        AND ($4::text IS NULL OR account_id = $4)
        AND ($5::text IS NULL OR channel = $5)
      GROUP BY direction
    `,
      [
        filters.tenantId,
        filters.from,
        filters.to,
        filters.accountId ?? null,
        filters.channel ?? null,
      ]
    )) as ITotalsRawRow[];

    return mapTotalsRows(rows);
  }

  private async getSharedSummary(
    sql: Sql,
    tenantId: string
  ): Promise<readonly IUsageSummaryChannelRow[]> {
    const rows = (await sql.unsafe(
      `
      SELECT
        channel,
        direction,
        SUM(events)::BIGINT AS events
      FROM channel_events
      WHERE tenant_id = $1
        AND ts >= NOW() - INTERVAL '24 hours'
      GROUP BY channel, direction
      ORDER BY channel, direction
    `,
      [tenantId]
    )) as ISummaryRawRow[];
    return mapSummaryRows(rows);
  }
}

function mapBucketRows(rows: readonly IBucketRawRow[]): IUsageBucketRow[] {
  const out: IUsageBucketRow[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    out[i] = {
      bucket: new Date(r.bucket).toISOString(),
      accountId: r.account_id,
      channel: r.channel,
      direction: r.direction as "ingress" | "egress" | "dlq",
      events: Number(r.events),
    };
  }
  return out;
}

function mapTotalsRows(rows: readonly ITotalsRawRow[]): IUsageTotalsRow[] {
  const out: IUsageTotalsRow[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const firstTs =
      r.first_ts == null
        ? null
        : new Date(r.first_ts as string | number | Date).toISOString();
    const lastTs =
      r.last_ts == null
        ? null
        : new Date(r.last_ts as string | number | Date).toISOString();
    out[i] = {
      direction: r.direction as "ingress" | "egress" | "dlq",
      events: Number(r.events),
      firstTs,
      lastTs,
    };
  }
  return out;
}

function mapSummaryRows(
  rows: readonly ISummaryRawRow[]
): IUsageSummaryChannelRow[] {
  const out: IUsageSummaryChannelRow[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    out[i] = {
      channel: r.channel,
      direction: r.direction as "ingress" | "egress" | "dlq",
      events: Number(r.events),
    };
  }
  return out;
}
