import type { INodeStatsBranchRow } from "./map-node-stats-to-view-models";

/** Per-branch run evidence for a conditional branch card footer. */
export interface IBranchEvidence {
  /** Number of runs that took THIS branch. */
  readonly matched: number;
  /** Total runs of the conditional node itself (how many times it evaluated). */
  readonly total: number;
  /** matched / total, rounded to the nearest whole percent. */
  readonly percent: number;
}

/**
 * One conditional branch's route target identity, as needed to join the
 * unmerged /node-stats branch rows: the runtime records branch as the
 * matched branch's own label (or the literal "default") — see
 * services/workflow-service/src/temporal/workflows.ts combineBranchLabel —
 * and action_name as the NAME of the action that ran inside that branch,
 * i.e. this branch's route target node.
 */
export interface IBranchEvidenceKey {
  readonly branchLabel: string;
  readonly targetActionName: string;
}

/**
 * Resolves per-branch run evidence ("matched 11/23 · 48%") for ONE branch.
 *
 * The numerator joins the unmerged /node-stats branch rows against
 * (action_name, branch) for this branch's own route target + label.
 *
 * The denominator is the CONDITIONAL NODE'S OWN /node-stats row (its own
 * action_started/completed count, i.e. "how many times this conditional
 * ran"), passed in as nodeTotalRuns — NOT derived by summing sibling
 * branches' rows keyed by their CURRENT labels. That earlier approach was a
 * defect (dual-review objection, IF-editor task attempt 2): renaming a
 * branch changes the label used to look up its historical rows, so a
 * rename silently drops that branch's runs out of its SIBLINGS' totals too
 * (their percentages inflate) even though nothing about the sibling
 * changed. The node's own row is keyed only by its action_name, which does
 * not change on a branch rename, so it is rename-proof and semantically
 * exact.
 *
 * Returns null when there is no matching row for this branch (no data /
 * this branch never ran), or when nodeTotalRuns is null/zero (the
 * conditional's own row has no data yet) — evidence must never present a
 * zero/adjusted run count as a fact, so the caller hides the span entirely.
 */
export function resolveBranchEvidence(
  branchRows: readonly INodeStatsBranchRow[],
  nodeTotalRuns: number | null,
  key: IBranchEvidenceKey
): IBranchEvidence | null {
  if (nodeTotalRuns === null || nodeTotalRuns <= 0) {
    return null;
  }
  const matched =
    branchRows.find(
      (r) =>
        r.actionName === key.targetActionName && r.branch === key.branchLabel
    )?.runs ?? 0;
  if (matched <= 0) {
    return null;
  }

  return {
    matched,
    total: nodeTotalRuns,
    percent: Math.round((matched / nodeTotalRuns) * 100),
  };
}
