import { describe, expect, it } from "vitest";
import type { IRunCastEntry } from "../../../../core/services/run-view.service";
import type {
  IForkGeometry,
  ILayoutEdge,
  ILayoutNode,
} from "../domain/run-view.model";
import {
  ARTIFACT_BOX_WIDTH,
  computeArtifactBoxes,
  computeArtifactColumnX,
  computeArtifactEdges,
  computeContentWidth,
  computeForkCollapseChips,
  computeNodePositions,
  computeRenderedEdges,
  formatPillLabel,
  type IPositionedNode,
  isArtifactNode,
  isNestedArtifactNode,
  isPillNode,
  isSpineArtifactNode,
  isUuidLike,
  LANE_BASE_X,
  LANE_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodePosition,
  nodeSubLabel,
  nodeVisualHeight,
  PILL_HEIGHT,
  PILL_WIDTH,
  pillOffsetX,
  resolveArtifactKind,
} from "../run-view-render";

function forkGeometry(overrides: Partial<IForkGeometry>): IForkGeometry {
  return {
    forkId: "fork-1",
    joinId: "join-1",
    laneLabels: ["a", "b", "c", "d"],
    visibleLaneCount: 3,
    collapsedCount: 1,
    criticalLane: null,
    criticalMs: null,
    ...overrides,
  };
}

function node(overrides: Partial<ILayoutNode>): ILayoutNode {
  return {
    id: "n1",
    kind: "action",
    color: "platform",
    label: "1 · endpointCall → callOrderApi",
    status: "ok",
    row: 0,
    lane: 0,
    onSpine: true,
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

describe("computeNodePositions — min-lane offset (centered fork/condition lanes)", () => {
  it("a node at lane 0 sits at x=LANE_BASE_X when no node has a negative lane", () => {
    const a = node({ id: "a", lane: 0, row: 0 });
    const b = node({ id: "b", lane: 1, row: 1 });
    const [posA] = computeNodePositions([a, b]);
    expect(posA!.x).toBe(LANE_BASE_X);
  });

  it("negative lanes never produce x<LANE_BASE_X — the whole run shifts right by minLane", () => {
    const left = node({ id: "left", lane: -1, row: 0 });
    const center = node({ id: "center", lane: 0, row: 0 });
    const right = node({ id: "right", lane: 1, row: 0 });
    const positions = computeNodePositions([left, center, right]);
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(LANE_BASE_X);
    }
    const byId = new Map(positions.map((p) => [p.id, p]));
    // Leftmost lane (-1) lands exactly at LANE_BASE_X.
    expect(byId.get("left")!.x).toBe(LANE_BASE_X);
    // Center (lane 0) and right (lane 1) shift by the same minLane offset.
    expect(byId.get("center")!.x).toBe(LANE_BASE_X + LANE_GAP);
    expect(byId.get("right")!.x).toBe(LANE_BASE_X + 2 * LANE_GAP);
  });

  it("fractional lanes (centered fork/condition columns) offset by the same fraction of LANE_GAP", () => {
    const left = node({ id: "left", lane: -0.5, row: 0 });
    const right = node({ id: "right", lane: 0.5, row: 0 });
    const positions = computeNodePositions([left, right]);
    const byId = new Map(positions.map((p) => [p.id, p]));
    expect(byId.get("left")!.x).toBe(LANE_BASE_X);
    expect(byId.get("right")!.x).toBe(LANE_BASE_X + LANE_GAP);
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

  it("bug 3 regression: a fork-out label always floats ABOVE its line's midpoint, regardless of which way the line slopes", () => {
    // Fork pill at lane 0 fanning out down-right into lane 1 (label would
    // previously drift below the line for this slope direction).
    const forkDownRight = positioned({
      id: "f1",
      kind: "fork",
      row: 0,
      lane: 0,
    });
    const laneRight = positioned({ id: "l1", kind: "action", row: 1, lane: 1 });
    // Fork pill fanning out down-LEFT (opposite slope) into a nested lane.
    const forkDownLeft = positioned({
      id: "f2",
      kind: "fork",
      row: 0,
      lane: 1,
    });
    const laneLeft = positioned({
      id: "l2",
      kind: "action",
      row: 1,
      lane: 0,
    });
    const edges: ILayoutEdge[] = [
      {
        id: "e1",
        fromId: "f1",
        toId: "l1",
        kind: "fork-out",
        dashed: false,
        thick: false,
        label: "pokeapi",
      },
      {
        id: "e2",
        fromId: "f2",
        toId: "l2",
        kind: "fork-out",
        dashed: false,
        thick: false,
        label: "catfacts",
      },
    ];
    const byId = new Map([
      [forkDownRight.id, forkDownRight],
      [laneRight.id, laneRight],
      [forkDownLeft.id, forkDownLeft],
      [laneLeft.id, laneLeft],
    ]);
    const rendered = computeRenderedEdges(edges, byId);
    for (const edge of rendered) {
      const midY = (edge.y1 + edge.y2) / 2;
      expect(edge.labelY).toBeLessThan(midY);
    }
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
      lane: 0,
    });
    const boxes = computeArtifactBoxes([a, b], cast);
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.x).toBe(boxes[1]!.x);
    expect(boxes[0]!.x).toBeGreaterThan(b.x + NODE_WIDTH);
  });

  // Run-view visual rewrite slice 5: the mockup only pairs a right-column
  // box with TOP-LEVEL SPINE artifact steps — a fork-lane or condition-
  // branch artifact step renders its info inline instead (see
  // `isNestedArtifactNode`/`nodeSubLabel`), which is what avoids the old
  // same-row collision the removed vertical-stacking hack used to paper
  // over.
  it("produces a box for a spine-level (onSpine true) connector node", () => {
    const spine = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 0,
      onSpine: true,
    });
    const boxes = computeArtifactBoxes([spine], cast);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.stepId).toBe("n1");
  });

  it("produces NO box for a fork-lane (onSpine false, lane > 0) connector/agent node", () => {
    const laneNode = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 1,
      onSpine: false,
    });
    expect(computeArtifactBoxes([laneNode], cast)).toHaveLength(0);
  });

  it("produces NO box for a nested (onSpine false, nestingDepth > 0) condition-branch agent node", () => {
    const nestedNode = positioned({
      id: "n1",
      actionType: "agentCall",
      instanceId: "agent-1",
      nestingDepth: 1,
      lane: 0,
      onSpine: false,
    });
    expect(computeArtifactBoxes([nestedNode], cast)).toHaveLength(0);
  });

  it("produces NO box for a condition's MIDDLE branch node that coincides with lane 0 but is not on the spine (centered-lane regression)", () => {
    const middleBranchNode = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 1,
      lane: 0,
      onSpine: false,
    });
    expect(computeArtifactBoxes([middleBranchNode], cast)).toHaveLength(0);
  });
});

describe("nodeSubLabel — spine unchanged, nested artifact steps get an inline collapsed chip", () => {
  it("a spine node (onSpine true) keeps the plain status/duration sub-label", () => {
    const spine = node({
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 0,
      onSpine: true,
      status: "ok",
      durationMs: 183,
    });
    expect(nodeSubLabel(spine)).toBe("ok · 183ms");
  });

  it("a non-artifact node (jsFunction) never gets the inline chip regardless of nesting", () => {
    const nested = node({
      actionType: "jsFunction",
      instanceId: null,
      nestingDepth: 1,
      lane: 0,
      onSpine: false,
      status: "ok",
      durationMs: 50,
    });
    expect(nodeSubLabel(nested)).toBe("ok · 50ms");
  });

  it("a fork-lane connector node (onSpine false, lane > 0) gets the '↔ <kind> · <ms>ms · <status>' inline chip", () => {
    const laneNode = node({
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 1,
      onSpine: false,
      status: "ok",
      durationMs: 356,
    });
    expect(nodeSubLabel(laneNode)).toBe("↔ connector · 356ms · ok");
  });

  it("a condition-branch agent node (onSpine false, nestingDepth > 0) gets the inline chip too", () => {
    const branchNode = node({
      actionType: "agentCall",
      instanceId: "agent-1",
      nestingDepth: 1,
      lane: 0,
      onSpine: false,
      status: "ok",
      durationMs: 412,
    });
    expect(nodeSubLabel(branchNode)).toBe("↔ agent · 412ms · ok");
  });
});

describe("nodeSubLabel — decision node shows the evaluated subtitle inline (in-box, not a floating element)", () => {
  it("a conditional node with an evaluated value and a taken branch returns the evaluated subtitle, not the plain status", () => {
    const decision = node({
      kind: "conditional",
      actionType: null,
      instanceId: null,
      evaluatedValue: "320",
      branchTaken: "medium",
      status: "ok",
    });
    const label = nodeSubLabel(decision);
    expect(label).toContain("320");
    expect(label).toContain("medium");
    expect(label).toContain("✓");
  });

  it("a conditional node with no evaluation (evaluatedValue null) falls back to the plain status label", () => {
    const decision = node({
      kind: "conditional",
      actionType: null,
      instanceId: null,
      evaluatedValue: null,
      branchTaken: null,
      status: "not_executed",
      durationMs: null,
    });
    expect(nodeSubLabel(decision)).toBe("not executed");
  });
});

describe("isSpineArtifactNode / isNestedArtifactNode", () => {
  it("a spine artifact node (onSpine true) is spine, not nested", () => {
    const spine = node({
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 0,
      onSpine: true,
    });
    expect(isSpineArtifactNode(spine)).toBe(true);
    expect(isNestedArtifactNode(spine)).toBe(false);
  });

  it("a fork-lane artifact node (onSpine false, lane > 0) is nested, not spine", () => {
    const laneNode = node({
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 2,
      onSpine: false,
    });
    expect(isSpineArtifactNode(laneNode)).toBe(false);
    expect(isNestedArtifactNode(laneNode)).toBe(true);
  });

  it("a condition-branch artifact node (onSpine false, nestingDepth > 0) is nested, not spine", () => {
    const branchNode = node({
      actionType: "channelSend",
      instanceId: null,
      nestingDepth: 1,
      lane: 0,
      onSpine: false,
    });
    expect(isSpineArtifactNode(branchNode)).toBe(false);
    expect(isNestedArtifactNode(branchNode)).toBe(true);
  });

  it("a middle-branch node at lane 0 with onSpine=false is NESTED (gets a chip), not a spine box — centered-lane regression", () => {
    const middleBranchNode = node({
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 1,
      lane: 0,
      onSpine: false,
    });
    expect(isSpineArtifactNode(middleBranchNode)).toBe(false);
    expect(isNestedArtifactNode(middleBranchNode)).toBe(true);
  });

  it("a non-artifact node is neither spine nor nested regardless of position", () => {
    const plain = node({
      actionType: "jsFunction",
      nestingDepth: 1,
      lane: 2,
      onSpine: false,
    });
    expect(isSpineArtifactNode(plain)).toBe(false);
    expect(isNestedArtifactNode(plain)).toBe(false);
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

  it("bug 3 regression: the req and resp labels of a pair sit in the horizontal gap between the two boxes, not on top of each other", () => {
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
    const [request, response] = computeArtifactEdges([spine], boxes);

    // Both labels sit horizontally between the spine box's right edge and
    // the artifact box's left edge (the shared request/response line's own
    // x-span), not past either endpoint.
    expect(request!.labelX).toBeGreaterThan(request!.x1);
    expect(request!.labelX).toBeLessThan(request!.x2);
    expect(response!.labelX).toBeGreaterThan(response!.x2);
    expect(response!.labelX).toBeLessThan(response!.x1);

    // The two labels no longer land on the exact same point (previously
    // both rendered at the shared line's midpoint, directly overlapping).
    expect(request!.labelY).not.toBe(response!.labelY);
  });
});

describe("bug 1 regression: content width includes the full artifact box extent", () => {
  it("computeContentWidth is wide enough to contain the widest artifact box's right edge + padding, not just its column x", () => {
    const spine = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      row: 0,
      lane: 0,
    });
    const cast: readonly IRunCastEntry[] = [
      { kind: "connector", id: "conn-1", name: "Order API", count: 1 },
    ];
    const boxes = computeArtifactBoxes([spine], cast);
    const width = computeContentWidth([spine], [], boxes);
    const widestBoxRightEdge = Math.max(
      ...boxes.map((b) => b.x + ARTIFACT_BOX_WIDTH)
    );
    expect(width).toBeGreaterThan(widestBoxRightEdge);
  });

  it("truncates a long raw instance-id fallback (no cast name resolved) so the label fits the box, but keeps a resolved cast name intact", () => {
    const spine = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "d021a4ce-9112-4835-a1fa-74aedd2d2133",
      row: 0,
      lane: 0,
    });
    const boxes = computeArtifactBoxes([spine], []);
    expect(boxes[0]!.label).toBe("connector · d021a4ce…");
    expect(boxes[0]!.label.length).toBeLessThan(30);

    const named = computeArtifactBoxes(
      [spine],
      [
        {
          kind: "connector",
          id: "d021a4ce-9112-4835-a1fa-74aedd2d2133",
          name: "Order API",
          count: 1,
        },
      ]
    );
    expect(named[0]!.label).toBe("connector · Order API");
  });
});

// Run-view visual rewrite slice 5: the same-row collision the old
// vertical-stacking hack (bug 2, slice 4) used to paper over is now
// impossible by construction — 3 parallel fork-lane artifact steps on the
// SAME `row` never produce right-column boxes at all (`lane > 0`
// disqualifies them from `computeArtifactBoxes`), so there is nothing to
// stack. Their artifact info instead renders inline in their own boxes
// (`nodeSubLabel`), which is exercised by the "nodeSubLabel" describe block
// above.
describe("bug 2 (slice 4) is now structurally avoided: fork-lane artifacts never reach the right column", () => {
  it("3 artifact nodes fanned out on the same row (3 fork lanes) produce ZERO right-column boxes, not 3 stacked ones", () => {
    const cast: readonly IRunCastEntry[] = [
      {
        kind: "connector",
        id: "conn-get-post",
        name: "jsonplaceholder",
        count: 1,
      },
      { kind: "connector", id: "conn-get-pokemon", name: "pokeapi", count: 1 },
      { kind: "connector", id: "conn-get-catfact", name: "catfacts", count: 1 },
    ];
    const lane1 = positioned({
      id: "getPost",
      actionType: "endpointCall",
      instanceId: "conn-get-post",
      row: 1,
      lane: 1,
      onSpine: false,
    });
    const lane2 = positioned({
      id: "getPokemon",
      actionType: "endpointCall",
      instanceId: "conn-get-pokemon",
      row: 1,
      lane: 2,
      onSpine: false,
    });
    const lane3 = positioned({
      id: "getCatFact",
      actionType: "endpointCall",
      instanceId: "conn-get-catfact",
      row: 1,
      lane: 3,
      onSpine: false,
    });
    // All three source nodes share the same row -> would have shared the
    // same node.y under the old shared-column layout.
    expect(lane1.y).toBe(lane2.y);
    expect(lane2.y).toBe(lane3.y);

    expect(computeArtifactBoxes([lane1, lane2, lane3], cast)).toHaveLength(0);

    // No paired boxes -> no artifact edges either (no req/resp arrows
    // crossing into the right column for fork-lane steps).
    expect(computeArtifactEdges([lane1, lane2, lane3], [])).toHaveLength(0);
  });
});

describe("computeForkCollapseChips", () => {
  it("a fork with collapsedCount > 0 produces one chip, positioned past the rightmost node's RIGHT edge", () => {
    const forkNode = positioned({
      id: "fork-1",
      kind: "fork",
      actionType: "branch",
      row: 0,
      lane: 0,
    });
    const lane1 = positioned({
      id: "lane1",
      row: 1,
      lane: 1,
      onSpine: false,
    });
    const lane2 = positioned({
      id: "lane2",
      row: 1,
      lane: 2,
      onSpine: false,
    });
    const positionsById = new Map<string, IPositionedNode>([
      [forkNode.id, forkNode],
      [lane1.id, lane1],
      [lane2.id, lane2],
    ]);
    const chips = computeForkCollapseChips(
      [forkGeometry({ forkId: "fork-1", collapsedCount: 2 })],
      positionsById
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]!.forkId).toBe("fork-1");
    const maxRight = Math.max(
      ...[forkNode, lane1, lane2].map((p) => p.x + NODE_WIDTH)
    );
    // Bug fix: must trail the rightmost node's RIGHT edge (x + NODE_WIDTH),
    // not its LEFT edge (x) — the pre-fix formula placed the chip up to a
    // full NODE_WIDTH too far left, overlapping the node it should trail.
    expect(chips[0]!.x).toBeGreaterThanOrEqual(maxRight);
    expect(chips[0]!.x).toBe(maxRight + LANE_GAP);
  });

  it("a fork with collapsedCount <= 0 produces no chip", () => {
    const forkNode = positioned({
      id: "fork-1",
      kind: "fork",
      actionType: "branch",
      row: 0,
      lane: 0,
    });
    const positionsById = new Map<string, IPositionedNode>([
      [forkNode.id, forkNode],
    ]);
    const chips = computeForkCollapseChips(
      [forkGeometry({ forkId: "fork-1", collapsedCount: 0 })],
      positionsById
    );
    expect(chips).toHaveLength(0);
  });

  it("empty positions -> sane fallback, no crash", () => {
    const chips = computeForkCollapseChips(
      [forkGeometry({ forkId: "fork-1", collapsedCount: 1 })],
      new Map<string, IPositionedNode>()
    );
    // No positioned fork node to anchor to -> the fork is skipped entirely
    // (its forkId can't be resolved in positionsById), not a crash.
    expect(chips).toHaveLength(0);
  });

  it("REGRESSION: a collapse chip and the artifact column never overlap, even when both are present in the same run", () => {
    // A fork whose lanes fan out wide enough to be the rightmost content,
    // PLUS a spine artifact node (connector) that produces a right-column
    // artifact box — this is the exact combination the pre-fix formula got
    // wrong (chip landed inside/behind the artifact column).
    const forkNode = positioned({
      id: "fork-1",
      kind: "fork",
      actionType: "branch",
      row: 0,
      lane: 0,
    });
    const lane1 = positioned({
      id: "lane1",
      row: 1,
      lane: 1,
      onSpine: false,
    });
    const lane2 = positioned({
      id: "lane2",
      row: 1,
      lane: 2,
      onSpine: false,
    });
    const lane3 = positioned({
      id: "lane3",
      row: 1,
      lane: 3,
      onSpine: false,
    });
    const spineArtifact = positioned({
      id: "connector-1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      row: 2,
      lane: 0,
      onSpine: true,
    });
    const positions = [forkNode, lane1, lane2, lane3, spineArtifact];
    const positionsById = new Map<string, IPositionedNode>(
      positions.map((p) => [p.id, p])
    );
    const chips = computeForkCollapseChips(
      [forkGeometry({ forkId: "fork-1", collapsedCount: 2 })],
      positionsById
    );
    expect(chips).toHaveLength(1);

    const cast: readonly IRunCastEntry[] = [
      { kind: "connector", id: "conn-1", name: "Order API", count: 1 },
    ];
    const artifactBoxes = computeArtifactBoxes(positions, cast, chips);
    expect(artifactBoxes).toHaveLength(1);
    const colX = computeArtifactColumnX(positions, chips);
    expect(artifactBoxes[0]!.x).toBe(colX);

    const chip = chips[0]!;
    const chipStart = chip.x;
    const chipEnd = chip.x + NODE_WIDTH;
    const colStart = colX;
    const colEnd = colX + ARTIFACT_BOX_WIDTH;
    const overlaps = chipStart < colEnd && colStart < chipEnd;
    expect(overlaps).toBe(false);
  });
});

describe("isUuidLike", () => {
  it("matches a canonical UUID (8-4-4-4-12 hex groups)", () => {
    expect(isUuidLike("88b3da16-d20c-4ff4-95bc-d68033dc2cde")).toBe(true);
  });

  it("rejects a friendly connector/agent name", () => {
    expect(isUuidLike("http-generic")).toBe(false);
    expect(isUuidLike("getPost")).toBe(false);
  });
});

describe("bug regression: connector/agent artifact label truncates a raw UUID even when it arrives via the cast entry's name field", () => {
  it("truncates a cast entry whose resolved name IS a raw UUID (unnamed connector/agent)", () => {
    const spine = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "88b3da16-d20c-4ff4-95bc-d68033dc2cde",
      row: 0,
      lane: 0,
    });
    const cast: readonly IRunCastEntry[] = [
      {
        kind: "connector",
        id: "88b3da16-d20c-4ff4-95bc-d68033dc2cde",
        name: "88b3da16-d20c-4ff4-95bc-d68033dc2cde",
        count: 1,
      },
    ];
    const boxes = computeArtifactBoxes([spine], cast);
    expect(boxes[0]!.label).toBe("connector · 88b3da16…");
    expect(boxes[0]!.label).not.toContain(
      "88b3da16-d20c-4ff4-95bc-d68033dc2cde"
    );
  });

  it("passes through a friendly cast entry name (e.g. a channel) unchanged", () => {
    const spine = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "chan-1",
      row: 0,
      lane: 0,
    });
    const cast: readonly IRunCastEntry[] = [
      { kind: "connector", id: "chan-1", name: "http-generic", count: 1 },
    ];
    const boxes = computeArtifactBoxes([spine], cast);
    expect(boxes[0]!.label).toBe("connector · http-generic");
  });

  it("still truncates the raw instanceId fallback when there is no cast match (existing behavior preserved)", () => {
    const spine = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "d021a4ce-9112-4835-a1fa-74aedd2d2133",
      row: 0,
      lane: 0,
    });
    const boxes = computeArtifactBoxes([spine], []);
    expect(boxes[0]!.label).toBe("connector · d021a4ce…");
  });
});
