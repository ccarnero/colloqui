import { Injectable, signal } from "@angular/core";

/**
 * The trace screen tab that produced a selection, or the run-view's step
 * log sub-panel — matches `TraceViewTab` (`trace-detail.component.ts`)
 * plus the log itself surfaces selections as "run" too (the ORCHESTRATOR
 * RULING under SPEC.md decision 5(a): step log is a sub-panel inside the
 * "run" tab, not a fifth tab/source).
 */
export type TraceSourceView = "waterfall" | "causal" | "legacy" | "run";

/**
 * Single source of truth for the trace screen's shared event selection
 * (SPEC.md `manual-loops/admin-console/console-redesign-trace.md`,
 * decision 2: the four views are tabs of ONE trace screen sharing ONE
 * selection state — a view holding its own selected-event signal is
 * automatic rejection). Replaces the three independent view-local
 * selection signals T01 found (`CausalGraphComponent.selected`,
 * `RunViewComponent.selected`/`selectedNodeSignal`,
 * `MessageTraceComponent.selectedId`) — those get migrated onto this
 * service in T03-T05, NOT in this task (T02 only introduces the shared
 * shell; see `trace-detail.component.ts` header comment).
 *
 * `@Injectable()` with NO `providedIn: "root"` — component-provided at
 * `TraceDetailComponent` (T02's screen shell), the same pattern
 * `AgentEditorBridgeService` uses for "lives only while this screen is
 * open" state. A route-level/global singleton would leak selection across
 * unrelated correlation ids if the user ever navigates trace → trace
 * without a full route destroy (Angular reuses the component instance for
 * param-only route changes), so the component-level provider is the
 * correct scope: `TraceDetailComponent` is re-created per
 * `processes/trace/:correlationId` navigation (it has no route re-use
 * strategy override), which resets the provider along with it.
 */
@Injectable()
export class TraceSelectionService {
  private readonly _selectedEventId = signal<string | null>(null);
  private readonly _sourceView = signal<TraceSourceView | null>(null);

  readonly selectedEventId = this._selectedEventId.asReadonly();
  readonly sourceView = this._sourceView.asReadonly();

  /** Selects `eventId`, recording which tab/view triggered the selection
   * (drives cross-view highlight in T03-T05). Verbose logging: every
   * selection transition is a debugging-relevant event (SPEC.md
   * Constraints: "verbose logging on every new code path"). */
  select(eventId: string, sourceView: TraceSourceView): void {
    console.debug("[TraceSelectionService] select", {
      eventId,
      sourceView,
      previousEventId: this._selectedEventId(),
      previousSourceView: this._sourceView(),
    });
    this._selectedEventId.set(eventId);
    this._sourceView.set(sourceView);
  }

  /** Clears the selection — closes the inspector (T02's shell reacts to
   * `selectedEventId() === null`). */
  clear(): void {
    console.debug("[TraceSelectionService] clear", {
      previousEventId: this._selectedEventId(),
      previousSourceView: this._sourceView(),
    });
    this._selectedEventId.set(null);
    this._sourceView.set(null);
  }
}
