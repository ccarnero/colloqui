import { HttpClient } from "@angular/common/http";
import { Injectable, inject, type Signal, signal } from "@angular/core";
import { forkJoin } from "rxjs";
import { environment } from "../../../../environments/environment";

interface IWorkflowRow {
  id: string;
  name: string;
}

export interface ITopWorkflowEntry {
  id: string;
  name: string;
  runs7d: number;
  successRate: number;
}

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

  /** Total workflows created for the tenant. */
  readonly workflowsTotal = signal<number | null>(null);

  readonly workflowsActive = signal<number | null>(null);
  readonly workflowsFailing = signal<number | null>(null);
  readonly executionsSuccessToday = signal<number | null>(null);
  readonly executionsFailedToday = signal<number | null>(null);

  readonly topWorkflows = signal<ITopWorkflowEntry[]>([]);

  /** Fetches the workflow count. */
  loadCounts(): void {
    this.http.get<unknown[]>(`${environment.apiUrl}/workflows`).subscribe({
      next: (rows) => this.workflowsTotal.set(rows.length),
      error: () => this.workflowsTotal.set(null),
    });
  }

  /** Fetches top workflows by execution count. */
  loadTopWorkflows(): void {
    forkJoin({
      workflows: this.http.get<IWorkflowRow[]>(
        `${environment.apiUrl}/workflows`
      ),
      counts: this.http.get<Record<string, number>>(
        `${environment.apiUrl}/workflows/executions/counts`
      ),
    }).subscribe({
      next: ({ workflows, counts }) => {
        const nameMap = new Map(workflows.map((w) => [w.id, w.name]));
        const entries: ITopWorkflowEntry[] = Object.entries(counts)
          .filter(([id]) => nameMap.has(id))
          .map(([id, count]) => ({
            id,
            name: nameMap.get(id) ?? id,
            runs7d: count,
            successRate: 1,
          }))
          .sort((a, b) => b.runs7d - a.runs7d)
          .slice(0, 5);
        this.topWorkflows.set(entries);
      },
      error: () => {
        // leave signal as [] — template shows empty state
      },
    });
  }

  /** Forces a re-fetch of the counts (e.g. after a create/delete). */
  reload(): void {
    this.loadCounts();
    this.loadTopWorkflows();
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
