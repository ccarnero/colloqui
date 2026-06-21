import { Inject, Injectable } from "@nestjs/common";
import {
  isMongoDuplicateKeyError,
  type IStringIdDoc,
  type TenantMongoConnectionManager,
} from "@yoizen/database";
import {
  GATEWAY_AUDIT_MONGO_NAMESPACE,
  GATEWAY_AUDIT_MONGO_SCHEMA,
  type AuditDashboardStats,
  type DashboardActivity,
  type GatewayAuditEvent,
} from "@yoizen/shared";
import type { Collection, Filter } from "mongodb";
import {
  mapGatewayAuditDoc,
  type IStoredGatewayAuditEvent,
} from "../../common/gateway-audit-projection";
import { ensureTenantNamespaceOnce } from "../../common/ensure-tenant-schema";
import { AuditTenantConnectionManager } from "../../providers/tenant-connection-manager";
import type {
  IGatewayAuditQueryParams,
  IGatewayAuditRepository,
} from "./gateway-audit.repository.interface";

interface IAggregateRow {
  requests_today: number;
  requests_yesterday: number;
  error_count_today: number;
  error_count_yesterday: number;
  avg_response_ms: number | null;
  avg_response_ms_yesterday: number | null;
  p95_response_ms: number | null;
  active_sessions: number;
}

interface IDailyRow {
  day: string;
  requests: number;
  avg_latency_ms: number | null;
}

interface IRecentRow {
  method: string;
  path: string;
  status_code: number;
  created_at: string;
}

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

@Injectable()
export class GatewayAuditMongoRepository implements IGatewayAuditRepository {
  constructor(
    @Inject(AuditTenantConnectionManager)
    private readonly tenantConnections: TenantMongoConnectionManager,
  ) {}

  private async gatewayAuditCollection(tenantId: string) {
    const db = await ensureTenantNamespaceOnce(
      this.tenantConnections,
      tenantId,
      GATEWAY_AUDIT_MONGO_NAMESPACE,
      GATEWAY_AUDIT_MONGO_SCHEMA,
    );
    return db.collection<IStringIdDoc>("gateway_audit_events");
  }

  async insertGatewayEvent(
    tenantId: string,
    event: GatewayAuditEvent,
  ): Promise<void> {
    const collection = await this.gatewayAuditCollection(tenantId);

    const doc = {
      _id: event.requestId,
      trace_id: event.traceId,
      tenant_id: event.tenantId,
      method: event.method,
      path: event.path,
      status_code: event.statusCode,
      duration_ms: event.durationMs,
      client_ip: event.clientIp,
      user_agent: event.userAgent,
      jwt_subject: event.jwtSubject,
      route_type: event.routeType,
      upstream_url: event.upstream?.url ?? null,
      upstream_status: event.upstream?.statusCode ?? null,
      upstream_duration: event.upstream?.durationMs ?? null,
      rate_limit_applied: event.rateLimitApplied,
      rate_limit_remaining: event.rateLimitRemaining ?? null,
      error: event.error ?? null,
      correlation_id: event.correlationId ?? null,
      causation_id: event.causationId ?? null,
      depth: event.depth ?? null,
      created_at: new Date(event.timestamp),
    };

    try {
      await collection.insertMany([doc], { ordered: false });
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        return;
      }
      throw error;
    }
  }

  async queryEvents(
    params: IGatewayAuditQueryParams,
    tenantId: string,
  ): Promise<IStoredGatewayAuditEvent[]> {
    const { method, routeType, from, to, limit, offset } = params;
    const collection = await this.gatewayAuditCollection(tenantId);

    const filter: Filter<IStringIdDoc> = {};
    if (method) {
      filter.method = method;
    }
    if (routeType) {
      filter.route_type = routeType;
    }
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) {
        createdAt.$gte = new Date(from);
      }
      if (to) {
        createdAt.$lte = new Date(to);
      }
      filter.created_at = createdAt;
    }

    const docs = await collection
      .find(filter)
      .sort({ created_at: -1 })
      .skip(offset)
      .limit(limit)
      .toArray();

    return docs.map((doc) => mapGatewayAuditDoc(doc));
  }

  async getEventByRequestId(
    requestId: string,
    tenantId: string,
  ): Promise<IStoredGatewayAuditEvent | null> {
    const collection = await this.gatewayAuditCollection(tenantId);
    const doc = await collection.findOne({ _id: requestId });
    return doc ? mapGatewayAuditDoc(doc) : null;
  }

  private async getRequestCounts(
    collection: Collection<IStringIdDoc>,
  ): Promise<IAggregateRow[]> {
    const now = new Date();
    const startToday = startOfUtcDay(now);
    const startYesterday = new Date(startToday.getTime() - 86_400_000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
    const fifteenMinAgo = new Date(now.getTime() - 15 * 60_000);

    return collection
      .aggregate<IAggregateRow>([
        { $match: { created_at: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: null,
            requests_today: {
              $sum: {
                $cond: [{ $gte: ["$created_at", startToday] }, 1, 0],
              },
            },
            requests_yesterday: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$created_at", startYesterday] },
                      { $lt: ["$created_at", startToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            error_count_today: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$status_code", 400] },
                      { $gte: ["$created_at", startToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            error_count_yesterday: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$status_code", 400] },
                      { $gte: ["$created_at", startYesterday] },
                      { $lt: ["$created_at", startToday] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            avg_response_ms: {
              $avg: {
                $cond: [{ $gte: ["$created_at", startToday] }, "$duration_ms", null],
              },
            },
            avg_response_ms_yesterday: {
              $avg: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$created_at", startYesterday] },
                      { $lt: ["$created_at", startToday] },
                    ],
                  },
                  "$duration_ms",
                  null,
                ],
              },
            },
            p95_response_ms: {
              $percentile: {
                input: "$duration_ms",
                p: [0.95],
                method: "approximate",
              },
            },
            active_sessions: {
              $addToSet: {
                $cond: [
                  {
                    $and: [
                      { $gte: ["$created_at", fifteenMinAgo] },
                      { $ne: ["$jwt_subject", null] },
                    ],
                  },
                  "$jwt_subject",
                  "$$REMOVE",
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            requests_today: 1,
            requests_yesterday: 1,
            error_count_today: 1,
            error_count_yesterday: 1,
            avg_response_ms: 1,
            avg_response_ms_yesterday: 1,
            p95_response_ms: {
              $arrayElemAt: ["$p95_response_ms", 0],
            },
            active_sessions: { $size: "$active_sessions" },
          },
        },
      ])
      .toArray();
  }

  private async getDailyVolumeAndLatencyByDay(
    collection: Collection<IStringIdDoc>,
  ): Promise<IDailyRow[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);

    return collection
      .aggregate<IDailyRow>([
        { $match: { created_at: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: {
              $dateToString: { format: "%Y-%m-%d", date: "$created_at" },
            },
            requests: { $sum: 1 },
            avg_latency_ms: { $avg: "$duration_ms" },
          },
        },
        { $sort: { _id: 1 } },
        {
          $project: {
            _id: 0,
            day: "$_id",
            requests: 1,
            avg_latency_ms: 1,
          },
        },
      ])
      .toArray();
  }

  private async getRecentGatewayRequests(
    collection: Collection<IStringIdDoc>,
  ): Promise<IRecentRow[]> {
    const twentyFourHoursAgo = new Date(Date.now() - 86_400_000);

    const docs = await collection
      .find({ created_at: { $gte: twentyFourHoursAgo } })
      .sort({ created_at: -1 })
      .limit(20)
      .project({ method: 1, path: 1, status_code: 1, created_at: 1 })
      .toArray();

    return docs.map((doc) => ({
      method: String(doc.method ?? ""),
      path: String(doc.path ?? ""),
      status_code: Number(doc.status_code ?? 0),
      created_at:
        doc.created_at instanceof Date
          ? doc.created_at.toISOString()
          : String(doc.created_at ?? ""),
    }));
  }

  async getDashboardStats(tenantId: string): Promise<AuditDashboardStats> {
    const collection = await this.gatewayAuditCollection(tenantId);

    const [aggregateRows, dailyRows, recentRows] = await Promise.all([
      this.getRequestCounts(collection),
      this.getDailyVolumeAndLatencyByDay(collection),
      this.getRecentGatewayRequests(collection),
    ]);

    const agg = aggregateRows[0];
    const requestsToday = Number(agg?.requests_today ?? 0);
    const requestsYesterday = Number(agg?.requests_yesterday ?? 0);
    const errorCountToday = Number(agg?.error_count_today ?? 0);
    const errorCountYesterday = Number(agg?.error_count_yesterday ?? 0);

    const errorRate =
      requestsToday > 0 ? (errorCountToday / requestsToday) * 100 : 0;
    const errorRateYesterday =
      requestsYesterday > 0
        ? (errorCountYesterday / requestsYesterday) * 100
        : 0;

    const recentActivity: DashboardActivity[] = recentRows.map((r) => ({
      type: "gateway.request",
      text: `${r.method} ${r.path} -> ${r.status_code}`,
      timestamp: r.created_at,
    }));

    return {
      requestsToday,
      requestsYesterday,
      avgResponseMs: Math.round(Number(agg?.avg_response_ms ?? 0)),
      avgResponseMsYesterday: Math.round(
        Number(agg?.avg_response_ms_yesterday ?? 0),
      ),
      errorRate: Math.round(errorRate * 100) / 100,
      errorRateYesterday: Math.round(errorRateYesterday * 100) / 100,
      p95ResponseMs: Math.round(Number(agg?.p95_response_ms ?? 0)),
      activeSessions: Number(agg?.active_sessions ?? 0),
      dailyBreakdown: dailyRows.map((r) => ({
        date: r.day,
        requests: Number(r.requests),
        avgLatencyMs: Math.round(Number(r.avg_latency_ms ?? 0)),
      })),
      recentActivity,
    };
  }
}
