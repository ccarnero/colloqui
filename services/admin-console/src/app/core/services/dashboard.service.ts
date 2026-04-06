import { Injectable, inject, signal, type OnDestroy } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { environment } from "../../../environments/environment";

export interface IDashboardDailyBreakdown {
  readonly date: string;
  readonly requests: number;
  readonly avgLatencyMs: number;
}

export interface IDashboardQuota {
  readonly used: number;
  readonly limit: number;
}

export interface IDashboardActivity {
  readonly type: string;
  readonly text: string;
  readonly timestamp: string;
}

export interface IDashboardStats {
  readonly requestsToday: number;
  readonly requestsTodayDelta: number;
  readonly activeSessions: number;
  readonly avgResponseMs: number;
  readonly avgResponseDelta: number;
  readonly errorRate: number;
  readonly errorRateDelta: number;
  readonly dailyBreakdown: IDashboardDailyBreakdown[];
  readonly uptime: number;
  readonly p95ResponseMs: number;
  readonly quotaApiCalls: IDashboardQuota;
  readonly quotaStorage: IDashboardQuota;
  readonly quotaWebhooks: IDashboardQuota;
  readonly recentActivity: IDashboardActivity[];
  readonly serviceHealth: Record<string, "ok" | "unreachable">;
}

const REFRESH_INTERVAL_MS = 60_000;

@Injectable({ providedIn: "root" })
export class DashboardService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  readonly stats = signal<IDashboardStats | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** Fetches stats once and starts a periodic refresh. */
  startPolling(): void {
    this.fetchStats();
    this.stopPolling();
    this.refreshTimer = setInterval(
      () => this.fetchStats(),
      REFRESH_INTERVAL_MS,
    );
  }

  stopPolling(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private fetchStats(): void {
    this.loading.set(true);
    this.error.set(null);

    this.http
      .get<IDashboardStats>(`${environment.apiUrl}/dashboard/stats`)
      .subscribe({
        next: (data) => {
          this.stats.set(data);
          this.loading.set(false);
        },
        error: (err) => {
          this.error.set(err?.message ?? "Failed to load dashboard stats");
          this.loading.set(false);
        },
      });
  }
}
