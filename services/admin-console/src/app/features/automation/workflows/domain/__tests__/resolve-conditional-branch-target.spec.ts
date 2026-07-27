import { resolveConditionalBranchTarget } from "../resolve-conditional-branch-target";
import type {
  IWorkflowConnection,
  IWorkflowNode,
} from "../workflow-node.types";
import { EWorkflowConnectionType } from "../workflow-node.types";

function conn(
  key: string,
  source: string,
  target: string,
  label?: string
): IWorkflowConnection {
  return { key, source, target, type: EWorkflowConnectionType.DEFAULT, label };
}

function node(key: string, name: string): IWorkflowNode {
  return {
    key,
    name,
    type: "jsFunction" as IWorkflowNode["type"],
    icon: "code",
    position: { x: 0, y: 0 },
    configuration: {},
  };
}

describe("resolveConditionalBranchTarget", () => {
  it("resolves the target node for a matching labeled connection", () => {
    const nodesByKey = { target1: node("target1", "buildEscalationReply") };
    const connections = [
      conn("c1", "if1", "target1", 'results.buildAgentContext.tier eq "vip"'),
    ];
    const result = resolveConditionalBranchTarget(
      "if1",
      'results.buildAgentContext.tier eq "vip"',
      connections,
      nodesByKey
    );
    expect(result?.node.name).toBe("buildEscalationReply");
    expect(result?.connectionKey).toBe("c1");
  });

  it("resolves the default branch's target via the literal 'default' label", () => {
    const nodesByKey = { target2: node("target2", "replyStandard") };
    const connections = [conn("c2", "if1", "target2", "default")];
    const result = resolveConditionalBranchTarget(
      "if1",
      "default",
      connections,
      nodesByKey
    );
    expect(result?.node.name).toBe("replyStandard");
  });

  it("returns null when the branch has no expected label (empty condition)", () => {
    const result = resolveConditionalBranchTarget(
      "if1",
      undefined,
      [conn("c1", "if1", "target1", "x")],
      { target1: node("target1", "n") }
    );
    expect(result).toBeNull();
  });

  it("returns null when no connection matches (empty-path branch never linked)", () => {
    const result = resolveConditionalBranchTarget(
      "if1",
      'results.foo eq "bar"',
      [conn("c1", "if1", "target1", "other")],
      { target1: node("target1", "n") }
    );
    expect(result).toBeNull();
  });

  it("skips connections already claimed by a sibling branch (duplicate-label edge case)", () => {
    const nodesByKey = {
      t1: node("t1", "first"),
      t2: node("t2", "second"),
    };
    const connections = [
      conn("c1", "if1", "t1", "same label"),
      conn("c2", "if1", "t2", "same label"),
    ];
    const result = resolveConditionalBranchTarget(
      "if1",
      "same label",
      connections,
      nodesByKey,
      new Set(["c1"])
    );
    expect(result?.connectionKey).toBe("c2");
  });
});
