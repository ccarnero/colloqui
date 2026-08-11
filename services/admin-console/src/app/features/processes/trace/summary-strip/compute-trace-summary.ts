import type { ITrackingChainResponse } from "../../../../core/services/tracking-chain.service";
import {
  computeChainCompleteness,
  computeChannel,
} from "../causal-graph/causal-graph-geometry";
import {
  computeBottleneck,
  type IWaterfallBottleneck,
} from "../waterfall/waterfall-geometry";
import {
  type ChainVerdict,
  computeChainVerdict,
} from "./compute-chain-verdict";

/**
 * Data for the shared 5-cell summary strip rendered above the tab body on
 * every trace tab (SPEC.md `manual-loops/admin-console/console-redesign-
 * polish.md` T07, T01 finding 11 — mock `Rediseño Terminal.dc.html` lines
 * 717-724, the "Summary strip (shared)" comment: VERDICT / TOTAL / EVENTOS /
 * CANAL / BOTTLENECK, rendered once, identical across all four tabs).
 *
 * Composed ENTIRELY from pure derivations that already exist and are already
 * unit-tested elsewhere in this feature (reuse, not rebuild, per the
 * Constraints): `computeChannel`/`computeChainCompleteness`
 * (`causal-graph-geometry.ts`, previously only rendered inside the Causal
 * graph tab's own header) and `computeBottleneck`
 * (`waterfall-geometry.ts`, previously only rendered inside the Waterfall
 * tab's own header). Only `computeChainVerdict` is new (see that module).
 */
export interface ITraceSummary {
  readonly verdict: ChainVerdict | null;
  readonly totalMs: number;
  readonly eventsCount: number;
  readonly spansClosed: number;
  readonly spansTotal: number;
  /** `CANAL` cell — the SAME client-side proxy the Causal graph tab already
   * shows (the ingress event's `tech` field), NOT a true channel/account
   * identity (e.g. "telegram · Ventas AR" per the mock) — no
   * channel-type/account field exists on `ITrackedEvent` (DATA-GAP, T01
   * finding 11). */
  readonly channel: string;
  readonly bottleneck: IWaterfallBottleneck | null;
}

export function computeTraceSummary(
  chain: ITrackingChainResponse
): ITraceSummary {
  const completeness = computeChainCompleteness(chain);
  const summary: ITraceSummary = {
    verdict: computeChainVerdict(chain),
    totalMs: chain.summary.total_ms,
    eventsCount: chain.summary.count,
    spansClosed: completeness.closed,
    spansTotal: completeness.total,
    channel: computeChannel(chain),
    bottleneck: computeBottleneck(chain),
  };
  if (
    summary.verdict === null ||
    summary.bottleneck === null ||
    summary.channel === ""
  ) {
    console.debug(
      "[computeTraceSummary] degraded cells (rendered as em-dash, not invented)",
      {
        correlationId: chain.correlation_id,
        verdict: summary.verdict,
        bottleneck: summary.bottleneck !== null,
        channel: summary.channel || "(empty)",
      }
    );
  }
  return summary;
}
