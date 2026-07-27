import { findAmbiguousBranchEvidenceKeys } from "../find-ambiguous-branch-evidence-keys";
import {
  EWorkflowConnectionType,
  EWorkflowNodeType,
  type IWorkflowConnection,
  type IWorkflowNode,
} from "../workflow-node.types";

function conditionalNode(
  key: string,
  name: string,
  branches: Array<{
    label: string;
    variable: string;
    comparator: string;
    value: string;
  }>,
  hasDefault: boolean
): IWorkflowNode {
  return {
    key,
    name,
    type: EWorkflowNodeType.CONDITIONAL,
    icon: "alt_route",
    position: { x: 0, y: 0 },
    configuration: {
      branches: branches.map((b) => ({
        label: b.label,
        condition: {
          variable: b.variable,
          comparator: b.comparator,
          value: b.value,
        },
      })),
      ...(hasDefault ? { default: { targetKey: "" } } : {}),
    },
  };
}

function plainNode(key: string, name: string): IWorkflowNode {
  return {
    key,
    name,
    type: EWorkflowNodeType.JS_FUNCTION,
    icon: "code",
    position: { x: 0, y: 0 },
    configuration: {},
  };
}

function conn(
  key: string,
  source: string,
  target: string,
  label: string
): IWorkflowConnection {
  return { key, source, target, type: EWorkflowConnectionType.DEFAULT, label };
}

describe("findAmbiguousBranchEvidenceKeys", () => {
  it("returns an empty set when only one conditional node routes to each target", () => {
    const nodeA = conditionalNode(
      "if1",
      "vipRoute",
      [
        {
          label: "VIP escalation",
          variable: "results.tier",
          comparator: "eq",
          value: "vip",
        },
      ],
      true
    );
    const target1 = plainNode("t1", "buildEscalationReply");
    const target2 = plainNode("t2", "replyStandard");
    const connections = [
      conn("c1", "if1", "t1", 'results.tier eq "vip"'),
      conn("c2", "if1", "t2", "default"),
    ];
    const result = findAmbiguousBranchEvidenceKeys(
      [nodeA, target1, target2],
      connections
    );
    expect(result.size).toBe(0);
  });

  it("cross-node collision: two different conditional nodes both routing a default branch to the SAME target action are flagged ambiguous", () => {
    const ifA = conditionalNode("ifA", "vipRoute", [], true);
    const ifB = conditionalNode("ifB", "vatRoute", [], true);
    const sharedTarget = plainNode("shared", "replyStandard");
    const connections = [
      conn("c1", "ifA", "shared", "default"),
      conn("c2", "ifB", "shared", "default"),
    ];
    const result = findAmbiguousBranchEvidenceKeys(
      [ifA, ifB, sharedTarget],
      connections
    );
    expect(result.has("replyStandard::default")).toBe(true);
  });

  it("two conditional nodes routing DIFFERENT labels to the same target are NOT ambiguous (different join key)", () => {
    const ifA = conditionalNode(
      "ifA",
      "nodeA",
      [{ label: "caseA", variable: "results.x", comparator: "eq", value: "a" }],
      false
    );
    const ifB = conditionalNode(
      "ifB",
      "nodeB",
      [{ label: "caseB", variable: "results.y", comparator: "eq", value: "b" }],
      false
    );
    const sharedTarget = plainNode("shared", "replyStandard");
    const connections = [
      conn("c1", "ifA", "shared", 'results.x eq "a"'),
      conn("c2", "ifB", "shared", 'results.y eq "b"'),
    ];
    const result = findAmbiguousBranchEvidenceKeys(
      [ifA, ifB, sharedTarget],
      connections
    );
    expect(result.size).toBe(0);
  });

  it("ignores non-conditional nodes entirely", () => {
    const linear = plainNode("n1", "Fetch");
    const result = findAmbiguousBranchEvidenceKeys([linear], []);
    expect(result.size).toBe(0);
  });

  it("ignores branches with an empty condition (no route to resolve)", () => {
    const ifA = conditionalNode(
      "ifA",
      "vipRoute",
      [{ label: "empty", variable: "", comparator: "eq", value: "" }],
      false
    );
    const result = findAmbiguousBranchEvidenceKeys([ifA], []);
    expect(result.size).toBe(0);
  });
});
