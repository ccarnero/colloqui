import {
  ChangeDetectionStrategy,
  Component,
  inject,
  type OnInit,
  signal,
} from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import {
  type ITrackingChainResponse,
  TrackingChainService,
} from "../../../core/services/tracking-chain.service";
import { CausalGraphComponent } from "./causal-graph/causal-graph.component";
import { MessageTraceComponent } from "./message-trace.component";
import { TraceWaterfallComponent } from "./waterfall/trace-waterfall.component";

/** The three ways to look at a correlation's tracked-event chain. */
export type TraceViewTab = "waterfall" | "causal" | "legacy";

const TABS: ReadonlyArray<{
  readonly id: TraceViewTab;
  readonly label: string;
}> = [
  { id: "waterfall", label: "Waterfall" },
  { id: "causal", label: "Causal graph" },
  { id: "legacy", label: "Legacy" },
];

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
  ],
  template: `
    <header class="td-head">
      <div>
        <h1>Trace · {{ correlationId() }}</h1>
        <span class="td-sub">Processes › Trace</span>
      </div>
    </header>

    <div class="td-tabs" role="tablist" aria-label="Trace view">
      @for (t of tabs; track t.id) {
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
