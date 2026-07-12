import { describe, expect, it } from "vitest";
import type { IRunCastEntry } from "../../../../core/services/run-view.service";
import type { ILayoutEdge, ILayoutNode } from "../domain/run-view.model";
import {
  computeArtifactBoxes,
  computeArtifactColumnX,
  computeArtifactEdges,
  computeRenderedEdges,
  formatPillLabel,
  type IPositionedNode,
  isArtifactNode,
  isPillNode,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodePosition,
  nodeVisualHeight,
  PILL_HEIGHT,
  PILL_WIDTH,
  pillOffsetX,
  resolveArtifactKind,
} from "../run-view-render";

function node(overrides: Partial<ILayoutNode>): ILayoutNode {
  return {
    id: "n1",
    kind: "action",
    color: "platform",
    label: "1 · endpointCall → callOrderApi",
    status: "ok",
    row: 0,
    lane: 0,
    nestingDepth: 0,
    durationMs: 100,
    dashed: false,
    instanceId: null,
    evaluatedValue: null,
    branchTaken: null,
    actionType: "endpointCall",
    stepName: "callOrderApi",
    conditionEventId: null,
    ...overrides,
  };
}

function positioned(overrides: Partial<ILayoutNode>): IPositionedNode {
  const built = node(overrides);
  return { ...built, ...nodePosition(built) };
}

describe("isPillNode / nodeVisualHeight / pillOffsetX", () => {
  it("fork and join are pill nodes; action and conditional are not", () => {
    expect(isPillNode("fork")).toBe(true);
    expect(isPillNode("join")).toBe(true);
    expect(isPillNode("action")).toBe(false);
    expect(isPillNode("conditional")).toBe(false);
  });

  it("pill nodes render at PILL_HEIGHT; other kinds at the standard NODE_HEIGHT", () => {
    expect(nodeVisualHeight("fork")).toBe(PILL_HEIGHT);
    expect(nodeVisualHeight("join")).toBe(PILL_HEIGHT);
    expect(nodeVisualHeight("action")).toBe(NODE_HEIGHT);
    expect(nodeVisualHeight("conditional")).toBe(NODE_HEIGHT);
  });

  it("a pill is centered within the standard NODE_WIDTH lane slot", () => {
    const offset = pillOffsetX();
    expect(offset).toBe((NODE_WIDTH - PILL_WIDTH) / 2);
    expect(offset).toBeGreaterThan(0);
  });
});

describe("formatPillLabel", () => {
  it("appends the parallel glyph to a fork's domain label", () => {
    const fork = node({ kind: "fork", label: "3 · fork" });
    expect(formatPillLabel(fork)).toBe("3 · fork ∥");
  });

  it("passes a join's domain label through unchanged", () => {
    const join = node({ kind: "join", label: "join" });
    expect(formatPillLabel(join)).toBe("join");
  });
});

describe("computeRenderedEdges — pill-aware edge origin + label offset", () => {
  it("regression: an edge leaving a fork/join pill starts at the pill's own (shorter) bottom edge, not the full NODE_HEIGHT", () => {
    const fork = positioned({ id: "fork-1", kind: "fork", row: 0, lane: 0 });
    const lane = positioned({ id: "lane-1", kind: "action", row: 1, lane: 1 });
    const edge: ILayoutEdge = {
      id: "e1",
      fromId: "fork-1",
      toId: "lane-1",
      kind: "fork-out",
      dashed: false,
      thick: false,
      label: null,
    };
    const byId = new Map([
      [fork.id, fork],
      [lane.id, lane],
    ]);
    const [rendered] = computeRenderedEdges([edge], byId);
    expect(rendered!.y1).toBe(fork.y + PILL_HEIGHT);
    expect(rendered!.y1).not.toBe(fork.y + NODE_HEIGHT);
  });

  it("a linear edge between two standard action boxes starts at the full NODE_HEIGHT", () => {
    const from = positioned({ id: "a1", row: 0, lane: 0 });
    const to = positioned({ id: "a2", row: 1, lane: 0 });
    const edge: ILayoutEdge = {
      id: "e1",
      fromId: "a1",
      toId: "a2",
      kind: "linear",
      dashed: false,
      thick: false,
      label: null,
    };
    const byId = new Map([
      [from.id, from],
      [to.id, to],
    ]);
    const [rendered] = computeRenderedEdges([edge], byId);
    expect(rendered!.y1).toBe(from.y + NODE_HEIGHT);
  });

  it("a diagonal (cross-lane) edge's label is nudged off the line's own midpoint, not centered on top of it", () => {
    const from = positioned({ id: "a1", row: 0, lane: 0 });
    const to = positioned({ id: "a2", row: 1, lane: 1 });
    const edge: ILayoutEdge = {
      id: "e1",
      fromId: "a1",
      toId: "a2",
      kind: "fork-out",
      dashed: false,
      thick: false,
      label: "branch A",
    };
    const byId = new Map([
      [from.id, from],
      [to.id, to],
    ]);
    const [rendered] = computeRenderedEdges([edge], byId);
    const midX = (rendered!.x1 + rendered!.x2) / 2;
    const midY = (rendered!.y1 + rendered!.y2) / 2;
    expect(rendered!.labelX !== midX || rendered!.labelY !== midY).toBe(true);
  });
});

describe("resolveArtifactKind / isArtifactNode", () => {
  it("resolves each connector-shaped actionType to 'connector'", () => {
    for (const actionType of [
      "endpointCall",
      "mcpCall",
      "serviceCall",
      "serviceBusCall",
    ]) {
      expect(resolveArtifactKind(node({ actionType }))).toBe("connector");
    }
  });

  it("resolves agentCall to 'agent' and channelSend to 'channel'", () => {
    expect(resolveArtifactKind(node({ actionType: "agentCall" }))).toBe(
      "agent"
    );
    expect(resolveArtifactKind(node({ actionType: "channelSend" }))).toBe(
      "channel"
    );
  });

  it("resolves a plain non-artifact leaf action (jsFunction, setVariable) to null", () => {
    expect(resolveArtifactKind(node({ actionType: "jsFunction" }))).toBeNull();
    expect(resolveArtifactKind(node({ actionType: "setVariable" }))).toBeNull();
  });

  it("resolves fork/join/conditional structural nodes to null", () => {
    expect(
      resolveArtifactKind(
        node({ kind: "fork", actionType: "branch", instanceId: null })
      )
    ).toBeNull();
    expect(
      resolveArtifactKind(node({ kind: "join", actionType: null }))
    ).toBeNull();
    expect(
      resolveArtifactKind(node({ kind: "conditional", actionType: null }))
    ).toBeNull();
  });

  it("a connector/agent node is only artifact-eligible with a real instanceId", () => {
    expect(
      isArtifactNode(node({ actionType: "endpointCall", instanceId: "conn-1" }))
    ).toBe(true);
    expect(
      isArtifactNode(node({ actionType: "endpointCall", instanceId: null }))
    ).toBe(false);
    expect(
      isArtifactNode(node({ actionType: "agentCall", instanceId: null }))
    ).toBe(false);
  });

  it("a channelSend node is artifact-eligible even with a null instanceId", () => {
    expect(
      isArtifactNode(node({ actionType: "channelSend", instanceId: null }))
    ).toBe(true);
  });

  it("a plain platform/jsFunction/setVariable step is never artifact-eligible", () => {
    expect(isArtifactNode(node({ actionType: "jsFunction" }))).toBe(false);
    expect(isArtifactNode(node({ actionType: "setVariable" }))).toBe(false);
  });

  it("fork/join/conditional nodes are never artifact-eligible", () => {
    expect(isArtifactNode(node({ kind: "fork", actionType: "branch" }))).toBe(
      false
    );
    expect(isArtifactNode(node({ kind: "join", actionType: null }))).toBe(
      false
    );
    expect(
      isArtifactNode(node({ kind: "conditional", actionType: null }))
    ).toBe(false);
  });
});

describe("computeArtifactBoxes", () => {
  const cast: readonly IRunCastEntry[] = [
    { kind: "connector", id: "conn-1", name: "Order API", count: 1 },
    { kind: "agent", id: "agent-1", name: "Summarizer", count: 1 },
    { kind: "channel", id: "chan-1", name: "telegram", count: 1 },
  ];

  it("produces a right-column box for a connector action node, at the same row y as the step", () => {
    const spine = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      row: 2,
      lane: 0,
      durationMs: 183,
      status: "ok",
    });
    const boxes = computeArtifactBoxes([spine], cast);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.stepId).toBe("n1");
    expect(boxes[0]!.kind).toBe("connector");
    expect(boxes[0]!.color).toBe("platform");
    expect(boxes[0]!.y).toBe(spine.y);
    expect(boxes[0]!.x).toBe(computeArtifactColumnX([spine]));
    expect(boxes[0]!.label).toBe("connector · Order API");
    expect(boxes[0]!.subLabel).toBe("↔ · 183ms · ok");
  });

  it("produces a right-column box for an agent action node", () => {
    const spine = positioned({
      id: "n2",
      actionType: "agentCall",
      instanceId: "agent-1",
      durationMs: 412,
      status: "ok",
    });
    const boxes = computeArtifactBoxes([spine], cast);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.kind).toBe("agent");
    expect(boxes[0]!.color).toBe("agent");
    expect(boxes[0]!.label).toBe("agent · Summarizer");
  });

  it("produces a right-column box for a channel action node, falling back to the cast's channel entry (no instanceId)", () => {
    const spine = positioned({
      id: "n3",
      actionType: "channelSend",
      instanceId: null,
      durationMs: 34,
      status: "ok",
    });
    const boxes = computeArtifactBoxes([spine], cast);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.kind).toBe("channel");
    expect(boxes[0]!.color).toBe("channel");
    expect(boxes[0]!.label).toBe("channel · telegram");
  });

  it("produces NONE for a plain platform/jsFunction/setVariable step", () => {
    const spine = positioned({ id: "n4", actionType: "jsFunction" });
    expect(computeArtifactBoxes([spine], cast)).toHaveLength(0);
  });

  it("produces NONE for fork/join/conditional structural nodes", () => {
    const fork = positioned({ id: "f1", kind: "fork", actionType: "branch" });
    const join = positioned({ id: "j1", kind: "join", actionType: null });
    const cond = positioned({
      id: "c1",
      kind: "conditional",
      actionType: null,
    });
    expect(computeArtifactBoxes([fork, join, cond], cast)).toHaveLength(0);
  });

  it("all artifact boxes share the same fixed column x, one gap past the widest spine node", () => {
    const a = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      row: 0,
      lane: 0,
    });
    const b = positioned({
      id: "n2",
      actionType: "agentCall",
      instanceId: "agent-1",
      row: 3,
      lane: 1,
    });
    const boxes = computeArtifactBoxes([a, b], cast);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.x).toBe(boxes[1]!.x);
    expect(boxes[0]!.x).toBeGreaterThan(b.x + NODE_WIDTH);
  });
});

describe("computeArtifactEdges", () => {
  it("generates a request (solid) + response (dashed) edge pair with duration-only labels — no byte figures", () => {
    const spine = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      durationMs: 183,
      status: "ok",
    });
    const cast: readonly IRunCastEntry[] = [
      { kind: "connector", id: "conn-1", name: "Order API", count: 1 },
    ];
    const boxes = computeArtifactBoxes([spine], cast);
    const edges = computeArtifactEdges([spine], boxes);
    expect(edges).toHaveLength(2);

    const request = edges.find((e) => e.direction === "request")!;
    const response = edges.find((e) => e.direction === "response")!;

    expect(request.dashed).toBe(false);
    expect(request.label).toBe("req");
    expect(request.label).not.toMatch(/KB|bytes|\d{3,}\s*·/i);

    expect(response.dashed).toBe(true);
    expect(response.label).toBe("resp · 183ms");
    expect(response.label).not.toMatch(/KB|bytes|status|200|404/i);

    // Request runs spine -> artifact; response runs artifact -> spine.
    expect(request.x1).toBeLessThan(request.x2);
    expect(response.x1).toBeGreaterThan(response.x2);
  });

  it("produces no edges for a step with no paired artifact box", () => {
    const spine = positioned({ id: "n1", actionType: "jsFunction" });
    expect(computeArtifactEdges([spine], [])).toHaveLength(0);
  });
});
