import { Inject, Injectable } from "@nestjs/common";
import type { TenantMongoConnectionManager } from "@yoizen/database";
import { YoizenclawTenantConnectionManager } from "../../providers/tenant-connection-manager";
import { TenantScopedMongoRepository } from "../../providers/tenant-scoped.repository";
import type {
  IMcpUsage,
  IMcpUsageRecentCall,
  IMcpUsageRepository,
  IRecordMcpUsageEventData,
} from "./mcp-usage.repository.interface";

/** Mongo's duplicate-key error code — Postgres's `ON CONFLICT DO NOTHING` equivalent when caught explicitly. */
const MONGO_DUPLICATE_KEY_ERROR_CODE = 11000;

interface IMcpCallEventDoc {
  _id: string;
  tenant_id: string;
  mcp_server_id: string | null;
  server_name: string;
  tool_name: string;
  success: boolean;
  duration_ms: number;
  error: string | null;
  correlation_id: string | null;
  causation_id: string | null;
  execution_id: string | null;
  created_at: Date;
}

/** Mongo-backed sibling of {@link McpUsagePostgresRepository}, mirroring `mcp_servers`' own dual repository setup. */
@Injectable()
export class McpUsageMongoRepository
  extends TenantScopedMongoRepository
  implements IMcpUsageRepository
{
  constructor(
    @Inject(YoizenclawTenantConnectionManager)
    connectionManager: TenantMongoConnectionManager,
  ) {
    super(connectionManager);
  }

  /**
   * Inserts one `mcp_call_events` doc, idempotent on `eventId`
   * (metering-foundation.md G4) — `_id` is the producer-generated event id
   * instead of a freshly minted one, so a retried delivery (client-side
   * retry, or a redelivered Temporal activity) collides on `_id` rather than
   * creating a duplicate. Mongo has no `ON CONFLICT DO NOTHING`, so a
   * duplicate-key error (code 11000) is caught and swallowed here as the
   * equivalent no-op.
   */
  async record(
    tenantId: string,
    data: IRecordMcpUsageEventData
  ): Promise<void> {
    const db = await this.getDb(tenantId);
    const doc: IMcpCallEventDoc = {
      _id: data.eventId,
      tenant_id: tenantId,
      mcp_server_id: data.mcpServerId ?? null,
      server_name: data.serverName,
      tool_name: data.toolName,
      success: data.success,
      duration_ms: data.durationMs,
      error: data.error ?? null,
      correlation_id: data.correlationId ?? null,
      causation_id: data.causationId ?? null,
      execution_id: data.executionId ?? null,
      created_at: new Date(),
    };
    try {
      await db.collection<IMcpCallEventDoc>("mcp_call_events").insertOne(doc);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: number }).code === MONGO_DUPLICATE_KEY_ERROR_CODE
      ) {
        return;
      }
      throw error;
    }
  }

  async getUsage(
    tenantId: string,
    mcpServerId: string,
    windowDays: number,
    recentLimit: number
  ): Promise<IMcpUsage> {
    const db = await this.getDb(tenantId);
    const collection = db.collection<IMcpCallEventDoc>("mcp_call_events");
    const windowStart = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

    const [summaryAgg, recentDocs] = await Promise.all([
      collection
        .aggregate<{
          totalCalls: number;
          successCalls: number;
          avgDurationMs: number;
        }>([
          {
            $match: {
              tenant_id: tenantId,
              mcp_server_id: mcpServerId,
              created_at: { $gte: windowStart },
            },
          },
          {
            $group: {
              _id: null,
              totalCalls: { $sum: 1 },
              successCalls: { $sum: { $cond: ["$success", 1, 0] } },
              avgDurationMs: { $avg: "$duration_ms" },
            },
          },
        ])
        .toArray(),
      collection
        .find({ tenant_id: tenantId, mcp_server_id: mcpServerId })
        .sort({ created_at: -1 })
        .limit(recentLimit)
        .toArray(),
    ]);

    const agg = summaryAgg[0];
    const totalCalls = agg?.totalCalls ?? 0;
    const successCalls = agg?.successCalls ?? 0;

    const recentCalls: IMcpUsageRecentCall[] = recentDocs.map((doc) => ({
      toolName: doc.tool_name,
      success: doc.success,
      durationMs: doc.duration_ms,
      error: doc.error,
      createdAt: doc.created_at,
    }));

    return {
      windowDays,
      summary: {
        totalCalls,
        successCalls,
        errorCalls: totalCalls - successCalls,
        avgDurationMs: Math.round(agg?.avgDurationMs ?? 0),
      },
      recentCalls,
    };
  }
}
