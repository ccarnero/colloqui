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
