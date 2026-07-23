// step-log-geometry.ts — pure ordering helper for the step log panel. Kept
// separate from the component so it stays unit-testable without TestBed,
// mirroring the waterfall-geometry.ts / causal-graph-geometry.ts precedent.
import type { ITrackingChainResponse } from "../../../../core/services/tracking-chain.service";
import {
  computeWaterfallRows,
  type IWaterfallRow,
} from "../waterfall/waterfall-geometry";

/** One ordered step-log entry. */
export interface IStepLogEntry {
  readonly eventId: string;
  readonly label: string;
  readonly service: string;
  readonly startMs: number;
  readonly durationMs: number;
}

/**
 * Builds the step log's chronologically-ordered entries, reusing
 * `computeWaterfallRows` — the SAME timing/label data the waterfall view
 * already renders from (SPEC.md T01 finding: "reuse matchEventSpans, do not
 * re-derive a second heuristic"; this extends that reuse to the step log).
 * `computeWaterfallRows` returns rows in chain (array) order, which the
 * ingester does not guarantee is strictly chronological, so this explicitly
 * sorts by `startMs` ascending — the step log's own ordering contract
 * ("ordered entries", SPEC.md T04).
 */
export function computeStepLogEntries(
  chain: ITrackingChainResponse
): readonly IStepLogEntry[] {
  const rows = computeWaterfallRows(chain);
  return [...rows]
    .sort((a: IWaterfallRow, b: IWaterfallRow) => a.startMs - b.startMs)
    .map((row) => ({
      eventId: row.eventId,
      label: row.label,
      service: row.service,
      startMs: row.startMs,
      durationMs: row.durationMs,
    }));
}
