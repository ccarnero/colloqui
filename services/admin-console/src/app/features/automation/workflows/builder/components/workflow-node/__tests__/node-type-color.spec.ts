import { describe, expect, it } from "vitest";
import { EWorkflowNodeType } from "../../../../domain/workflow-node.types";
import {
  isKnownNodeTypeColor,
  NODE_TYPE_COLOR_FALLBACK_TOKEN,
  nodeTypeColorToken,
} from "../node-type-color";

/**
 * T04 — port/accent color mapping (SPEC decision 4, AMENDED). Table-driven
 * over every `EWorkflowNodeType` value + an unknown-string fallback case.
 */
describe("nodeTypeColorToken", () => {
  const expected: Record<EWorkflowNodeType, string> = {
    [EWorkflowNodeType.CHANNEL]: "var(--rd-green)",
    [EWorkflowNodeType.CONDITIONAL]: "var(--rd-yellow)",
    [EWorkflowNodeType.AGENT_CALL]: "var(--rd-purple)",
    [EWorkflowNodeType.JS_FUNCTION]: NODE_TYPE_COLOR_FALLBACK_TOKEN,
    [EWorkflowNodeType.ENDPOINT_CALL]: NODE_TYPE_COLOR_FALLBACK_TOKEN,
    [EWorkflowNodeType.MCP_CALL]: NODE_TYPE_COLOR_FALLBACK_TOKEN,
    [EWorkflowNodeType.SERVICE_CALL]: NODE_TYPE_COLOR_FALLBACK_TOKEN,
    [EWorkflowNodeType.SERVICE_BUS_CALL]: NODE_TYPE_COLOR_FALLBACK_TOKEN,
    [EWorkflowNodeType.BRANCH]: NODE_TYPE_COLOR_FALLBACK_TOKEN,
  };

  for (const [type, color] of Object.entries(expected)) {
    it(`maps ${type} to ${color}`, () => {
      expect(nodeTypeColorToken(type)).toBe(color);
    });
  }

  it("falls back to the neutral token for an unknown type string", () => {
    expect(nodeTypeColorToken("totallyUnknownType")).toBe(
      NODE_TYPE_COLOR_FALLBACK_TOKEN
    );
  });

  it("reports known types via isKnownNodeTypeColor", () => {
    expect(isKnownNodeTypeColor(EWorkflowNodeType.CHANNEL)).toBe(true);
    expect(isKnownNodeTypeColor(EWorkflowNodeType.CONDITIONAL)).toBe(true);
    expect(isKnownNodeTypeColor(EWorkflowNodeType.AGENT_CALL)).toBe(true);
  });

  it("reports the rest of the enum + unknown strings as not known", () => {
    expect(isKnownNodeTypeColor(EWorkflowNodeType.JS_FUNCTION)).toBe(false);
    expect(isKnownNodeTypeColor(EWorkflowNodeType.BRANCH)).toBe(false);
    expect(isKnownNodeTypeColor("totallyUnknownType")).toBe(false);
  });
});
