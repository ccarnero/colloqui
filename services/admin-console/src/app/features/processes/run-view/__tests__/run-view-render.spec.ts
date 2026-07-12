import { describe, expect, it } from "vitest";
import type { ILayoutEdge, ILayoutNode } from "../domain/run-view.model";
import {
  computeRenderedEdges,
  formatPillLabel,
  type IPositionedNode,
  isPillNode,
  NODE_HEIGHT,
  NODE_WIDTH,
  nodePosition,
  nodeVisualHeight,
  PILL_HEIGHT,
  PILL_WIDTH,
  pillOffsetX,
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
