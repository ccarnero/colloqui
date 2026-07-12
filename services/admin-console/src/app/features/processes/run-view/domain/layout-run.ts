// layout-run.ts — step tree -> geometry model (T03 of
// manual-loops/run-view.md). Pure function, no Angular/DOM: equally-spaced
// vertical rows (decision 1 — NOT time-scaled), linear chaining, fork/join
// lanes (capped at `FORK_LANE_CAP`, DESIGN.md "max 2-3, then collapse to
// summary"), taken/not-taken branch edges, the if-without-else BYPASS edge,
// and critical-path selection on join. Mirrors the two-phase style of
// `causal-graph-geometry.ts`/`waterfall-geometry.ts`: this module only
// computes the model; components (T04) bind it with `[attr.*]`.

import {
  FORK_LANE_CAP,
  type IForkGeometry,
  type ILayoutEdge,
  type ILayoutNode,
  type IMergedRun,
  type IRunLayout,
  type LayoutEdgeKind,
  type StepNode,
} from "./run-view.model";

function nodeId(step: StepNode): string {
  return `${step.branchPath ?? "root"}::${step.actionIndex}`;
}

function labelFor(step: StepNode): string {
  if (step.type === "action") {
    return `${step.actionIndex + 1} · ${step.actionType} → ${step.instanceId ?? step.name}`;
  }
  if (step.type === "conditional") {
    return step.name;
  }
  return `${step.name} · fork`;
}

interface Collector {
  readonly nodes: ILayoutNode[];
  readonly edges: ILayoutEdge[];
  readonly forks: IForkGeometry[];
}

function pushEdge(
  collector: Collector,
  fromId: string,
  toId: string,
  kind: LayoutEdgeKind,
  options: { dashed?: boolean; thick?: boolean; label?: string | null } = {}
): void {
  collector.edges.push({
    id: `${fromId}->${toId}`,
    fromId,
    toId,
    kind,
    dashed: options.dashed ?? false,
    thick: options.thick ?? false,
    label: options.label ?? null,
  });
}

/** Recursively computes the earliest `startedAt`/latest `completedAt`
 * across an entire (possibly nested) step subtree, for fork lane
 * critical-path selection. `null`/`null` when nothing in the subtree has
 * timing data (degraded run, or unmatched spans). */
function timeRangeOfSteps(steps: readonly StepNode[]): {
  readonly startMs: number | null;
  readonly endMs: number | null;
} {
  let startMs: number | null = null;
  let endMs: number | null = null;

  const visit = (step: StepNode): void => {
    if (step.startedAt) {
      const t = Date.parse(step.startedAt);
      startMs = startMs === null ? t : Math.min(startMs, t);
    }
    if (step.completedAt) {
      const t = Date.parse(step.completedAt);
      endMs = endMs === null ? t : Math.max(endMs, t);
    }
    if (step.type === "conditional") {
      for (const branch of step.branches) {
        branch.steps.forEach(visit);
      }
    } else if (step.type === "fork") {
      for (const lane of step.lanes) {
        lane.steps.forEach(visit);
      }
    }
  };

  steps.forEach(visit);
  return { startMs, endMs };
}

function laneDurationMs(steps: readonly StepNode[]): number | null {
  const { startMs, endMs } = timeRangeOfSteps(steps);
  return startMs !== null && endMs !== null ? endMs - startMs : null;
}

interface SequenceResult {
  readonly nextRow: number;
  readonly firstId: string | null;
  readonly tailId: string | null;
}

/**
 * Lays out a LINEAR sequence of sibling steps (the top-level action list,
 * one fork lane, or one conditional branch/default list) starting at
 * `startRow`, chaining consecutive elements with `linear` edges. Returns
 * the row cursor after the sequence, plus the first/last node ids so the
 * caller can connect this sequence to its surrounding context (a
 * conditional pill above, a fork pill above, the next sibling below).
 */
function layoutSequence(
  steps: readonly StepNode[],
  startRow: number,
  lane: number,
  collector: Collector
): SequenceResult {
  let row = startRow;
  let firstId: string | null = null;
  let prevId: string | null = null;
  // Overrides the NEXT edge's kind/thickness — used for the
  // if-without-else BYPASS edge (DESIGN.md: "thick bypass edge to next
  // step"), which is the exit edge FROM the conditional pill (not from
  // any branch, since no branch executed).
  let pendingEdgeKind: LayoutEdgeKind = "linear";
  let pendingThick = false;

  for (const step of steps) {
    if (step.type === "action") {
      const id = nodeId(step);
      collector.nodes.push({
        id,
        kind: "action",
        color: step.color,
        label: labelFor(step),
        status: step.status,
        row,
        lane,
        nestingDepth: step.nestingDepth,
        durationMs: step.durationMs,
        dashed: step.status === "not_executed",
        instanceId: step.instanceId,
        evaluatedValue: null,
        branchTaken: null,
        actionType: step.actionType,
        stepName: step.name,
        conditionEventId: null,
      });
      if (prevId) {
        pushEdge(collector, prevId, id, pendingEdgeKind, {
          thick: pendingThick,
        });
      }
      pendingEdgeKind = "linear";
      pendingThick = false;
      firstId ??= id;
      prevId = id;
      row += 1;
      continue;
    }

    if (step.type === "conditional") {
      const pillId = nodeId(step);
      collector.nodes.push({
        id: pillId,
        kind: "conditional",
        color: "decision",
        label: labelFor(step),
        status: step.executed ? "ok" : "not_executed",
        row,
        lane,
        nestingDepth: step.nestingDepth,
        durationMs: null,
        dashed: !step.executed,
        instanceId: null,
        evaluatedValue: step.evaluatedValue,
        branchTaken: step.branchTaken,
        actionType: null,
        stepName: step.name,
        conditionEventId: step.conditionEventId,
      });
      if (prevId) {
        pushEdge(collector, prevId, pillId, pendingEdgeKind, {
          thick: pendingThick,
        });
      }
      pendingEdgeKind = "linear";
      pendingThick = false;
      firstId ??= pillId;
      row += 1;

      let maxRow = row;
      let takenTailId: string | null = null;
      for (const branch of step.branches) {
        const branchResult = layoutSequence(branch.steps, row, lane, collector);
        if (branchResult.firstId) {
          pushEdge(
            collector,
            pillId,
            branchResult.firstId,
            branch.taken ? "taken" : "not-taken",
            {
              dashed: !branch.taken,
              thick: branch.taken,
              label: branch.label,
            }
          );
        }
        if (branch.taken) {
          takenTailId = branchResult.tailId ?? pillId;
        }
        maxRow = Math.max(maxRow, branchResult.nextRow);
      }
      row = maxRow;

      // Bypass: an if-without-else that evaluated false (no branch taken,
      // no default) — the exit edge to the NEXT sibling comes straight
      // from the pill itself, thick, per DESIGN.md.
      const isBypass = step.executed && step.branchTaken === null;
      if (isBypass) {
        prevId = pillId;
        pendingEdgeKind = "bypass";
        pendingThick = true;
      } else {
        prevId = takenTailId;
        pendingEdgeKind = "linear";
        pendingThick = false;
      }
      continue;
    }

    // step.type === "fork"
    const forkId = nodeId(step);
    collector.nodes.push({
      id: forkId,
      kind: "fork",
      color: "platform",
      label: labelFor(step),
      status: step.status,
      row,
      lane,
      nestingDepth: step.nestingDepth,
      durationMs: step.durationMs,
      dashed: step.status === "not_executed",
      instanceId: null,
      evaluatedValue: null,
      branchTaken: null,
      // "branch" is the fork's own `WorkflowActionKind` discriminant
      // (`IWorkflowBranchAction.activity`) — mirrors the `action` node's
      // `actionType` field above.
      actionType: "branch",
      stepName: step.name,
      conditionEventId: null,
    });
    if (prevId) {
      pushEdge(collector, prevId, forkId, pendingEdgeKind, {
        thick: pendingThick,
      });
    }
    pendingEdgeKind = "linear";
    pendingThick = false;
    firstId ??= forkId;
    row += 1;

    const visibleLanes = step.lanes.slice(0, FORK_LANE_CAP);
    const collapsedCount = step.lanes.length - visibleLanes.length;
    let maxRow = row;
    const laneTails: Array<{
      label: string;
      tailId: string | null;
      ms: number | null;
    }> = [];

    visibleLanes.forEach((laneStep, i) => {
      const laneResult = layoutSequence(laneStep.steps, row, i + 1, collector);
      if (laneResult.firstId) {
        pushEdge(collector, forkId, laneResult.firstId, "fork-out", {
          label: laneStep.label,
        });
      }
      maxRow = Math.max(maxRow, laneResult.nextRow);
      laneTails.push({
        label: laneStep.label,
        tailId: laneResult.tailId,
        ms: laneDurationMs(laneStep.steps),
      });
    });
    row = maxRow;

    const timedLanes = laneTails.filter(
      (l): l is { label: string; tailId: string | null; ms: number } =>
        l.ms !== null
    );
    const critical =
      timedLanes.length > 0
        ? timedLanes.reduce((max, l) => (l.ms > max.ms ? l : max))
        : null;

    const joinId = `${forkId}::join`;
    collector.nodes.push({
      id: joinId,
      kind: "join",
      color: "platform",
      label: "join",
      status: step.status,
      row,
      lane,
      nestingDepth: step.nestingDepth,
      durationMs: critical?.ms ?? null,
      dashed: step.status === "not_executed",
      instanceId: null,
      evaluatedValue: null,
      branchTaken: null,
      actionType: null,
      stepName: "join",
      conditionEventId: null,
    });
    for (const l of laneTails) {
      if (!l.tailId) {
        continue;
      }
      const isCritical = critical !== null && l.label === critical.label;
      pushEdge(collector, l.tailId, joinId, "join-in", {
        thick: isCritical,
        // Console UI strings in English (SPEC.md decision 5); DESIGN.md's
        // Spanish mockup label ("ruta crítica") translates to "critical path".
        label: isCritical ? `critical path · ${critical.ms}ms` : null,
      });
    }
    row += 1;

    collector.forks.push({
      forkId,
      joinId,
      laneLabels: step.lanes.map((l) => l.label),
      visibleLaneCount: visibleLanes.length,
      collapsedCount,
      criticalLane: critical?.label ?? null,
      criticalMs: critical?.ms ?? null,
    });

    prevId = joinId;
    pendingEdgeKind = "linear";
    pendingThick = false;
  }

  return { nextRow: row, firstId, tailId: prevId };
}

/**
 * Lays out a merged run's step tree into the equally-spaced geometry
 * model (T03's second stage). `degraded` passes through unchanged — the
 * nodes/edges are still fully generated from the DEFINITION (every step
 * naturally renders `not_executed`/dashed when no events matched it),
 * which is exactly the "artifact-only spine from definition + degraded
 * flag" contract (SPEC.md constraint).
 */
export function layoutRun(merged: IMergedRun): IRunLayout {
  const collector: Collector = { nodes: [], edges: [], forks: [] };
  layoutSequence(merged.steps, 0, 0, collector);
  return {
    nodes: collector.nodes,
    edges: collector.edges,
    forks: collector.forks,
    degraded: merged.degraded,
  };
}
