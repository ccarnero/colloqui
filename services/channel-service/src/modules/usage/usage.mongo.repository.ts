import { Inject, Injectable } from "@nestjs/common";
import {
  SharedTenantDatabaseMode,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import type { Document } from "mongodb";
import { UsageTenantConnectionManager } from "./tenant-connection-manager";
import type { IUsageBucketRow, IUsageTotalsRow } from "./usage.dto";
import type {
  IUsageQueryFilters,
  IUsageRepository,
  IUsageSummaryChannelRow,
  IUsageTotalsFilters,
} from "./usage.repository.interface";

interface IBucketAggRow {
  readonly _id: {
    readonly bucket: Date;
    readonly account_id: string;
    readonly channel: string;
    readonly direction: string;
  };
  readonly events: number;
}

interface ITotalsAggRow {
  readonly _id: string;
  readonly events: number;
  readonly first_ts: Date;
  readonly last_ts: Date;
}

interface ISummaryAggRow {
  readonly _id: {
    readonly channel: string;
    readonly direction: string;
  };
  readonly events: number;
}

/**
 * Read-only repository over per-tenant usage MongoDB time-series.
 * Bucket queries use `$dateTrunc` aggregation on the raw `channel_events`
 * collection. Totals aggregate directly from the same collection.
 */
@Injectable()
export class UsageMongoRepository implements IUsageRepository {
  constructor(
    @Inject(UsageTenantConnectionManager)
    private readonly connections: TenantMongoConnectionManager,
  ) {}

  async getBuckets(
    filters: IUsageQueryFilters
  ): Promise<readonly IUsageBucketRow[]> {
    const target = await this.connections.resolveDatabaseTarget(
      filters.tenantId
    );
    const db = await this.connections.ensureSchema(filters.tenantId);
    const isShared =
      target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase;
    const match = buildEventMatch(filters, isShared);
    const unit = filters.bucket === "day" ? "day" : "hour";

    const rows = await db
      .collection("channel_events")
      .aggregate<IBucketAggRow>([
        { $match: match },
        {
          $group: {
            _id: {
              bucket: { $dateTrunc: { date: "$ts", unit } },
              account_id: "$meta.account_id",
              channel: "$meta.channel_id",
              direction: "$direction",
            },
            events: { $sum: 1 },
          },
        },
        { $sort: { "_id.bucket": 1 } },
      ])
      .toArray();

    const out: IUsageBucketRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      out[i] = {
        bucket: r._id.bucket.toISOString(),
        accountId: r._id.account_id,
        channel: r._id.channel,
        direction: r._id.direction as "ingress" | "egress" | "dlq",
        events: r.events,
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
    const db = await this.connections.ensureSchema(filters.tenantId);
    const isShared =
      target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase;
    const match = buildTotalsMatch(filters, isShared);

    const rows = await db
      .collection("channel_events")
      .aggregate<ITotalsAggRow>([
        { $match: match },
        {
          $group: {
            _id: "$direction",
            events: { $sum: 1 },
            first_ts: { $min: "$ts" },
            last_ts: { $max: "$ts" },
          },
        },
      ])
      .toArray();

    const out: IUsageTotalsRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      out[i] = {
        direction: r._id as "ingress" | "egress" | "dlq",
        events: r.events,
        firstTs: r.first_ts.toISOString(),
        lastTs: r.last_ts.toISOString(),
      };
    }
    return out;
  }

  async getSummary(
    tenantId: string
  ): Promise<readonly IUsageSummaryChannelRow[]> {
    const target = await this.connections.resolveDatabaseTarget(tenantId);
    const db = await this.connections.ensureSchema(tenantId);
    const isShared =
      target.sharedDatabaseMode === SharedTenantDatabaseMode.SingleDatabase;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
    const match: Document = { ts: { $gte: since } };
    if (isShared) {
      match["meta.tenant_id"] = tenantId;
    }

    const rows = await db
      .collection("channel_events")
      .aggregate<ISummaryAggRow>([
        { $match: match },
        {
          $group: {
            _id: {
              channel: "$meta.channel_id",
              direction: "$direction",
            },
            events: { $sum: 1 },
          },
        },
        { $sort: { "_id.channel": 1, "_id.direction": 1 } },
      ])
      .toArray();

    const out: IUsageSummaryChannelRow[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!;
      out[i] = {
        channel: r._id.channel,
        direction: r._id.direction as "ingress" | "egress" | "dlq",
        events: r.events,
      };
    }
    return out;
  }
}

function buildEventMatch(
  filters: IUsageQueryFilters,
  isShared: boolean
): Document {
  const match: Document = {
    ts: { $gte: filters.from, $lt: filters.to },
  };
  if (isShared) {
    match["meta.tenant_id"] = filters.tenantId;
  }
  if (filters.accountId !== undefined) {
    match["meta.account_id"] = filters.accountId;
  }
  if (filters.channel !== undefined) {
    match["meta.channel_id"] = filters.channel;
  }
  if (filters.direction !== undefined) {
    match.direction = filters.direction;
  }
  return match;
}

function buildTotalsMatch(
  filters: IUsageTotalsFilters,
  isShared: boolean
): Document {
  const match: Document = {
    ts: { $gte: filters.from, $lt: filters.to },
  };
  if (isShared) {
    match["meta.tenant_id"] = filters.tenantId;
  }
  if (filters.accountId !== undefined) {
    match["meta.account_id"] = filters.accountId;
  }
  if (filters.channel !== undefined) {
    match["meta.channel_id"] = filters.channel;
  }
  return match;
}
