export interface DashboardDailyBreakdown {
  date: string;
  requests: number;
  avgLatencyMs: number;
}

export interface DashboardQuota {
  used: number;
  limit: number;
}

export interface DashboardActivity {
  type: string;
  text: string;
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

export interface AuditDashboardStats {
  requestsToday: number;
  requestsYesterday: number;
  avgResponseMs: number;
  avgResponseMsYesterday: number;
  errorRate: number;
  errorRateYesterday: number;
  p95ResponseMs: number;
  activeSessions: number;
  dailyBreakdown: DashboardDailyBreakdown[];
  recentActivity: DashboardActivity[];
}

export const DASHBOARD_CACHE_KEY_PREFIX = "dashboard:stats:";
export const DASHBOARD_CACHE_TTL = 30;
