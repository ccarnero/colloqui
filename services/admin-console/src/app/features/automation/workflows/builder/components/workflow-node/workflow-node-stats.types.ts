/**
 * Per-node mini-stats badge input (SPEC decision 5). T01 finding 6
 * confirmed there is no backend aggregate of run-count/error-rate per
 * node today (`manual-loops/admin-console/console-redesign-processes-builder.md:346-369`)
 * — building it client-side would require paging every execution of every
 * workflow (an explicitly-flagged N+1 pattern). This type only defines the
 * rendering contract; no caller in this codebase produces
 * `IWorkflowNodeStats` yet. The badge stays hidden until a future,
 * genuinely aggregated data source exists.
 */
export interface IWorkflowNodeStats {
  /** Pre-formatted primary run stat, e.g. "1,842 runs". */
  readonly primaryLabel: string;
  /** Pre-formatted secondary windowed stat, e.g. "24h: 312". */
  readonly secondaryLabel?: string;
  /** Health indicator for the node's recent runs. */
  readonly status?: "ok" | "warning" | "error";
}
