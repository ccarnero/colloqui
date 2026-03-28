import { Inject, Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import { tracedFetch } from "@yoizen/observability";
import {
  TENANT_HEADER,
  DASHBOARD_CACHE_KEY_PREFIX,
  DASHBOARD_CACHE_TTL,
  type AuditDashboardStats,
  type DashboardStats,
} from "@yoizen/shared";
import { REDIS_CLIENT } from "../../providers/redis.provider";
import { throwProxyError } from "../../utils/proxy-error.util";

interface ServiceHealthEntry {
  status: string;
  [key: string]: unknown;
}

interface HealthResponse {
  status: string;
  nats: string;
  redis: string;
  services: Record<string, ServiceHealthEntry | "unreachable">;
}

const HEALTH_TIMEOUT_MS = 4_000;
const AUDIT_TIMEOUT_MS = 8_000;

@Injectable()
export class DashboardProxyService {
  private readonly logger = new Logger(DashboardProxyService.name);
  private readonly auditBaseUrl: string;
  private readonly healthUrl: string;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.auditBaseUrl =
      process.env.AUDIT_SERVICE_URL ??
      "http://audit-service.platform-services.svc.cluster.local";
    this.healthUrl = `http://localhost:${process.env.PORT ?? "3000"}/health`;
  }

  /**
   * Returns full dashboard stats for a tenant.
   * Results are cached in Redis for DASHBOARD_CACHE_TTL seconds.
   */
  async getStats(tenantId: string): Promise<DashboardStats> {
    const cacheKey = `${DASHBOARD_CACHE_KEY_PREFIX}${tenantId}`;

    const cached = await this.redis.get(cacheKey).catch(() => null);
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

  private async fetchHealth(): Promise<HealthResponse> {
    try {
      const res = await tracedFetch(this.healthUrl, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (res.ok) {
        return res.json() as Promise<HealthResponse>;
      }
    } catch {
      this.logger.warn("Health endpoint unreachable during dashboard fetch");
    }
    return { status: "unknown", nats: "unknown", redis: "unknown", services: {} };
  }

  private buildDashboardStats(
    audit: AuditDashboardStats,
    health: HealthResponse,
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
        typeof val === "object" && val.status === "ok"
          ? "ok"
          : "unreachable";
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
