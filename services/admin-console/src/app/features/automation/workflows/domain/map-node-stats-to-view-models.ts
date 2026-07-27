import type { IWorkflowNodeStats } from "../builder/components/workflow-node/workflow-node-stats.types";
import { classifyNodeRunStatus } from "./classify-node-run-status";

/**
 * One `(action_name, branch)` aggregate row, wire-faithful to
 * tracking-ingester-service's `NodeStatsRow`
 * (`services/tracking-ingester-service/src/lib/build-node-stats-query.ts`).
 */
export interface INodeStatsRow {
  readonly action_name: string;
  readonly branch: string | null;
  readonly runs: number;
  readonly p95_ms: number | null;
  readonly ok_ratio: number | null;
}

/**
 * Maps the `GET /node-stats` aggregate rows into per-node footer view
 * models, keyed by `action_name` — the ONE stable identity that survives
 * from the saved definition through the builder (T06 findings' "join-crux
 * verdict": `flow-deserializer.ts:166` copies `action.name` verbatim, the
 * builder's own node `key` is regenerated on every deserialize and is
 * never a valid join key).
 *
 * `branch` is NOT joined against a builder field — deserializer/serializer
 * are out of scope for T07 (SPEC constraint), and `IWorkflowNode` carries
 * no persisted branch-path field today. When multiple aggregate rows share
 * the same `action_name` (an action that appears inside more than one
 * branch, or with more than one distinct `branch` value recorded), they
 * are merged: `runs` sums, `p95_ms` takes the WORST (max) branch p95 (a
 * conservative choice — never understates latency), and `ok_ratio` is the
 * runs-weighted average — never a fabricated number, always derived from
 * the real per-branch aggregates.
 */
export function mapNodeStatsToViewModels(
  rows: readonly INodeStatsRow[]
): Readonly<Record<string, IWorkflowNodeStats>> {
  interface Accumulator {
    runs: number;
    p95Ms: number;
    okWeightedSum: number;
    okWeightedCount: number;
  }

  const byName = new Map<string, Accumulator>();

  for (const row of rows) {
    if (!row.action_name || row.runs <= 0) {
      continue;
    }
    const p95 = row.p95_ms ?? 0;
    const existing = byName.get(row.action_name);
    if (existing) {
      existing.runs += row.runs;
      existing.p95Ms = Math.max(existing.p95Ms, p95);
      if (row.ok_ratio !== null) {
        existing.okWeightedSum += row.ok_ratio * row.runs;
        existing.okWeightedCount += row.runs;
      }
    } else {
      byName.set(row.action_name, {
        runs: row.runs,
        p95Ms: p95,
        okWeightedSum: row.ok_ratio !== null ? row.ok_ratio * row.runs : 0,
        okWeightedCount: row.ok_ratio !== null ? row.runs : 0,
      });
    }
  }

  const result: Record<string, IWorkflowNodeStats> = {};
  for (const [name, agg] of byName) {
    const okRatio =
      agg.okWeightedCount > 0 ? agg.okWeightedSum / agg.okWeightedCount : null;
    result[name] = {
      state: "ready",
      primaryLabel: `${agg.runs.toLocaleString("en-US")} runs`,
      secondaryLabel: `p95: ${Math.round(agg.p95Ms)}ms`,
      status: classifyNodeRunStatus(okRatio),
    };
  }
  return result;
}

/**
 * One UNMERGED `(action_name, branch)` aggregate row, ready for the
 * conditional-branch config panel's per-branch run evidence (IF-editor SPEC
 * task). `mapNodeStatsToViewModels` above deliberately MERGES every row that
 * shares an `action_name` across branches (documented "join-crux verdict")
 * so the node-card footer keeps behaving exactly as T07 shipped it — this
 * accessor exposes the SAME `/node-stats` rows one level less aggregated,
 * without touching that merged behavior at all.
 */
export interface INodeStatsBranchRow {
  readonly actionName: string;
  readonly branch: string;
  readonly runs: number;
}

/**
 * Filters/reshapes raw `/node-stats` rows into the branch-keyed rows the
 * conditional branch config panel joins against (by target action name +
 * branch label — see `resolve-branch-evidence.ts`). Drops rows with no
 * branch dimension (linear, non-branched actions) or zero runs — those
 * carry no per-branch evidence to show.
 */
export function mapNodeStatsToBranchRows(
  rows: readonly INodeStatsRow[]
): readonly INodeStatsBranchRow[] {
  const branchRows: INodeStatsBranchRow[] = [];
  for (const row of rows) {
    if (!row.action_name || !row.branch || row.runs <= 0) {
      continue;
    }
    branchRows.push({
      actionName: row.action_name,
      branch: row.branch,
      runs: row.runs,
    });
  }
  return branchRows;
}

/**
 * Total runs of each action's OWN unbranched /node-stats row (branch is
 * null), keyed by action_name. Used as the per-branch run-evidence
 * DENOMINATOR (see resolve-branch-evidence.ts) for a conditional node's own
 * execution count ("how many times this conditional ran"), instead of
 * summing sibling branch rows keyed by their current labels — the
 * rename-staleness fix (IF-editor task attempt 2, dual-review objection 1).
 * A conditional node emits its own action_started/completed pair with
 * branch === null whenever it is not itself nested inside another branch
 * (services/workflow-service/src/temporal/workflows.ts), so this map's
 * entry for the conditional's own action_name is that count.
 */
export function mapNodeStatsOwnRunsByName(
  rows: readonly INodeStatsRow[]
): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (!row.action_name || row.branch || row.runs <= 0) {
      continue;
    }
    result[row.action_name] = (result[row.action_name] ?? 0) + row.runs;
  }
  return result;
}
