import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import {
  type ITrackingChainResponse,
  TrackingChainService,
} from "../../../core/services/tracking-chain.service";
import { RunViewComponent } from "../run-view/run-view.component";
import { CausalGraphComponent } from "./causal-graph/causal-graph.component";
import { findWorkflowRuns } from "./domain/find-workflow-runs";
import { MessageTraceComponent } from "./message-trace.component";
import { TraceWaterfallComponent } from "./waterfall/trace-waterfall.component";

/** The four ways to look at a correlation's tracked-event chain — "run"
 * only appears when the chain contains a workflow run (T06 of
 * `manual-loops/run-view.md`, entry (b)). */
export type TraceViewTab = "waterfall" | "causal" | "legacy" | "run";

const TABS: ReadonlyArray<{
  readonly id: TraceViewTab;
  readonly label: string;
}> = [
  { id: "waterfall", label: "Waterfall" },
  { id: "causal", label: "Causal graph" },
  { id: "legacy", label: "Legacy" },
];

const RUN_TAB = { id: "run" as const, label: "Run view" };

/**
 * Container for `processes/trace/:correlationId` — fetches the tracking
 * chain ONCE via `TrackingChainService` and feeds it to the Waterfall and
 * Causal graph views. The pre-existing client-side assembly
 * (`assemble-trace.ts` via `MessageTraceComponent`) stays available,
 * unmodified, as the third "Legacy" tab (SPEC.md `manual-loops/trace-console.md` T07).
 */
@Component({
  selector: "app-trace-detail",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CausalGraphComponent,
    MessageTraceComponent,
    TraceWaterfallComponent,
    RunViewComponent,
  ],
  template: `
    <header class="td-head">
      <div>
        <h1>Trace · {{ correlationId() }}</h1>
        <span class="td-sub">Processes › Trace</span>
      </div>
    </header>

    <div class="td-tabs" role="tablist" aria-label="Trace view">
      @for (t of visibleTabs(); track t.id) {
        <button
          type="button"
          role="tab"
          class="td-tab"
          [class.is-active]="activeTab() === t.id"
          [attr.aria-selected]="activeTab() === t.id"
          (click)="activeTab.set(t.id)"
        >
          {{ t.label }}
        </button>
      }
    </div>

    @if (activeTab() === "legacy") {
      <app-message-trace />
    } @else if (activeTab() === "run") {
      @if (workflowRun(); as run) {
        <!-- T06 finding fix (manual-loops/run-view.md): no definitionId
             input here — findWorkflowRuns only has the Temporal
             workflow/run ids from the chain's events, not the workflow
             DEFINITION id. RunViewComponent degrades gracefully: it skips
             the definition fetch (no 404 against the Temporal id) and the
             header falls back to the raw workflow id instead of the name. -->
        <app-run-view [workflowId]="run.workflowId" [runId]="run.runId" />
      }
    } @else {
      @if (loading()) {
        <p class="td-muted">Loading…</p>
      }
      @if (error()) {
        <p class="td-error">{{ error() }}</p>
      }
      @if (chain(); as c) {
        @if (activeTab() === "waterfall") {
          <app-trace-waterfall [chain]="c" />
        } @else if (activeTab() === "causal") {
          <app-causal-graph [chain]="c" />
        }
      }
    }
  `,
  styles: `
    :host { display: block; padding: 16px; }
    h1 { font-size: 18px; margin: 0; }
    .td-sub, .td-muted { color: var(--text-muted, #888); font-size: 12px; }
    .td-head { margin-bottom: 12px; }
    .td-error { color: var(--text-danger, #b3261e); }
    .td-tabs {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      margin-bottom: 16px;
      background: var(--bg2, #f5f5f5);
      border: 1px solid var(--border, #d8d8d8);
      border-radius: 8px;
    }
    .td-tab {
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted, #666);
      background: transparent;
      border: 0;
      border-radius: 6px;
      cursor: pointer;
      transition: color 0.15s, background 0.15s;
    }
    .td-tab:hover { color: var(--text, inherit); }
    .td-tab.is-active {
      background: var(--bg, #fff);
      color: var(--text, inherit);
      box-shadow: inset 0 0 0 1px var(--border, #d8d8d8);
    }
  `,
})
export class TraceDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly trackingChainService = inject(TrackingChainService);

  readonly tabs = TABS;
  readonly correlationId = signal("");
  readonly activeTab = signal<TraceViewTab>("waterfall");
  readonly chain = signal<ITrackingChainResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** T06 (entry b): distinct workflow runs found in the chain's events.
   * `manual-loops/run-view.md` T06: "pick the FIRST workflow run" when a
   * shared trigger fans out to more than one — DESIGN-run-view.md does not
   * mandate a selector, so this stays the simple documented choice. */
  private readonly workflowRuns = computed(() => {
    const c = this.chain();
    return c ? findWorkflowRuns(c.events) : [];
  });

  readonly workflowRun = computed(() => this.workflowRuns()[0] ?? null);

  /** "Run view" only appears once the chain resolved and contains a
   * workflow run (SPEC.md: tab appears WHEN the chain contains a run). */
  readonly visibleTabs = computed(() =>
    this.workflowRuns().length > 0 ? [...TABS, RUN_TAB] : TABS
  );

  ngOnInit(): void {
    const cid = this.route.snapshot.paramMap.get("correlationId") ?? "";
    this.correlationId.set(cid);
    if (!cid) {
      return;
    }
    this.loadChain(cid);
  }

  private loadChain(correlationId: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.trackingChainService.getChain(correlationId).subscribe({
      next: (c) => {
        this.chain.set(c);
        this.loading.set(false);
      },
      error: (err: { status?: number }) => {
        this.error.set(
          err?.status === 404
            ? "No tracking chain found for this correlation."
            : "Failed to load tracking chain."
        );
        this.loading.set(false);
      },
    });
  }
}
