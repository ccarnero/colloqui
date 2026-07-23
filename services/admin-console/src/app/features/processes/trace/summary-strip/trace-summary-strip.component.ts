import { DecimalPipe } from "@angular/common";
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import type { ITrackingChainResponse } from "../../../../core/services/tracking-chain.service";
import { computeTraceSummary } from "./compute-trace-summary";

const VERDICT_LABEL: Record<string, string> = {
  replied: "replied",
  "published-unconfirmed": "published · unconfirmed",
  received: "received",
};

/**
 * Shared 5-cell KPI-style summary strip rendered once above the tab body,
 * identical for all four trace tabs (SPEC.md `manual-loops/admin-console/
 * console-redesign-polish.md` T07, T01 finding 11 — mock
 * `Rediseño Terminal.dc.html` lines 717-724: VERDICT / TOTAL / EVENTOS /
 * CANAL / BOTTLENECK). Pure presentation: all values come from
 * `computeTraceSummary`, derived client-side from the already-loaded
 * `ITrackingChainResponse` — nothing fetched here.
 */
@Component({
  selector: "app-trace-summary-strip",
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe],
  template: `
    <div class="tss-strip" role="group" aria-label="Trace summary">
      <div class="tss-cell">
        <span class="tss-label">Verdict</span>
        @if (summary().verdict; as verdict) {
          <span class="tss-value" [class]="'tss-verdict-' + verdict">
            <span class="tss-dot"></span>{{ verdictLabel(verdict) }}
          </span>
        } @else {
          <span class="tss-value tss-value--muted">no verdict data</span>
        }
      </div>
      <div class="tss-cell">
        <span class="tss-label">Total</span>
        <span class="tss-value">{{ summary().totalMs }} ms</span>
      </div>
      <div class="tss-cell">
        <span class="tss-label">Eventos</span>
        <span class="tss-value"
          >{{ summary().eventsCount }} · spans {{ summary().spansClosed }}/{{
            summary().spansTotal
          }}</span
        >
      </div>
      <div class="tss-cell">
        <span class="tss-label">Canal</span>
        <span class="tss-value">{{ summary().channel }}</span>
      </div>
      <div class="tss-cell">
        <span class="tss-label">Bottleneck</span>
        @if (summary().bottleneck; as b) {
          <span class="tss-value tss-value--danger"
            >{{ b.label }} · {{ b.durationMs }} ms ({{
              b.percentOfTotal | number: "1.0-1"
            }}%)</span
          >
        } @else {
          <span class="tss-value tss-value--muted">none</span>
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
      margin-bottom: var(--rd-space-8, 16px);
    }
    .tss-strip {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      border: 1px solid var(--rd-line, #1f1f1f);
      border-radius: var(--rd-radius-9, 10px);
      overflow: hidden;
    }
    .tss-cell {
      padding: var(--rd-space-6, 14px) var(--rd-space-8, 20px);
      border-right: 1px solid var(--rd-line, #1f1f1f);
      display: flex;
      flex-direction: column;
      gap: var(--rd-space-3, 6px);
    }
    .tss-cell:last-child {
      border-right: none;
    }
    .tss-label {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-2xs, 10px);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--rd-text-3, #7a7a7a);
    }
    .tss-value {
      font-family: var(--rd-font-mono);
      font-size: var(--rd-text-size-base, 16px);
      font-weight: 500;
      color: var(--rd-text-1, #ededed);
      display: flex;
      align-items: center;
      gap: var(--rd-space-3, 6px);
    }
    .tss-value--muted {
      color: var(--rd-text-3, #7a7a7a);
      font-weight: 400;
    }
    .tss-value--danger {
      color: var(--rd-red, #ff6b6b);
    }
    .tss-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      flex-shrink: 0;
    }
    .tss-verdict-replied {
      color: var(--rd-green, #50e3a4);
    }
    .tss-verdict-published-unconfirmed {
      color: var(--rd-yellow, #e3b450);
    }
    .tss-verdict-received {
      color: var(--rd-text-2, #a1a1a1);
    }
  `,
})
export class TraceSummaryStripComponent {
  readonly chain = input.required<ITrackingChainResponse>();

  readonly summary = computed(() => {
    const summary = computeTraceSummary(this.chain());
    console.debug("[TraceSummaryStripComponent] summary computed", {
      correlationId: this.chain().correlation_id,
      verdict: summary.verdict,
      totalMs: summary.totalMs,
      events: summary.eventsCount,
    });
    return summary;
  });

  verdictLabel(verdict: string): string {
    return VERDICT_LABEL[verdict] ?? verdict;
  }
}
