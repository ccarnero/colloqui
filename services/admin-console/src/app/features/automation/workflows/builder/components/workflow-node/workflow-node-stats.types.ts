/**
 * Per-node mini-stats badge input (SPEC decision 5). T01 finding 6
 * confirmed there is no backend aggregate of run-count/error-rate per
 * node (`manual-loops/admin-console/console-redesign-processes-builder.md:346-369`);
 * T06/T07 of console-redesign-builder-v2.md re-opened that finding and
 * wired the real per-node aggregate (tracking-ingester-service's
 * `GET /node-stats`, joined via `map-node-stats-to-view-models.ts`).
 *
 * `state` drives the footer row's rendering (T07):
 * - `"loading"` — the fetch is in flight; the footer renders its
 *   skeleton/neutral state, never zeros presented as facts.
 * - `"hidden"` — no real data for this node (fetch error, a zero-runs
 *   workflow, or a node whose action name has no matching aggregate row);
 *   the footer degrades to fully hidden.
 * - `"ready"` (or omitted, for T03's static placeholder default) — the
 *   labels below are rendered as-is.
 */
export type WorkflowNodeStatsState = "loading" | "ready" | "hidden";

export interface IWorkflowNodeStats {
  /** Footer render state (T07). Omitted = `"ready"` (T03 placeholder default). */
  readonly state?: WorkflowNodeStatsState;
  /** Pre-formatted primary run stat, e.g. "1,842 runs". */
  readonly primaryLabel: string;
  /** Pre-formatted secondary windowed stat, e.g. "p95: 620ms". */
  readonly secondaryLabel?: string;
  /** Health indicator for the node's recent runs. */
  readonly status?: "ok" | "warning" | "error";
}
