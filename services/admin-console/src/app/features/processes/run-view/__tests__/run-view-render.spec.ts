import { describe, expect, it } from "vitest";
import type { IRunCastEntry } from "../../../../core/services/run-view.service";
import type { ILayoutEdge, ILayoutNode } from "../domain/run-view.model";
import {
  ARTIFACT_BOX_WIDTH,
  computeArtifactBoxes,
  computeArtifactColumnX,
  computeArtifactEdges,
  computeContentWidth,
  computeRenderedEdges,
  formatPillLabel,
  type IPositionedNode,
  isArtifactNode,
  isNestedArtifactNode,
  isPillNode,
  isSpineArtifactNode,
  isUuidLike,
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
  it("produces a box for a spine-level (nestingDepth 0, lane 0) connector node", () => {
    const spine = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 0,
    });
    const boxes = computeArtifactBoxes([spine], cast);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.stepId).toBe("n1");
  });

  it("produces NO box for a fork-lane (lane > 0) connector/agent node", () => {
    const laneNode = positioned({
      id: "n1",
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 1,
    });
    expect(computeArtifactBoxes([laneNode], cast)).toHaveLength(0);
  });

  it("produces NO box for a nested (nestingDepth > 0) condition-branch agent node", () => {
    const nestedNode = positioned({
      id: "n1",
      actionType: "agentCall",
      instanceId: "agent-1",
      nestingDepth: 1,
      lane: 0,
    });
    expect(computeArtifactBoxes([nestedNode], cast)).toHaveLength(0);
  });
});

describe("nodeSubLabel — spine unchanged, nested artifact steps get an inline collapsed chip", () => {
  it("a spine node (non-artifact or lane 0/nestingDepth 0) keeps the plain status/duration sub-label", () => {
    const spine = node({
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 0,
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
      status: "ok",
      durationMs: 50,
    });
    expect(nodeSubLabel(nested)).toBe("ok · 50ms");
  });

  it("a fork-lane connector node (lane > 0) gets the '↔ <kind> · <ms>ms · <status>' inline chip", () => {
    const laneNode = node({
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 1,
      status: "ok",
      durationMs: 356,
    });
    expect(nodeSubLabel(laneNode)).toBe("↔ connector · 356ms · ok");
  });

  it("a condition-branch agent node (nestingDepth > 0) gets the inline chip too", () => {
    const branchNode = node({
      actionType: "agentCall",
      instanceId: "agent-1",
      nestingDepth: 1,
      lane: 0,
      status: "ok",
      durationMs: 412,
    });
    expect(nodeSubLabel(branchNode)).toBe("↔ agent · 412ms · ok");
  });
});

describe("isSpineArtifactNode / isNestedArtifactNode", () => {
  it("a spine artifact node (nestingDepth 0, lane 0) is spine, not nested", () => {
    const spine = node({
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 0,
    });
    expect(isSpineArtifactNode(spine)).toBe(true);
    expect(isNestedArtifactNode(spine)).toBe(false);
  });

  it("a fork-lane artifact node (lane > 0) is nested, not spine", () => {
    const laneNode = node({
      actionType: "endpointCall",
      instanceId: "conn-1",
      nestingDepth: 0,
      lane: 2,
    });
    expect(isSpineArtifactNode(laneNode)).toBe(false);
    expect(isNestedArtifactNode(laneNode)).toBe(true);
  });

  it("a condition-branch artifact node (nestingDepth > 0) is nested, not spine", () => {
    const branchNode = node({
      actionType: "channelSend",
      instanceId: null,
      nestingDepth: 1,
      lane: 0,
    });
    expect(isSpineArtifactNode(branchNode)).toBe(false);
    expect(isNestedArtifactNode(branchNode)).toBe(true);
  });

  it("a non-artifact node is neither spine nor nested regardless of position", () => {
    const plain = node({ actionType: "jsFunction", nestingDepth: 1, lane: 2 });
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
    });
    const lane2 = positioned({
      id: "getPokemon",
      actionType: "endpointCall",
      instanceId: "conn-get-pokemon",
      row: 1,
      lane: 2,
    });
    const lane3 = positioned({
      id: "getCatFact",
      actionType: "endpointCall",
      instanceId: "conn-get-catfact",
      row: 1,
      lane: 3,
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
