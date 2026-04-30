import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { PinoLoggerService, tracedFetch } from "@yoizen/observability";
import {
  TENANT_HEADER,
  DASHBOARD_CACHE_KEY_PREFIX,
  DASHBOARD_CACHE_TTL,
  type AuditDashboardStats,
  type DashboardStats,
} from "@yoizen/shared";
import { gatewayConfig } from "../../config";
import { REDIS_CLIENT } from "../../providers/redis.provider";
import { throwProxyError } from "../../utils/proxy-error.util";

interface IServiceHealthEntry {
  status: string;
  [key: string]: unknown;
}

interface IHealthResponse {
  status: string;
  nats: string;
  redis: string;
  services: Record<string, IServiceHealthEntry | "unreachable">;
}

const HEALTH_TIMEOUT_MS = 4_000;
const AUDIT_TIMEOUT_MS = 8_000;

@Injectable()
export class DashboardProxyService {
  private readonly logger = new PinoLoggerService(DashboardProxyService.name);
  private readonly auditBaseUrl: string;
  private readonly healthUrl: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.auditBaseUrl = gatewayConfig.services.audit;
    this.healthUrl = `${gatewayConfig.selfBaseUrl}/health`;
  }

  /**
   * Returns full dashboard stats for a tenant.
   * Results are cached in Redis for DASHBOARD_CACHE_TTL seconds.
   */
  async getStats(tenantId: string): Promise<DashboardStats> {
    const cacheKey = `${DASHBOARD_CACHE_KEY_PREFIX}${tenantId}`;

    const cached = await this.redis.get(cacheKey).catch((err: unknown) => {
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.debug(`Dashboard Redis cache read skipped: ${detail}`);
      return null;
    });
    if (cached) {
      return JSON.parse(cached) as DashboardStats;
    }

    const [auditStats, healthData] = await Promise.all([
      this.fetchAuditStats(tenantId),
      this.fetchHealth(),
    ]);

    const stats = this.buildDashboardStats(auditStats, healthData);

    await this.redis
      .set(cacheKey, JSON.stringify(stats), "EX", DASHBOARD_CACHE_TTL)
      .catch((err) => {
        this.logger.warn(`Failed to cache dashboard stats: ${err}`);
      });

    return stats;
  }

  private async fetchAuditStats(
    tenantId: string,
  ): Promise<AuditDashboardStats> {
    const url = `${this.auditBaseUrl}/audit/gateway/stats`;
    const res = await tracedFetch(url, {
      headers: { [TENANT_HEADER]: tenantId },
      signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
    });
    if (!res.ok) {
      await throwProxyError(res, "Audit service", this.logger);
    }
    return res.json() as Promise<AuditDashboardStats>;
  }

  private async fetchHealth(): Promise<IHealthResponse> {
    try {
      const res = await tracedFetch(this.healthUrl, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.ok) {
        return res.json() as Promise<IHealthResponse>;
      }
    } catch {
      this.logger.warn("Health endpoint unreachable during dashboard fetch");
    }
    return {
      status: "unknown",
      nats: "unknown",
      redis: "unknown",
      services: {},
    };
  }

  private buildDashboardStats(
    audit: AuditDashboardStats,
    health: IHealthResponse,
  ): DashboardStats {
    const requestsDelta =
      audit.requestsYesterday > 0
        ? ((audit.requestsToday - audit.requestsYesterday) /
            audit.requestsYesterday) *
          100
        : 0;

    const avgDelta = audit.avgResponseMs - audit.avgResponseMsYesterday;
    const errorDelta = audit.errorRate - audit.errorRateYesterday;

    const serviceEntries = Object.entries(health.services);
    const okCount = serviceEntries.filter(
      ([, v]) => typeof v === "object" && v.status === "ok",
    ).length;
    const totalServices = serviceEntries.length || 1;
    const uptime = Math.round((okCount / totalServices) * 10000) / 100;

    const serviceHealth: Record<string, "ok" | "unreachable"> = {};
    for (const [name, val] of serviceEntries) {
      serviceHealth[name] =
        typeof val === "object" && val.status === "ok" ? "ok" : "unreachable";
    }

    const dayLabels = audit.dailyBreakdown.map((d) => {
      const date = new Date(d.date);
      return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
        date.getUTCDay()
      ];
    });

    return {
      requestsToday: audit.requestsToday,
      requestsTodayDelta: Math.round(requestsDelta * 100) / 100,
      activeSessions: audit.activeSessions,
      avgResponseMs: audit.avgResponseMs,
      avgResponseDelta: Math.round(avgDelta),
      errorRate: audit.errorRate,
      errorRateDelta: Math.round(errorDelta * 100) / 100,
      dailyBreakdown: audit.dailyBreakdown,
      uptime,
      p95ResponseMs: audit.p95ResponseMs,
      quotaApiCalls: { used: audit.requestsToday, limit: 100_000 },
      quotaStorage: { used: 0, limit: 100 },
      quotaWebhooks: { used: 0, limit: 20 },
      recentActivity: audit.recentActivity,
      serviceHealth,
    };
  }
}
