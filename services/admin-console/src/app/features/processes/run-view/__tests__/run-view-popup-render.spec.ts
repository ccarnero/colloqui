import { describe, expect, it } from "vitest";
import type { ILayoutNode } from "../domain/run-view.model";
import {
  agentDeepLink,
  channelDeepLink,
  computeAnchorPosition,
  connectorDeepLink,
  formatPopupStatusLabel,
  resolvePeekKind,
  workflowDeepLink,
} from "../run-view-popup-render";

function node(overrides: Partial<ILayoutNode>): ILayoutNode {
  return {
    id: "root::0",
    kind: "action",
    color: "platform",
    label: "1 · endpointCall → order-api",
    status: "ok",
    row: 0,
    lane: 0,
    nestingDepth: 0,
    durationMs: 120,
    dashed: false,
    instanceId: "order-api",
    evaluatedValue: null,
    branchTaken: null,
    actionType: "endpointCall",
    stepName: "callOrderApi",
    conditionEventId: null,
    ...overrides,
  };
}

describe("resolvePeekKind", () => {
  it("resolves connector for endpointCall/mcpCall/serviceCall action types", () => {
    expect(resolvePeekKind(node({ actionType: "endpointCall" }))).toBe(
      "connector"
    );
    expect(resolvePeekKind(node({ actionType: "mcpCall" }))).toBe("connector");
    expect(resolvePeekKind(node({ actionType: "serviceCall" }))).toBe(
      "connector"
    );
  });

  it("resolves agent for agentCall", () => {
    expect(
      resolvePeekKind(node({ actionType: "agentCall", instanceId: "agent-1" }))
    ).toBe("agent");
  });

  it("resolves channel for channelSend", () => {
    expect(
      resolvePeekKind(node({ actionType: "channelSend", instanceId: "acct-1" }))
    ).toBe("channel");
  });

  it("returns null when the node has no instanceId", () => {
    expect(
      resolvePeekKind(node({ actionType: "jsFunction", instanceId: null }))
    ).toBeNull();
  });

  it("returns null for structural nodes (fork/conditional/join)", () => {
    expect(
      resolvePeekKind(
        node({ kind: "join", actionType: null, instanceId: null })
      )
    ).toBeNull();
  });
});

describe("formatPopupStatusLabel", () => {
  it("renders not_executed as 'not executed'", () => {
    expect(formatPopupStatusLabel("not_executed")).toBe("not executed");
  });

  it("passes ok/failed through unchanged", () => {
    expect(formatPopupStatusLabel("ok")).toBe("ok");
    expect(formatPopupStatusLabel("failed")).toBe("failed");
  });
});

describe("computeAnchorPosition", () => {
  const viewport = { width: 1200, height: 800 };
  const popupSize = { width: 360, height: 400 };

  it("anchors to the right when the node is on the left half", () => {
    const rect = {
      top: 100,
      left: 50,
      right: 250,
      bottom: 140,
      width: 200,
      height: 40,
    };
    const pos = computeAnchorPosition(rect, viewport, popupSize);
    expect(pos.side).toBe("right");
    expect(pos.left).toBe(262); // right + gap(12)
  });

  it("anchors to the left when the node is on the right half with no room", () => {
    const rect = {
      top: 100,
      left: 950,
      right: 1150,
      bottom: 140,
      width: 200,
      height: 40,
    };
    const pos = computeAnchorPosition(rect, viewport, popupSize);
    expect(pos.side).toBe("left");
    expect(pos.left).toBe(950 - 360 - 12);
  });

  it("clamps left within the viewport when the popup would overflow", () => {
    const rect = {
      top: 100,
      left: 1190,
      right: 1195,
      bottom: 140,
      width: 5,
      height: 40,
    };
    const pos = computeAnchorPosition(rect, viewport, popupSize);
    expect(pos.left).toBeGreaterThanOrEqual(8);
    expect(pos.left + popupSize.width).toBeLessThanOrEqual(viewport.width);
  });

  it("clamps top within the viewport when the node is near the bottom", () => {
    const rect = {
      top: 780,
      left: 50,
      right: 250,
      bottom: 820,
      width: 200,
      height: 40,
    };
    const pos = computeAnchorPosition(rect, viewport, popupSize);
    expect(pos.top + popupSize.height).toBeLessThanOrEqual(viewport.height);
  });

  it("produces a valid on-screen position for a degenerate all-zero rect", () => {
    const rect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
    const pos = computeAnchorPosition(rect, viewport, popupSize);
    expect(pos.left).toBeGreaterThanOrEqual(0);
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.left + popupSize.width).toBeLessThanOrEqual(viewport.width);
  });
});

describe("deep links", () => {
  it("builds the connector detail route", () => {
    expect(connectorDeepLink("order-api")).toEqual([
      "/connections/http",
      "order-api",
    ]);
  });

  it("builds the agent detail route", () => {
    expect(agentDeepLink("agent-1")).toEqual(["/ai/agents", "agent-1"]);
  });

  it("builds the channel account route", () => {
    expect(channelDeepLink("whatsapp", "acct-1")).toEqual([
      "/channels",
      "whatsapp",
      "accounts",
      "acct-1",
    ]);
  });

  it("builds the workflow builder route", () => {
    expect(workflowDeepLink("wf-1")).toEqual(["/workflows", "wf-1", "builder"]);
  });
});
