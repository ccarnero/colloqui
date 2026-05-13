import { Injectable, signal, type Signal } from "@angular/core";

/**
 * Processes section metrics (workflows).
 *
 * PHASE 4 DEMO SEEDS — replace with real fetches when backend lands.
 */
@Injectable({ providedIn: "root" })
export class ProcessesMetricsService {
  readonly workflowsActive = signal<number | null>(28);
  readonly workflowsFailing = signal<number | null>(3);
  readonly executionsSuccessToday = signal<number | null>(4_812);
  readonly executionsFailedToday = signal<number | null>(64);

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "processes.workflows.failing":
        return this.workflowsFailing;
      case "processes.workflows.active":
        return this.workflowsActive;
      default:
        return null;
    }
  }
}
