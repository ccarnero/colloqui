import { describe, expect, it } from "vitest";
import {
  EWorkflowConnectionType,
  type IWorkflowConnection,
} from "../../domain/workflow-node.types";
import { resolveEdgeLabel } from "../resolve-edge-label";

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

describe("resolveEdgeLabel (SPEC T04)", () => {
  it("returns the connection's real label text for a labelled edge", () => {
    const conn = baseConnection({ label: 'request.text contains "precio"' });
    expect(resolveEdgeLabel(conn)).toBe('request.text contains "precio"');
  });

  it("returns the literal 'default' label for a conditional's default/fallback path edge", () => {
    const conn = baseConnection({ label: "default" });
    expect(resolveEdgeLabel(conn)).toBe("default");
  });

  it("returns a branch path label for a branch fan-out edge", () => {
    const conn = baseConnection({ label: "jsonplaceholder" });
    expect(resolveEdgeLabel(conn)).toBe("jsonplaceholder");
  });

  it("returns an empty string for an unlabelled edge, never fabricating one", () => {
    const conn = baseConnection();
    expect(resolveEdgeLabel(conn)).toBe("");
  });
});
