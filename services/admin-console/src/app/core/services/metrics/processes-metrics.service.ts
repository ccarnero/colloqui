import { HttpClient } from "@angular/common/http";
import { Injectable, inject, signal, type Signal } from "@angular/core";
import { environment } from "../../../../environments/environment";

/**
 * Processes section metrics (workflows).
 *
 * `workflowsTotal` backs the sub-nav "created resources" badge and is
 * hydrated once via `loadCounts()`. The demo seeds below remain for the
 * section landing KPIs until those are wired to real data.
 *
 * The workflow count is fetched with a direct HTTP call rather than the
 * feature-layer `WorkflowApiService` to keep core free of feature imports.
 */
@Injectable({ providedIn: "root" })
export class ProcessesMetricsService {
  private readonly http = inject(HttpClient);
  private countsLoaded = false;

  /** Total workflows created for the tenant. */
  readonly workflowsTotal = signal<number | null>(null);

  readonly workflowsActive = signal<number | null>(28);
  readonly workflowsFailing = signal<number | null>(3);
  readonly executionsSuccessToday = signal<number | null>(4_812);
  readonly executionsFailedToday = signal<number | null>(64);

  /** Fetches the workflow count once. */
  loadCounts(): void {
    if (this.countsLoaded) return;
    this.countsLoaded = true;
    this.http
      .get<unknown[]>(`${environment.apiUrl}/workflows`)
      .subscribe({
        next: (rows) => this.workflowsTotal.set(rows.length),
        error: () => this.workflowsTotal.set(null),
      });
  }

  /** Forces a re-fetch of the counts (e.g. after a create/delete). */
  reload(): void {
    this.countsLoaded = false;
    this.loadCounts();
  }

  resolve(source: string): Signal<number | null> | null {
    switch (source) {
      case "processes.workflows.total":
        return this.workflowsTotal;
      case "processes.workflows.failing":
        return this.workflowsFailing;
      case "processes.workflows.active":
        return this.workflowsActive;
      default:
        return null;
    }
  }
}
