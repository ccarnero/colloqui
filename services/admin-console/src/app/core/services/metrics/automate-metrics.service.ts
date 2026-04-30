import { Injectable, signal, type Signal } from "@angular/core";

/**
 * Automate section metrics (workflows, rules, scheduler, webhooks, services).
 *
 * Phase 1 stub: signals return `null`. Phase 2 wires real fetches.
 */
@Injectable({ providedIn: "root" })
export class AutomateMetricsService {
  // PHASE 2 DEMO SEEDS — replace with real fetches when backend lands.
  readonly workflowsActive = signal<number | null>(28);
  readonly workflowsFailing = signal<number | null>(3);
  readonly executionsSuccessToday = signal<number | null>(4_812);
  readonly executionsFailedToday = signal<number | null>(64);
  readonly servicesDown = signal<number | null>(0);

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "automate.workflows.failing":
        return this.workflowsFailing;
      case "automate.workflows.active":
        return this.workflowsActive;
      case "automate.services.down":
        return this.servicesDown;
      default:
        return null;
    }
  }
}
