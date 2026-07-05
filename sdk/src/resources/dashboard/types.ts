/**
 * Request/response types for the `dashboard` resource, hand-typed against
 * the REAL gateway shape (verified 2026-07-04, see sdk/GROWTH-PLAN.md Phase
 * 2 priority 6):
 *
 * - `services/api-gateway/src/modules/dashboard/dashboard.controller.ts` +
 *   `dashboard-proxy.service.ts` — `GET /dashboard/stats` is NOT a simple
 *   downstream proxy. It's a gateway-LOCAL aggregation: checks a Redis cache
 *   first (`DASHBOARD_CACHE_KEY_PREFIX` + tenant, TTL
 *   `DASHBOARD_CACHE_TTL`); on a miss, runs `fetchAuditStats()` (calls
 *   `GET {audit-service}/audit/gateway/stats` — an endpoint that itself is
 *   NOT exposed as a public gateway route, see `../audit/types.ts`) and
 *   `fetchHealth()` (the gateway calling its OWN `/health`) in parallel,
 *   combines them, and re-caches the result.
 * - `packages/shared/src/dashboard.interfaces.ts` (`DashboardStats`) defines
 *   the response shape.
 *
 * Behavioral notes:
 * - Results are Redis-cached for `DASHBOARD_CACHE_TTL` seconds — callers
 *   should not expect real-time state within that window.
 * - `quotaApiCalls`/`quotaStorage`/`quotaWebhooks` are PARTIALLY SYNTHETIC:
 *   the "used" side reflects real audit-service counts where available
 *   (e.g. `quotaApiCalls.used` = today's request count), but the "limit"
 *   side is a hardcoded constant (100_000 / 100 / 20), not derived from any
 *   real quota/billing system.
 * - No query params, no pagination — a single `GET` call.
 */

export interface DashboardDailyBreakdown {
  /** ISO-8601 date (no time component). */
  date: string;
  requests: number;
  avgLatencyMs: number;
}

export interface DashboardQuota {
  used: number;
  /** Hardcoded constant today, not a real quota/billing figure — see `types.ts`. */
  limit: number;
}

export interface DashboardActivity {
  type: string;
  text: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
}

export interface DashboardStats {
  requestsToday: number;
  requestsTodayDelta: number;
  activeSessions: number;
  avgResponseMs: number;
  avgResponseDelta: number;
  errorRate: number;
  errorRateDelta: number;
  dailyBreakdown: DashboardDailyBreakdown[];
  uptime: number;
  p95ResponseMs: number;
  quotaApiCalls: DashboardQuota;
  quotaStorage: DashboardQuota;
  quotaWebhooks: DashboardQuota;
  recentActivity: DashboardActivity[];
  serviceHealth: Record<string, "ok" | "unreachable">;
}
