import { describe, expect, it } from "vitest";
import { layoutRun } from "../layout-run";
import type {
  IActionStep,
  IConditionalBranchNode,
  IConditionalStep,
  IForkLane,
  IForkStep,
  IMergedRun,
  ITriggerStep,
  StepColor,
  StepNode,
} from "../run-view.model";

function triggerStep(overrides: Partial<ITriggerStep> = {}): ITriggerStep {
  return {
    type: "trigger",
    name: "http-generic",
    channel: "http-generic",
    nestingDepth: 0,
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function actionStep(overrides: Partial<IActionStep> = {}): IActionStep {
  return {
    type: "action",
    actionIndex: 0,
    branchPath: null,
    nestingDepth: 0,
    actionType: "endpointCall",
    name: "callOrderApi",
    color: "platform" as StepColor,
    status: "ok",
    instanceId: "order-api",
    durationMs: 100,
    startedAt: "2026-07-11T10:00:00.000Z",
    completedAt: "2026-07-11T10:00:00.100Z",
    ...overrides,
  };
}

function conditionalStep(
  overrides: Partial<IConditionalStep> = {},
  branches: IConditionalBranchNode[] = []
): IConditionalStep {
  return {
    type: "conditional",
    actionIndex: 0,
    branchPath: null,
    nestingDepth: 0,
    name: "checkTotal",
    color: "decision",
    executed: true,
    expression: "{{order.total}}",
    evaluatedValue: "320",
    branchTaken: null,
    hasDefault: false,
    branches,
    startedAt: "2026-07-11T10:00:00.000Z",
    completedAt: "2026-07-11T10:00:00.000Z",
    conditionEventId: "cond-evt-1",
    ...overrides,
  };
}

function forkStep(
  overrides: Partial<IForkStep> = {},
  lanes: IForkLane[] = []
): IForkStep {
  return {
    type: "fork",
    actionIndex: 0,
    branchPath: null,
    nestingDepth: 0,
    name: "fanOut",
    color: "platform",
    status: "ok",
    durationMs: null,
    lanes,
    startedAt: "2026-07-11T10:00:00.000Z",
    completedAt: "2026-07-11T10:00:00.000Z",
    ...overrides,
  };
}

function merged(steps: StepNode[], degraded = false): IMergedRun {
  return { steps, degraded };
}

describe("layoutRun", () => {
  it("linear: two sequential steps get consecutive rows and a linear edge between them", () => {
    const step1 = actionStep({ actionIndex: 0, name: "callOrderApi" });
    const step2 = actionStep({ actionIndex: 1, name: "notify" });
    const layout = layoutRun(merged([step1, step2]));

    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes[0]!.row).toBe(0);
    expect(layout.nodes[1]!.row).toBe(1);
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0]!.kind).toBe("linear");
    expect(layout.edges[0]!.dashed).toBe(false);
    expect(layout.edges[0]!.thick).toBe(false);

    // Top-level steps are on the main spine.
    expect(layout.nodes.every((n) => n.onSpine === true)).toBe(true);
  });

  it("3-case condition: renders a decision node plus one branch entry per declared case, each in its own lane, CENTERED on the pill", () => {
    const cond = conditionalStep({ branchTaken: "100-500" }, [
      {
        label: "<100",
        taken: false,
        steps: [actionStep({ branchPath: "<100", status: "not_executed" })],
      },
      {
        label: "100-500",
        taken: true,
        steps: [actionStep({ branchPath: "100-500", status: "ok" })],
      },
      {
        label: ">500",
        taken: false,
        steps: [actionStep({ branchPath: ">500", status: "not_executed" })],
      },
    ]);
    const layout = layoutRun(merged([cond]));
    const decisionNode = layout.nodes.find((n) => n.kind === "conditional");
    expect(decisionNode).toBeDefined();
    const branchEdges = layout.edges.filter(
      (e) => e.kind === "taken" || e.kind === "not-taken"
    );
    expect(branchEdges).toHaveLength(3);

    // Side-by-side lanes: the three branch-entry nodes must sit in three
    // DISTINCT columns, not stacked on top of each other in the same lane.
    const branchEntryNodes = branchEdges
      .map((e) => layout.nodes.find((n) => n.id === e.toId))
      .filter((n): n is NonNullable<typeof n> => n !== undefined);
    expect(branchEntryNodes).toHaveLength(3);
    const lanes = new Set(branchEntryNodes.map((n) => n.lane));
    expect(lanes.size).toBe(3);

    // Centered geometry: for N=3 branches around pill lane 0, the lanes are
    // exactly {-1, 0, +1} — the middle case sits directly under the pill.
    expect(new Set(branchEntryNodes.map((n) => n.lane))).toEqual(
      new Set([-1, 0, 1])
    );
    // Symmetry check (equivalent, more general assertion): the mean of the
    // branch lanes equals the pill's own lane.
    const mean =
      branchEntryNodes.reduce((sum, n) => sum + n.lane, 0) /
      branchEntryNodes.length;
    expect(mean).toBe(decisionNode!.lane);

    // None of the branch nodes are on the spine — they are nested inside a
    // condition branch, even the middle one that happens to land at lane 0.
    expect(branchEntryNodes.every((n) => n.onSpine === false)).toBe(true);
    expect(decisionNode!.onSpine).toBe(true);
  });

  it("taken/not-taken: the taken branch's edge is solid+thick, others are dashed, and each branch node has its own lane", () => {
    const cond = conditionalStep({ branchTaken: "yes" }, [
      { label: "yes", taken: true, steps: [actionStep({ branchPath: "yes" })] },
      {
        label: "no",
        taken: false,
        steps: [actionStep({ branchPath: "no", status: "not_executed" })],
      },
    ]);
    const layout = layoutRun(merged([cond]));
    const takenEdge = layout.edges.find((e) => e.label === "yes");
    const notTakenEdge = layout.edges.find((e) => e.label === "no");
    expect(takenEdge?.kind).toBe("taken");
    expect(takenEdge?.dashed).toBe(false);
    expect(takenEdge?.thick).toBe(true);
    expect(notTakenEdge?.kind).toBe("not-taken");
    expect(notTakenEdge?.dashed).toBe(true);
    expect(notTakenEdge?.thick).toBe(false);

    const takenNode = layout.nodes.find((n) => n.id === takenEdge?.toId);
    const notTakenNode = layout.nodes.find((n) => n.id === notTakenEdge?.toId);
    expect(takenNode?.lane).not.toBe(notTakenNode?.lane);
  });

  it("taken continuity: the edge to the next sibling after the conditional originates from the taken branch's tail node, not another column", () => {
    const cond = conditionalStep({ branchTaken: "yes" }, [
      { label: "yes", taken: true, steps: [actionStep({ branchPath: "yes" })] },
      {
        label: "no",
        taken: false,
        steps: [actionStep({ branchPath: "no", status: "not_executed" })],
      },
    ]);
    const next = actionStep({ actionIndex: 1, name: "sendMessage" });
    const layout = layoutRun(merged([cond, next]));

    const takenEdge = layout.edges.find((e) => e.label === "yes");
    const takenTailNode = layout.nodes.find((n) => n.id === takenEdge?.toId);
    const nextNode = layout.nodes.find((n) => n.stepName === "sendMessage");
    const continuityEdge = layout.edges.find((e) => e.toId === nextNode?.id);
    expect(continuityEdge).toBeDefined();
    expect(continuityEdge?.fromId).toBe(takenTailNode?.id);
  });

  it("nested if: an inner conditional inside a taken branch increases nesting depth in its own node", () => {
    const inner = conditionalStep(
      {
        actionIndex: 0,
        branchPath: "yes",
        nestingDepth: 1,
        branchTaken: "true",
      },
      [
        {
          label: "true",
          taken: true,
          steps: [actionStep({ branchPath: "yes/true", nestingDepth: 2 })],
        },
      ]
    );
    const outer = conditionalStep({ branchTaken: "yes" }, [
      { label: "yes", taken: true, steps: [inner] },
    ]);
    const layout = layoutRun(merged([outer]));
    const nested = layout.nodes.find((n) => n.nestingDepth === 2);
    expect(nested).toBeDefined();
    const innerPill = layout.nodes.find(
      (n) => n.nestingDepth === 1 && n.kind === "conditional"
    );
    expect(innerPill).toBeDefined();

    // Centered geometry: the outer conditional has a SINGLE branch ("yes"),
    // so N=1 centers it exactly on the pill's own lane (0) — no lane shift
    // for a single case. The inner conditional (nested inside that branch)
    // also has a single case, so it too stays centered at lane 0. Depth is
    // now the only thing distinguishing these nodes from the spine — which
    // is exactly why `onSpine` (not `lane === 0`) is the correct spine
    // check.
    expect(innerPill?.lane).toBe(0);
    expect(nested?.lane).toBe(0);
    expect(innerPill?.onSpine).toBe(false);
    expect(nested?.onSpine).toBe(false);
  });

  it("parallel fork: renders a fork pill, a join pill, and one fork-out edge per visible lane, CENTERED on the fork pill", () => {
    const fork = forkStep({}, [
      {
        label: "A",
        steps: [
          actionStep({
            branchPath: "A",
            durationMs: 100,
            completedAt: "2026-07-11T10:00:00.100Z",
          }),
        ],
      },
      {
        label: "B",
        steps: [
          actionStep({
            branchPath: "B",
            durationMs: 400,
            completedAt: "2026-07-11T10:00:00.400Z",
          }),
        ],
      },
    ]);
    const layout = layoutRun(merged([fork]));
    const forkNode = layout.nodes.find((n) => n.kind === "fork");
    expect(forkNode).toBeDefined();
    expect(layout.nodes.some((n) => n.kind === "join")).toBe(true);
    const forkOutEdges = layout.edges.filter((e) => e.kind === "fork-out");
    expect(forkOutEdges).toHaveLength(2);
    expect(layout.forks).toHaveLength(1);
    expect(layout.forks[0]!.visibleLaneCount).toBe(2);
    expect(layout.forks[0]!.collapsedCount).toBe(0);

    // Centered geometry: N=2 lanes around the fork pill's own lane (0) land
    // symmetrically at {-0.5, +0.5} — no lane touches the pill's own lane
    // directly (even count), but they are symmetric around it.
    const laneNodes = forkOutEdges
      .map((e) => layout.nodes.find((n) => n.id === e.toId))
      .filter((n): n is NonNullable<typeof n> => n !== undefined);
    expect(new Set(laneNodes.map((n) => n.lane))).toEqual(new Set([-0.5, 0.5]));
    const mean =
      laneNodes.reduce((sum, n) => sum + n.lane, 0) / laneNodes.length;
    expect(mean).toBe(forkNode!.lane);
    expect(laneNodes.every((n) => n.onSpine === false)).toBe(true);
    expect(forkNode!.onSpine).toBe(true);
  });

  it("fork with more than FORK_LANE_CAP lanes collapses the rest", () => {
    const lanes: IForkLane[] = ["A", "B", "C", "D", "E"].map((label) => ({
      label,
      steps: [actionStep({ branchPath: label })],
    }));
    const fork = forkStep({}, lanes);
    const layout = layoutRun(merged([fork]));
    expect(layout.forks[0]!.visibleLaneCount).toBe(3);
    expect(layout.forks[0]!.collapsedCount).toBe(2);
    expect(layout.edges.filter((e) => e.kind === "fork-out")).toHaveLength(3);
  });

  it("critical path selection: the slowest lane's join edge is thick and labeled with its ms", () => {
    const fork = forkStep({}, [
      {
        label: "A",
        steps: [
          actionStep({
            branchPath: "A",
            startedAt: "2026-07-11T10:00:00.000Z",
            completedAt: "2026-07-11T10:00:00.100Z",
          }),
        ],
      },
      {
        label: "B",
        steps: [
          actionStep({
            branchPath: "B",
            startedAt: "2026-07-11T10:00:00.000Z",
            completedAt: "2026-07-11T10:00:00.400Z",
          }),
        ],
      },
    ]);
    const layout = layoutRun(merged([fork]));
    expect(layout.forks[0]!.criticalLane).toBe("B");
    expect(layout.forks[0]!.criticalMs).toBe(400);
    const joinEdges = layout.edges.filter((e) => e.kind === "join-in");
    const criticalEdge = joinEdges.find((e) => e.thick);
    expect(criticalEdge?.label).toBe("critical path · 400ms");
    const nonCriticalEdge = joinEdges.find((e) => !e.thick);
    expect(nonCriticalEdge?.label).toBeNull();
  });

  it("bypass: an if-without-else evaluating false emits a thick bypass edge straight from the decision pill to the next sibling", () => {
    const cond = conditionalStep({ branchTaken: null, hasDefault: false }, [
      {
        label: "true",
        taken: false,
        steps: [actionStep({ status: "not_executed" })],
      },
    ]);
    const next = actionStep({ actionIndex: 1, name: "sendMessage" });
    const layout = layoutRun(merged([cond, next]));
    const bypassEdge = layout.edges.find((e) => e.kind === "bypass");
    expect(bypassEdge).toBeDefined();
    expect(bypassEdge?.thick).toBe(true);
    expect(bypassEdge?.dashed).toBe(false);
    const decisionNode = layout.nodes.find((n) => n.kind === "conditional")!;
    expect(bypassEdge?.fromId).toBe(decisionNode.id);
  });

  it("degraded: no step events (all not_executed) still produces the full dashed spine from the definition", () => {
    const step1 = actionStep({ actionIndex: 0, status: "not_executed" });
    const cond = conditionalStep(
      { actionIndex: 1, executed: false, branchTaken: null },
      [
        {
          label: "x",
          taken: false,
          steps: [
            actionStep({
              actionIndex: 0,
              branchPath: "x",
              status: "not_executed",
            }),
          ],
        },
      ]
    );
    const layout = layoutRun(merged([step1, cond], true));
    expect(layout.degraded).toBe(true);
    expect(layout.nodes.every((n) => n.dashed)).toBe(true);
    expect(layout.nodes.length).toBeGreaterThan(0);
  });

  it("equally-spaced: row numbers increase monotonically by node count, independent of durationMs", () => {
    const step1 = actionStep({ actionIndex: 0, durationMs: 5000 });
    const step2 = actionStep({ actionIndex: 1, durationMs: 1 });
    const layout = layoutRun(merged([step1, step2]));
    expect(layout.nodes[1]!.row - layout.nodes[0]!.row).toBe(1);
  });

  it("BUG 1 fix: a leading trigger step positions first, on spine, not dashed, teal, with a linear edge to the first real action", () => {
    const trigger = triggerStep({ name: "http-generic" });
    const action = actionStep({ actionIndex: 0, name: "fanout" });
    const layout = layoutRun(merged([trigger, action]));

    expect(layout.nodes).toHaveLength(2);
    const triggerNode = layout.nodes[0]!;
    const actionNode = layout.nodes[1]!;
    expect(triggerNode.kind).toBe("trigger");
    expect(triggerNode.color).toBe("channel");
    expect(triggerNode.row).toBe(0);
    expect(triggerNode.onSpine).toBe(true);
    expect(triggerNode.dashed).toBe(false);
    expect(triggerNode.status).toBe("ok");
    expect(triggerNode.stepName).toBe("http-generic");

    expect(actionNode.row).toBe(1);
    expect(layout.edges).toHaveLength(1);
    const edge = layout.edges[0]!;
    expect(edge.kind).toBe("linear");
    expect(edge.fromId).toBe(triggerNode.id);
    expect(edge.toId).toBe(actionNode.id);
    expect(edge.dashed).toBe(false);
  });

  it("action node label shows the human action NAME, not the instance UUID", () => {
    const step = actionStep({
      name: "getPost",
      instanceId: "d021a4ce-9112-4835-a1fa-74aedd2d2133",
    });
    const layout = layoutRun(merged([step]));
    expect(layout.nodes[0]!.label).toContain("getPost");
    expect(layout.nodes[0]!.label).not.toContain("d021a4ce");
  });
});
