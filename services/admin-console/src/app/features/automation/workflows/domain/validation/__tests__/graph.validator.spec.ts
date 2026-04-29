import {
  EWorkflowConnectionType,
  EWorkflowNodeType,
  type IWorkflowConnection,
  type IWorkflowFlow,
  type IWorkflowNode,
} from "../../workflow-node.types";
import { validateGraph } from "../graph.validator";

function makeNode(
  key: string,
  type: EWorkflowNodeType,
  configuration: Record<string, unknown> = {},
): IWorkflowNode {
  return {
    key,
    type,
    name: key,
    icon: "",
    position: { x: 0, y: 0 },
    configuration,
  };
}

function makeConn(
  key: string,
  source: string,
  target: string,
): IWorkflowConnection {
  return {
    key,
    source,
    target,
    type: EWorkflowConnectionType.DEFAULT,
  };
}

function makeFlow(
  nodes: IWorkflowNode[],
  conns: IWorkflowConnection[] = [],
): IWorkflowFlow {
  return {
    key: "wf",
    name: "wf",
    application: "default",
    nodes: Object.fromEntries(nodes.map((n) => [n.key, n])),
    connections: Object.fromEntries(conns.map((c) => [c.key, c])),
  };
}

describe("validateGraph — empty flow", () => {
  it("returns no errors for an empty graph", () => {
    expect(validateGraph(makeFlow([])).length).toBe(0);
  });
});

describe("validateGraph — inbound trigger uniqueness", () => {
  it("accepts a single inbound channel", () => {
    const nodes = [
      makeNode("a", EWorkflowNodeType.CHANNEL, { direction: "inbound" }),
    ];
    expect(validateGraph(makeFlow(nodes)).length).toBe(0);
  });

  it("rejects more than one inbound channel", () => {
    const nodes = [
      makeNode("a", EWorkflowNodeType.CHANNEL, { direction: "inbound" }),
      makeNode("b", EWorkflowNodeType.CHANNEL, { direction: "inbound" }),
    ];
    const errors = validateGraph(makeFlow(nodes));
    expect(errors.some((e) => e.code === "MULTIPLE_TRIGGERS")).toBe(true);
  });
});

describe("validateGraph — orphan nodes", () => {
  it("flags a node with no incoming connection that is not the trigger", () => {
    const nodes = [
      makeNode("trigger", EWorkflowNodeType.CHANNEL, { direction: "inbound" }),
      makeNode("orphan", EWorkflowNodeType.JS_FUNCTION),
    ];
    const errors = validateGraph(makeFlow(nodes));
    expect(errors.some((e) => e.code === "ORPHAN_NODE")).toBe(true);
  });

  it("does not flag an orphan in a single-node flow", () => {
    const nodes = [makeNode("solo", EWorkflowNodeType.JS_FUNCTION)];
    const errors = validateGraph(makeFlow(nodes));
    expect(errors.some((e) => e.code === "ORPHAN_NODE")).toBe(false);
  });

  it("does not flag a node with an incoming connection", () => {
    const nodes = [
      makeNode("trigger", EWorkflowNodeType.CHANNEL, { direction: "inbound" }),
      makeNode("step", EWorkflowNodeType.JS_FUNCTION),
    ];
    const conns = [makeConn("c1", "trigger", "step")];
    const errors = validateGraph(makeFlow(nodes, conns));
    expect(errors.some((e) => e.code === "ORPHAN_NODE")).toBe(false);
  });
});

describe("validateGraph — invalid connections", () => {
  it("flags connections with unknown source/target", () => {
    const nodes = [makeNode("a", EWorkflowNodeType.JS_FUNCTION)];
    const conns = [makeConn("c1", "a", "ghost")];
    const errors = validateGraph(makeFlow(nodes, conns));
    expect(
      errors.filter((e) => e.code === "INVALID_CONNECTION").length,
    ).toBe(1);
  });
});

describe("validateGraph — cycles", () => {
  it("detects a simple A → B → A cycle", () => {
    const nodes = [
      makeNode("a", EWorkflowNodeType.JS_FUNCTION),
      makeNode("b", EWorkflowNodeType.JS_FUNCTION),
    ];
    const conns = [makeConn("c1", "a", "b"), makeConn("c2", "b", "a")];
    const errors = validateGraph(makeFlow(nodes, conns));
    expect(errors.some((e) => e.code === "CYCLE_DETECTED")).toBe(true);
  });

  it("does not flag DAGs", () => {
    const nodes = [
      makeNode("a", EWorkflowNodeType.JS_FUNCTION),
      makeNode("b", EWorkflowNodeType.JS_FUNCTION),
      makeNode("c", EWorkflowNodeType.JS_FUNCTION),
    ];
    const conns = [makeConn("c1", "a", "b"), makeConn("c2", "b", "c")];
    const errors = validateGraph(makeFlow(nodes, conns));
    expect(errors.some((e) => e.code === "CYCLE_DETECTED")).toBe(false);
  });
});
