import { describe, expect, it } from "vitest";
import {
  EWorkflowConnectionType,
  type IWorkflowConnection,
} from "../../domain/workflow-node.types";
import { resolveEdgeVisualState } from "../resolve-edge-visual-state";

function baseConnection(
  overrides: Partial<IWorkflowConnection> = {}
): IWorkflowConnection {
  return {
    key: "conn-1",
    source: "node-a",
    target: "node-b",
    type: EWorkflowConnectionType.DEFAULT,
    ...overrides,
  };
}

describe("resolveEdgeVisualState (SPEC T04)", () => {
  it("classifies an unlabelled linear edge as active", () => {
    expect(resolveEdgeVisualState(baseConnection())).toBe("active");
  });

  it("classifies a labelled matched-condition edge as active", () => {
    const conn = baseConnection({ label: 'request.text contains "precio"' });
    expect(resolveEdgeVisualState(conn)).toBe("active");
  });

  it("classifies a labelled branch path edge as active", () => {
    const conn = baseConnection({ label: "jsonplaceholder" });
    expect(resolveEdgeVisualState(conn)).toBe("active");
  });

  it("classifies the literal 'default' path edge as default", () => {
    const conn = baseConnection({ label: "default" });
    expect(resolveEdgeVisualState(conn)).toBe("default");
  });
});
