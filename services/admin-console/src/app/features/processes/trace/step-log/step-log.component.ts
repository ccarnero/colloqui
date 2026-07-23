import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from "@angular/core";
import type { ITrackingChainResponse } from "../../../../core/services/tracking-chain.service";
import { TraceSelectionService } from "../trace-selection.service";
import { computeStepLogEntries, type IStepLogEntry } from "./step-log-geometry";

/**
 * Step log panel: ordered chronological entries for a correlation's tracked
 * events, click-to-select (SPEC.md
 * `manual-loops/admin-console/console-redesign-trace.md` T04).
 *
 * PLACEMENT (documented per the task's instruction to record this choice):
 * the ORCHESTRATOR RULING under decision 5(a) places the step log INSIDE
 * the "run" tab, below the run canvas — matching the design mock
 * (`Rediseño Terminal.dc.html` lines 932-943) exactly. T05
 * (`manual-loops/admin-console/console-redesign-trace.md`) has not yet
 * restyled/rebuilt the run-view canvas into this trace screen's own
 * "run" tab area, so this task embeds `<app-step-log>` directly in
 * `TraceDetailComponent`'s "run" tab branch, alongside the existing
 * `<app-run-view>`, fed by the SAME already-loaded `ITrackingChainResponse`
 * the waterfall/causal-graph tabs use (no new fetch — T01 finding item 5:
 * "no NEW fetch is needed"). This makes the log functional now; T05
 * restyles the run tab area around it (smallest coherent step for this
 * task, per the task instructions).
 *
 * Selection: entry click -> `TraceSelectionService.select(eventId, "run")`
 * — `TraceSourceView` folds the step log into the "run" source per that
 * type's own header comment ("the step log itself surfaces selections as
 * 'run' too"). Highlight is driven purely by the shared service's
 * `selectedEventId` signal — no view-local selection state (Constraints:
 * selection state lives ONLY in `TraceSelectionService`).
 */
@Component({
  selector: "app-step-log",
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sl">
      <h3 class="sl-title">Step log</h3>
      <ol class="sl-list" role="list" aria-label="Step log">
        @for (entry of entries(); track entry.eventId) {
          <li
            class="sl-entry"
            role="listitem"
            tabindex="0"
            [class.sl-entry-selected]="isSelected(entry)"
            (click)="onEntryClick(entry)"
            (keydown.enter)="onEntryClick(entry)"
          >
            <span class="sl-entry-offset">t+{{ entry.startMs }}ms</span>
            <span class="sl-entry-label">{{ entry.label }}</span>
            <span class="sl-entry-service">{{ entry.service }}</span>
            @if (entry.durationMs > 0) {
              <span class="sl-entry-duration">{{ entry.durationMs }} ms</span>
            }
          </li>
        }
        @if (entries().length === 0) {
          <li class="sl-empty">No steps in this chain.</li>
        }
      </ol>
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-top: var(--rd-space-8, 16px);
    }
    .sl-title {
      margin: 0 0 var(--rd-space-5, 10px);
      font-size: var(--rd-text-size-base, 13px);
      font-weight: 600;
      color: var(--rd-text-1, #ededed);
    }
    .sl-list {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .sl-entry {
      display: grid;
      grid-template-columns: 72px 1fr auto auto;
      align-items: center;
      gap: var(--rd-space-4, 8px);
      min-height: 28px;
      border-radius: var(--rd-radius-5, 6px);
      padding: 0 var(--rd-space-4, 8px);
      cursor: pointer;
      font-size: var(--rd-text-size-sm, 12px);
    }
    .sl-entry:hover {
      background: var(--rd-panel, #141414);
    }
    .sl-entry-selected {
      background: var(--rd-accent-soft, rgba(26, 102, 255, 0.12));
      outline: 1px solid var(--rd-accent, #1a66ff);
      outline-offset: -1px;
    }
    .sl-entry-offset {
      font-family: var(--rd-font-mono, monospace);
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-2xs, 10px);
    }
    .sl-entry-label {
      color: var(--rd-text-1, #ededed);
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sl-entry-service {
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-2xs, 10px);
    }
    .sl-entry-duration {
      font-family: var(--rd-font-mono, monospace);
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-2xs, 10px);
    }
    .sl-empty {
      color: var(--rd-text-3, #7a7a7a);
      font-size: var(--rd-text-size-sm, 12px);
      padding: var(--rd-space-4, 8px);
    }
  `,
})
export class StepLogComponent {
  readonly chain = input.required<ITrackingChainResponse>();

  /** Shared cross-view selection (T02-T04) — walks up to the
   * `TraceDetailComponent`-provided instance; NOT `providedIn: "root"` (see
   * `TraceSelectionService`'s header comment). No view-local selection
   * signal is declared here. */
  private readonly selection = inject(TraceSelectionService);

  readonly entries = computed(() => computeStepLogEntries(this.chain()));

  /** Selected-entry highlight — reads the shared service's signal directly,
   * no local state. */
  isSelected(entry: IStepLogEntry): boolean {
    return this.selection.selectedEventId() === entry.eventId;
  }

  /** Entry click (and Enter, for keyboard access) -> shared selection,
   * sourced as "run" (the step log lives inside the run tab). Verbose
   * logging: every new selection-triggering path logs the entry it
   * selected. */
  onEntryClick(entry: IStepLogEntry): void {
    console.debug("[StepLogComponent] entry clicked, selecting event", {
      eventId: entry.eventId,
      label: entry.label,
      correlationId: this.chain().correlation_id,
    });
    this.selection.select(entry.eventId, "run");
  }
}
