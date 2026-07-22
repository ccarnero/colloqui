import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { Router } from "@angular/router";
import { forkJoin, of } from "rxjs";
import { catchError } from "rxjs/operators";
import {
  type InventoryTableColumn,
  InventoryTableComponent,
} from "../../../shared/components/inventory-table/inventory-table.component";
import { KpiCardComponent } from "../../../shared/components/kpi-card/kpi-card.component";
import {
  type AttentionSeverity,
  type IAttentionIssue,
  NeedsAttentionPanelComponent,
} from "../../../shared/components/needs-attention-panel/needs-attention-panel.component";
import { PageHeaderComponent } from "../../../shared/components/page-header/page-header.component";
import { UtcDatePipe } from "../../../shared/pipes/utc-date.pipe";
import {
  type IWorkflowDefinitionDto,
  type IWorkflowsSummary,
  WorkflowApiService,
} from "./services/workflow-api.service";
import {
  deriveWorkflowStatusLabel,
  mapWorkflowStatusToHealth,
} from "./workflow-status.helpers";

/**
 * Workflow list view (route `/workflows`, unchanged). Rebuilt per
 * `manual-loops/admin-console/console-redesign-processes-builder.md` T02:
 * MetricCard row + InventoryTable + NeedsAttentionPanel, following the
 * `AiAgentsPageComponent` composition
 * (`features/automation/ai/ai-agents-page.component.ts`). Data flow is
 * `WorkflowApiService.list()` (unchanged) plus the new `getSummary()`
 * wrapper for the existing `GET /workflows/summary` endpoint (T01
 * finding 1 - wiring gap, no new backend endpoint). Per T01 finding 1,
 * per-workflow success/error rate has no data source and is NOT
 * rendered; per-workflow sparklines have no backing series either
 * (T01 finding 1) and are NOT rendered.
 *
 * Enable/disable and delete moved to the workflow detail mini-app's
 * Settings tab (`detail/workflow-settings.component.ts`, which now
 * implements both — the enable/disable toggle exercises the same
 * `WorkflowApiService.setStatus` confirm/direct flow this list used to
 * have); this list is read-focused per the design
 * (`design/10-workflows.png`: name/trigger/actions/executions/
 * created/status + chevron, no inline mutation controls).
 */
@Component({
  selector: "app-workflows",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PageHeaderComponent,
    KpiCardComponent,
    InventoryTableComponent,
    NeedsAttentionPanelComponent,
  ],
  template: `
    <app-page-header
      title="Workflows"
      subtitle="Automate business processes"
    >
      <ng-container slot="actions">
        <button
          class="btn btn-primary btn-sm"
          type="button"
          (click)="createNew()"
        >
          + New Workflow
        </button>
      </ng-container>
    </app-page-header>

    @if (loading()) {
      <div class="metric-strip metric-strip--loading">
        <div class="metric-skeleton"></div>
      </div>
    } @else {
      <!-- Metric row: workflow/active counts are client-derived from the
           real workflow list; completed/failed (7d) come straight from the
           existing summary endpoint (T01 finding 1). No invented metrics. -->
      <div class="metric-strip">
        <app-kpi-card label="Workflows" [value]="totalWorkflows()" />
        <app-kpi-card label="Active" [value]="activeCount()" />
        <app-kpi-card label="Completed (7d)" [value]="completedLast7d()" />
        <app-kpi-card label="Failed (7d)" [value]="failedLast7d()" />
      </div>

      <!-- Workflows inventory: status column carries the health dot,
           derived purely from real fields (status/trigger,
           workflow-status.helpers.ts). Executions column is the real,
           7-day-windowed per-workflow run count from the summary
           endpoint's top-5 list; workflows outside that top 5 render an
           empty cell rather than a fabricated 0 (T02 spec). -->
      <app-inventory-table
        [columns]="workflowColumns"
        [rows]="workflows()"
        ariaLabel="Workflows"
        emptyMessage="No workflows yet. Create your first workflow to automate business processes."
        (rowClick)="onWorkflowRowClick($event)"
      />

      <!-- Needs attention: workflows in a non-ok state (disabled) per the
           same real mapping; deep-links to the existing /workflows/:id
           route. -->
      <app-needs-attention-panel
        title="Needs attention"
        subtitle="Workflows"
        [issues]="attentionIssues()"
        emptyMessage="No workflows need attention"
        (actionClick)="onAttentionActionClick($event)"
      />
    }
  `,
  styles: `
    .metric-strip {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: var(--rd-space-8, 16px);
      margin-bottom: var(--rd-space-8, 16px);
    }
    .metric-strip--loading {
      opacity: 0.4;
    }
    .metric-skeleton {
      grid-column: 1 / -1;
      height: 72px;
      border-radius: var(--rd-radius-7, 8px);
      background: var(--rd-line);
    }
    app-inventory-table {
      display: block;
      margin-bottom: var(--rd-space-8, 16px);
    }
  `,
})
export class WorkflowsComponent implements OnInit {
  private readonly api = inject(WorkflowApiService);
  private readonly router = inject(Router);
  private readonly utcDate = new UtcDatePipe();

  readonly workflows = signal<IWorkflowDefinitionDto[]>([]);
  readonly summary = signal<IWorkflowsSummary | null>(null);
  readonly loading = signal(true);

  /**
   * `definitionId -> 7d run count` lookup, built from the summary
   * endpoint's `topByExecutionCountLast7d` (top 5 workflows only, per
   * T01 finding 1). Workflows outside that top 5 have no entry here.
   */
  private readonly runCountsLast7d = computed(() => {
    const rows = this.summary()?.topByExecutionCountLast7d ?? [];
    return new Map(rows.map((row) => [row.definition_id, row.count]));
  });

  readonly totalWorkflows = computed(() => this.workflows().length);

  readonly activeCount = computed(
    () =>
      this.workflows().filter(
        (wf) => deriveWorkflowStatusLabel(wf) === "active"
      ).length
  );

  readonly completedLast7d = computed(
    () => this.summary()?.executionsCompletedLast7d ?? 0
  );

  readonly failedLast7d = computed(
    () => this.summary()?.executionsFailedLast7d ?? 0
  );

  /**
   * Columns per the design (`design/10-workflows.png`): Name, Trigger,
   * Actions, Executions (7d), Created, Status. All values come from real
   * `IWorkflowDefinitionDto` fields or the summary endpoint - no
   * invented data.
   */
  readonly workflowColumns: InventoryTableColumn<IWorkflowDefinitionDto>[] = [
    {
      key: "name",
      header: "Name",
      type: "text",
      value: (wf) => wf.name,
      width: "2fr",
    },
    {
      key: "trigger",
      header: "Trigger",
      type: "text",
      value: (wf) => this.triggerSummary(wf),
      width: "1.6fr",
    },
    {
      key: "actions",
      header: "Actions",
      type: "mono",
      value: (wf) => String(this.actionCount(wf)),
      width: "0.9fr",
    },
    {
      key: "executions",
      header: "Executions (7d)",
      type: "mono",
      value: (wf) => this.executionsLast7dLabel(wf),
      width: "1fr",
    },
    {
      key: "created",
      header: "Created",
      type: "text",
      value: (wf) => this.createdLabel(wf),
      width: "1fr",
    },
    {
      key: "status",
      header: "Status",
      type: "status-badge",
      value: (wf) => deriveWorkflowStatusLabel(wf),
      health: (wf) => mapWorkflowStatusToHealth(deriveWorkflowStatusLabel(wf)),
      width: "0.9fr",
    },
  ];

  /** Workflows whose derived health is "warn" or "error" (disabled). */
  readonly attentionIssues = computed<IAttentionIssue[]>(() => {
    const issues: IAttentionIssue[] = [];
    for (const wf of this.workflows()) {
      const health = mapWorkflowStatusToHealth(deriveWorkflowStatusLabel(wf));
      if (health !== "warn" && health !== "error") {
        continue;
      }
      issues.push({
        id: wf.id,
        message: `${wf.name} is disabled.`,
        severity: this.healthToSeverity(health),
        action: { label: "Open workflow" },
      });
    }
    if (issues.length === 0) {
      // Verbose logging: empty attention list must not fail silently.
      console.debug(
        "[WorkflowsComponent] no workflows in warn/error state, needs-attention panel will render its empty state"
      );
    }
    return issues;
  });

  ngOnInit(): void {
    this.loadWorkflows();
  }

  private loadWorkflows(): void {
    this.loading.set(true);
    // Run both requests in parallel so total wall time is `max(list,
    // summary)` instead of `list + summary`. `catchError` on the summary
    // stream isolates failures: a summary outage shouldn't blank out the
    // workflow list, only zero out the metric row / 7d run counts.
    forkJoin({
      list: this.api.list(),
      summary: this.api
        .getSummary()
        .pipe(catchError(() => of<IWorkflowsSummary | null>(null))),
    }).subscribe({
      next: ({ list, summary }) => {
        this.workflows.set(list);
        this.summary.set(summary);
        this.loading.set(false);
        console.debug("[WorkflowsComponent] workflows loaded", {
          count: list.length,
          summaryLoaded: summary !== null,
        });
      },
      error: (error: unknown) => {
        this.loading.set(false);
        console.error("[WorkflowsComponent] failed to load workflows", {
          error,
        });
      },
    });
  }

  createNew(): void {
    this.router.navigate(["/workflows", "new"]).catch((error: unknown) => {
      console.error(
        "[WorkflowsComponent] navigation to new-workflow route failed",
        { error }
      );
    });
  }

  /**
   * Row click opens the workflow detail mini-app (Overview sub-tab, the
   * existing `/workflows/:id` route - T01 finding, `app.routes.ts:310`).
   */
  onWorkflowRowClick(wf: IWorkflowDefinitionDto): void {
    console.debug("[WorkflowsComponent] workflow row clicked, navigating", {
      workflowId: wf.id,
    });
    this.router.navigate(["/workflows", wf.id]).catch((error: unknown) => {
      console.error("[WorkflowsComponent] navigation to workflow failed", {
        workflowId: wf.id,
        error,
      });
    });
  }

  /**
   * Needs-attention action link navigates to the same detail route as
   * the row click; `issue.id` is the workflow id (see `attentionIssues`).
   */
  onAttentionActionClick(issue: IAttentionIssue): void {
    console.debug(
      "[WorkflowsComponent] needs-attention action clicked, navigating",
      { workflowId: issue.id }
    );
    this.router.navigate(["/workflows", issue.id]).catch((error: unknown) => {
      console.error(
        "[WorkflowsComponent] navigation from needs-attention panel failed",
        { workflowId: issue.id, error }
      );
    });
  }

  private healthToSeverity(health: "warn" | "error"): AttentionSeverity {
    return health === "error" ? "critical" : "warning";
  }

  protected triggerLabel(wf: IWorkflowDefinitionDto): string {
    if (!wf.trigger) {
      return "No trigger";
    }
    const t = wf.trigger as { type: string };
    return t.type === "message_received" ? "Channel" : t.type;
  }

  /** Matches the design's combined "Trigger · application" sub-line (`design/10-workflows.png`). */
  protected triggerSummary(wf: IWorkflowDefinitionDto): string {
    return `${this.triggerLabel(wf)} · ${wf.application}`;
  }

  protected actionCount(wf: IWorkflowDefinitionDto): number {
    return Array.isArray(wf.actions) ? wf.actions.length : 0;
  }

  /**
   * 7-day-windowed run count for this workflow, sourced from the summary
   * endpoint's top-5 list. Absent (not in the top 5) renders as an empty
   * cell, never a fabricated `0` (T02 spec - the design has no em-dash
   * convention for this column, so the cell is left blank rather than
   * showing a placeholder).
   */
  protected executionsLast7dLabel(wf: IWorkflowDefinitionDto): string {
    const count = this.runCountsLast7d().get(wf.id);
    return count === undefined ? "" : count.toLocaleString("en-US");
  }

  protected createdLabel(wf: IWorkflowDefinitionDto): string {
    return this.utcDate.transform(wf.createdAt, "mediumDate") ?? "";
  }
}
