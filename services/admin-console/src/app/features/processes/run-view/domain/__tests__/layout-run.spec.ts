import { describe, expect, it } from "vitest";
import { layoutRun } from "../layout-run";
import type {
  IActionStep,
  IConditionalBranchNode,
  IConditionalStep,
  IForkLane,
  IForkStep,
  IMergedRun,
  StepColor,
  StepNode,
} from "../run-view.model";

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
  });

  it("3-case condition: renders a decision node plus one branch entry per declared case", () => {
    const cond = conditionalStep({ branchTaken: "100-500" }, [
      {
        label: "<100",
        taken: false,
        steps: [actionStep({ status: "not_executed" })],
      },
      { label: "100-500", taken: true, steps: [actionStep({ status: "ok" })] },
      {
        label: ">500",
        taken: false,
        steps: [actionStep({ status: "not_executed" })],
      },
    ]);
    const layout = layoutRun(merged([cond]));
    const decisionNode = layout.nodes.find((n) => n.kind === "conditional");
    expect(decisionNode).toBeDefined();
    const branchEdges = layout.edges.filter(
      (e) => e.kind === "taken" || e.kind === "not-taken"
    );
    expect(branchEdges).toHaveLength(3);
  });

  it("taken/not-taken: the taken branch's edge is solid+thick, others are dashed", () => {
    const cond = conditionalStep({ branchTaken: "yes" }, [
      { label: "yes", taken: true, steps: [actionStep()] },
      {
        label: "no",
        taken: false,
        steps: [actionStep({ status: "not_executed" })],
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
    expect(
      layout.nodes.some((n) => n.nestingDepth === 1 && n.kind === "conditional")
    ).toBe(true);
  });

  it("parallel fork: renders a fork pill, a join pill, and one fork-out edge per visible lane", () => {
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
    expect(layout.nodes.some((n) => n.kind === "fork")).toBe(true);
    expect(layout.nodes.some((n) => n.kind === "join")).toBe(true);
    const forkOutEdges = layout.edges.filter((e) => e.kind === "fork-out");
    expect(forkOutEdges).toHaveLength(2);
    expect(layout.forks).toHaveLength(1);
    expect(layout.forks[0]!.visibleLaneCount).toBe(2);
    expect(layout.forks[0]!.collapsedCount).toBe(0);
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
});
