import { Injectable, signal, type Signal } from "@angular/core";

/**
 * Overview (cross-section) metrics — used by the global dashboard.
 *
 * Phase 1 stub: signals return `null`. Phase 2 wires real fetches.
 */
@Injectable({ providedIn: "root" })
export class OverviewMetricsService {
  readonly conversationsActive = signal<number | null>(null);
  readonly messages24h = signal<number | null>(null);
  readonly aiInvocations24h = signal<number | null>(null);
  readonly workflowRuns24h = signal<number | null>(null);
  readonly errorRate24h = signal<number | null>(null);

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "overview.conversations.active":
        return this.conversationsActive;
      default:
        return null;
    }
  }
}
