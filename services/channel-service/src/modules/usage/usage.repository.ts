import { Injectable } from "@nestjs/common";
import { UsageTenantConnectionManager } from "./tenant-connection-manager";
import type {
  IUsageBucketRow,
  IUsageTotalsRow,
  UsageBucket,
} from "./usage.dto";

export interface IUsageQueryFilters {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
  readonly bucket: UsageBucket;
  readonly accountId?: string;
  readonly channel?: string;
  readonly direction?: "ingress" | "egress" | "dlq";
}

export interface IUsageTotalsFilters {
  readonly tenantId: string;
  readonly from: Date;
  readonly to: Date;
  readonly accountId?: string;
  readonly channel?: string;
}

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
}

/**
 * Read-only repository over the dedicated per-tenant TimescaleDB.
 * Queries the continuous aggregates (`channel_events_hourly` /
 * `channel_events_daily`) so the UI never hits the raw hypertable —
 * response time stays predictable even for long date ranges.
 *
 * Query filters are composed with tagged template literals so the
 * `postgres` driver parametrises them; no string concatenation.
 */
@Injectable()
export class UsageRepository {
  constructor(private readonly connections: UsageTenantConnectionManager) {}

  async getBuckets(
    filters: IUsageQueryFilters,
  ): Promise<readonly IUsageBucketRow[]> {
    const sql = await this.connections.ensureSchema(filters.tenantId);
    const view =
      filters.bucket === "day" ? "channel_events_daily" : "channel_events_hourly";

    const rows = (await sql.unsafe(
      `
      SELECT
        bucket,
        account_id,
        channel,
        direction,
        events
      FROM ${view}
      WHERE bucket >= $1
        AND bucket <  $2
        AND ($3::text IS NULL OR account_id = $3)
        AND ($4::text IS NULL OR channel = $4)
        AND ($5::text IS NULL OR direction = $5)
      ORDER BY bucket ASC
    `,
      [
        filters.from,
        filters.to,
        filters.accountId ?? null,
        filters.channel ?? null,
        filters.direction ?? null,
      ],
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
    filters: IUsageTotalsFilters,
  ): Promise<readonly IUsageTotalsRow[]> {
    const sql = await this.connections.ensureSchema(filters.tenantId);
    const rows = (await sql.unsafe(
      `
      SELECT
        direction,
        SUM(events)::BIGINT AS events
      FROM channel_events_hourly
      WHERE bucket >= $1
        AND bucket <  $2
        AND ($3::text IS NULL OR account_id = $3)
        AND ($4::text IS NULL OR channel = $4)
      GROUP BY direction
    `,
      [
        filters.from,
        filters.to,
        filters.accountId ?? null,
        filters.channel ?? null,
      ],
    )) as ITotalsRawRow[];

    const out: IUsageTotalsRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      out[i] = {
        direction: r.direction as "ingress" | "egress" | "dlq",
        events: Number(r.events),
      };
    }
    return out;
  }
}
