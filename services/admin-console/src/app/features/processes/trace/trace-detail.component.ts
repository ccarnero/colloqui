import { DecimalPipe } from "@angular/common";
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
  type ITrackedEvent,
  type ITrackingChainResponse,
  TrackingChainService,
} from "../../../core/services/tracking-chain.service";
import { RunViewComponent } from "../run-view/run-view.component";
import { CausalGraphComponent } from "./causal-graph/causal-graph.component";
import { findWorkflowRuns } from "./domain/find-workflow-runs";
import { MessageTraceComponent } from "./message-trace.component";
import { TraceSelectionService } from "./trace-selection.service";
import { TraceWaterfallComponent } from "./waterfall/trace-waterfall.component";
import { computeEventTimingPercent } from "./waterfall/waterfall-geometry";

/** The four ways to look at a correlation's tracked-event chain — "run"
 * only appears when the chain contains a workflow run (T06 of
 * manual-loops/run-view.md, entry (b)). Matches the ORCHESTRATOR RULING
 * under decision 5(a) of console-redesign-trace.md: the tab set is
 * waterfall/causal/legacy/run — "step log" is a sub-panel INSIDE the
 * "run" tab (T04), never a fifth tab. */
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
 * Container for processes/trace/:correlationId — fetches the tracking
 * chain ONCE via TrackingChainService and feeds it to the Waterfall and
 * Causal graph views. The pre-existing client-side assembly
 * (assemble-trace.ts via MessageTraceComponent) stays available,
 * unmodified, as the third "Legacy" tab (SPEC.md manual-loops/trace-console.md T07).
 *
 * T02 (manual-loops/admin-console/console-redesign-trace.md) adds the
 * shared TraceSelectionService (component-provided below — see that
 * file's header comment for the provider-scope justification) and a
 * docked inspector panel SHELL that reacts to it. The waterfall/causal/
 * run-view children have zero selection-state changes from THIS task —
 * the causal graph's pre-existing local "selected" signal (T01 finding,
 * item 2) is migrated onto TraceSelectionService in T04, and the
 * waterfall's click-to-select affordance (it currently has none) is ADDED
 * in T03. This task only builds the shell + service; nothing here reads
 * or writes a view-local selection signal.
 *
 * T03 adds the inspector's waterfall-mode content (decision 3 + the
 * ORCHESTRATOR RULING): base event fields (whatever ITrackedEvent carries
 * — SPEC.md T01 finding item 3's "base dl" field mapping) plus timing % of
 * the chain's total span, computed by computeEventTimingPercent
 * (waterfall/waterfall-geometry.ts) — the SAME span-matching data the
 * waterfall bars already render from, not a re-derived heuristic. This
 * content renders ONLY when selection.sourceView() === "waterfall";
 * causal/run-view/legacy contextual content stays the T02 placeholder
 * until T04-T06.
 */
@Component({
  selector: "app-trace-detail",
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Component-provided, not root: TraceSelectionService must live only
  // while this trace screen instance is mounted (see that service's
  // header comment for why a route-level/global singleton is the wrong
  // scope).
  providers: [TraceSelectionService],
  imports: [
    CausalGraphComponent,
    MessageTraceComponent,
    TraceWaterfallComponent,
    RunViewComponent,
    DecimalPipe,
  ],
  host: {
    // Esc clears the selection (closes the inspector) from anywhere in the
    // trace screen. Embedded widgets that add their OWN Escape handling in
    // later tasks (e.g. a future causal-graph node popup) MUST call
    // $event.stopPropagation() in their own handler if they want to
    // consume Esc without also triggering this host-level clear — this
    // handler itself is a no-op when nothing is selected, so an accidental
    // double-fire is harmless, but a widget with its OWN close semantics
    // (e.g. "back up one level" before fully closing) needs to opt out.
    "(keydown.escape)": "onEscape()",
  },
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

    <div class="td-body">
      <div class="td-main">
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
      </div>

      <!-- Docked event inspector SHELL (T02): ALWAYS rendered — an empty
           state when nothing is selected, populated once
           TraceSelectionService.selectedEventId() is set. Per-view
           context content (payload, timing %, step result, causal chain,
           Temporal/builder deep links — decisions 3/4) is filled in by
           T03-T06; T03 adds the waterfall-mode content below. -->
      <aside class="td-inspector" aria-label="Event inspector">
        @if (selection.selectedEventId(); as selectedId) {
          <header class="td-inspector-head">
            <span class="td-inspector-title">Event · {{ selectedId }}</span>
            @if (selection.sourceView(); as source) {
              <span class="td-inspector-source">{{ source }}</span>
            }
            <button
              type="button"
              class="td-inspector-close"
              aria-label="Close inspector"
              (click)="closeInspector()"
            >
              ×
            </button>
          </header>
          <div class="td-inspector-body">
            @if (isWaterfallSelection() && selectedEvent(); as event) {
              <!-- T03 waterfall-mode content: timing % (decision 3), then
                   base ITrackedEvent fields (mirrors the design mock's base
                   dl — event_id/causation/depth/tech/business_fn/
                   claim_check/compliance/subject — using REAL field
                   values, not the mock's hardcoded placeholders). -->
              @if (selectedEventTimingPercent(); as pct) {
                <div class="td-timing">
                  <span class="td-timing-label">timing</span>
                  <span class="td-timing-value">{{ pct | number: "1.0-1" }}% of total</span>
                </div>
              } @else {
                <div class="td-timing td-timing--none">
                  <span class="td-timing-label">timing</span>
                  <span class="td-timing-value">no duration data</span>
                </div>
              }
              <dl class="td-base">
                <dt>event_id</dt>
                <dd>{{ event.event_id }}</dd>
                <dt>kind</dt>
                <dd>{{ event.kind ?? "—" }}</dd>
                <dt>causation</dt>
                <dd>{{ event.causation_id ?? "—" }}</dd>
                <dt>depth</dt>
                <dd>{{ event.causation_depth ?? "—" }}</dd>
                <dt>tech</dt>
                <dd>{{ event.tech }}</dd>
                <dt>business_fn</dt>
                <dd>{{ event.business_fn }}</dd>
                <dt>claim_check</dt>
                <dd>{{ event.is_claim_check }}</dd>
                <dt>compliance</dt>
                <dd>{{ event.compliance }}</dd>
                <dt>subject</dt>
                <dd>{{ event.subject }}</dd>
              </dl>
            } @else {
              <p class="td-muted">
                Inspector content (payload, timing, subscribers, deep links)
                lands in T04-T06.
              </p>
            }
          </div>
        } @else {
          <div class="td-inspector-body td-inspector-body--empty">
            <p class="td-inspector-empty">Select an event…</p>
          </div>
        }
      </aside>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 16px;
    }
    h1 {
      font-size: 18px;
      margin: 0;
    }
    .td-sub,
    .td-muted {
      color: var(--text-muted, #888);
      font-size: 12px;
    }
    .td-head {
      margin-bottom: 12px;
    }
    .td-error {
      color: var(--text-danger, #b3261e);
    }

    .td-tabs {
      display: inline-flex;
      border: 1px solid var(--rd-line-3, #2e2e2e);
      border-radius: var(--rd-radius-7, 8px);
      overflow: hidden;
      margin-bottom: var(--rd-space-8, 16px);
    }
    .td-tab {
      padding: var(--rd-space-5, 10px) var(--rd-space-7, 14px);
      font-size: var(--rd-text-size-sm, 12.5px);
      font-weight: 500;
      color: var(--rd-text-3, #7a7a7a);
      background: transparent;
      border: 0;
      border-right: 1px solid var(--rd-line-2, #161616);
      cursor: pointer;
      font-family: inherit;
      transition: color 0.15s, background 0.15s;
    }
    .td-tab:last-child {
      border-right: none;
    }
    .td-tab:hover {
      color: var(--rd-text-1, #ededed);
    }
    .td-tab.is-active {
      background: var(--rd-hover, #1a1a1a);
      color: var(--rd-text-1, #ededed);
    }

    .td-body {
      display: flex;
      gap: var(--rd-space-8, 16px);
      align-items: flex-start;
    }
    .td-main {
      flex: 1 1 auto;
      min-width: 0;
    }

    .td-inspector {
      flex: 0 0 320px;
      border: 1px solid var(--rd-line-3, #2e2e2e);
      border-radius: var(--rd-radius-11, 14px);
      overflow: hidden;
      background: var(--rd-bg, #0a0a0a);
      position: sticky;
      top: 16px;
    }
    .td-inspector-head {
      display: flex;
      align-items: center;
      gap: var(--rd-space-5, 9px);
      padding: var(--rd-space-7, 13px) var(--rd-space-8, 16px);
      border-bottom: 1px solid var(--rd-line, #1f1f1f);
    }
    .td-inspector-title {
      flex: 1 1 auto;
      min-width: 0;
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-base, 13px);
      font-weight: 600;
      color: var(--rd-text-1, #ededed);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .td-inspector-source {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      color: var(--rd-text-3, #7a7a7a);
      background: var(--rd-hover, #1a1a1a);
      border-radius: var(--rd-radius-3, 4px);
      padding: 1px var(--rd-space-4, 8px);
      flex-shrink: 0;
    }
    .td-inspector-close {
      width: 26px;
      height: 26px;
      flex-shrink: 0;
      border: none;
      background: transparent;
      border-radius: var(--rd-radius-5, 6px);
      color: var(--rd-text-2, #a1a1a1);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
    }
    .td-inspector-close:hover {
      background: var(--rd-hover, #1a1a1a);
    }
    .td-inspector-body {
      padding: var(--rd-space-7, 14px) var(--rd-space-8, 16px);
    }
    .td-inspector-body--empty {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 120px;
    }
    .td-inspector-empty {
      margin: 0;
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-sm, 12px);
    }

    .td-timing {
      display: flex;
      flex-direction: column;
      gap: 2px;
      background: var(--rd-panel, #141414);
      border: 1px solid var(--rd-line-2, #161616);
      border-radius: var(--rd-radius-5, 8px);
      padding: var(--rd-space-4, 8px) var(--rd-space-5, 10px);
      margin-bottom: var(--rd-space-6, 12px);
    }
    .td-timing-label {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 9px);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--rd-text-3, #7a7a7a);
    }
    .td-timing-value {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-sm, 12px);
      color: var(--rd-text-1, #ededed);
    }
    .td-timing--none .td-timing-value {
      color: var(--rd-text-3, #7a7a7a);
    }

    .td-base {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--rd-space-3, 6px) var(--rd-space-5, 10px);
      margin: 0;
      font-size: var(--rd-text-size-sm, 12px);
    }
    .td-base dt {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--rd-text-3, #7a7a7a);
    }
    .td-base dd {
      margin: 0;
      font-family: var(--rd-font-mono);
      color: var(--rd-text-1, #ededed);
      word-break: break-all;
    }
  `,
})
export class TraceDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly trackingChainService = inject(TrackingChainService);

  /** Single shared selection state for this trace screen's four tabs
   * (decision 2). Public/readonly so the template can read it directly —
   * no view-local selection signal exists or is added by T02. */
  readonly selection = inject(TraceSelectionService);

  readonly tabs = TABS;
  readonly correlationId = signal("");
  readonly activeTab = signal<TraceViewTab>("waterfall");
  readonly chain = signal<ITrackingChainResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /** T06 (entry b): distinct workflow runs found in the chain's events.
   * manual-loops/run-view.md T06: "pick the FIRST workflow run" when a
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

  /** True when the current selection came from the waterfall tab (T03) —
   * gates the waterfall-mode inspector content (base fields + timing %);
   * causal/run-view/legacy content lands in T04-T06. */
  readonly isWaterfallSelection = computed(
    () => this.selection.sourceView() === "waterfall"
  );

  /** The currently-selected event's full record from the loaded chain — the
   * base event info the T03 waterfall-mode inspector content renders.
   * null when nothing is selected, or when the selected id somehow isn't
   * in the currently-loaded chain (defensive; should not happen since the
   * chain is the only source of selectable events on this screen). */
  readonly selectedEvent = computed<ITrackedEvent | null>(() => {
    const c = this.chain();
    const id = this.selection.selectedEventId();
    if (!c || !id) {
      return null;
    }
    return c.events.find((e) => e.event_id === id) ?? null;
  });

  /** Timing % of the chain's total span for the selected event (T03,
   * decision 3's "timing % in waterfall" content) — reuses
   * computeEventTimingPercent (waterfall-geometry.ts), the SAME
   * span-matching data the waterfall bars render from. null when the
   * event has no matched duration — the inspector shows no percentage
   * rather than inventing one. */
  readonly selectedEventTimingPercent = computed<number | null>(() => {
    const c = this.chain();
    const id = this.selection.selectedEventId();
    if (!c || !id) {
      return null;
    }
    return computeEventTimingPercent(c, id);
  });

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

  /** × button on the inspector header (T02: shell-only close path). */
  closeInspector(): void {
    console.debug("[TraceDetailComponent] inspector closed via close button", {
      selectedEventId: this.selection.selectedEventId(),
    });
    this.selection.clear();
  }

  /** Host-level Esc handler (T02) — clears the selection when the
   * inspector is open; a no-op otherwise. */
  onEscape(): void {
    if (this.selection.selectedEventId() === null) {
      return;
    }
    console.debug("[TraceDetailComponent] inspector closed via Esc", {
      selectedEventId: this.selection.selectedEventId(),
    });
    this.selection.clear();
  }
}
