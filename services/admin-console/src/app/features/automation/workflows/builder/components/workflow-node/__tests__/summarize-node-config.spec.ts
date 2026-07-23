import { describe, expect, it } from "vitest";
import {
  EWorkflowNodeType,
  type IWorkflowNode,
} from "../../../../domain/workflow-node.types";
import { summarizeNodeConfig } from "../summarize-node-config";

function makeNode(
  type: EWorkflowNodeType,
  configuration: Record<string, unknown>
): IWorkflowNode {
  return {
    key: "node-1",
    type,
    name: "Node",
    icon: "swap_horiz",
    position: { x: 0, y: 0 },
    configuration,
  };
}

/**
 * T03 — one-line mono config summary, derived purely from EXISTING
 * per-type configuration fields (nothing invented). Table-driven per
 * EWorkflowNodeType, plus the empty case for each.
 */
describe("summarizeNodeConfig", () => {
  it("channel (inbound): direction + listened channels", () => {
    const node = makeNode(EWorkflowNodeType.CHANNEL, {
      direction: "inbound",
      channels: ["whatsapp", "telegram"],
    });
    expect(summarizeNodeConfig(node)).toBe("inbound · whatsapp, telegram");
  });

  it("channel (outbound): direction + single channel", () => {
    const node = makeNode(EWorkflowNodeType.CHANNEL, {
      direction: "outbound",
      channel: "whatsapp",
    });
    expect(summarizeNodeConfig(node)).toBe("outbound · whatsapp");
  });

  it("channel: empty when no direction/channel data", () => {
    const node = makeNode(EWorkflowNodeType.CHANNEL, {});
    expect(summarizeNodeConfig(node)).toBe("");
  });

  it("jsFunction: extracted fn name + line count", () => {
    const node = makeNode(EWorkflowNodeType.JS_FUNCTION, {
      code: "function computeTotal(x) {\n  return x * 2;\n}",
    });
    expect(summarizeNodeConfig(node)).toBe("computeTotal() · 3 lines");
  });

  it("jsFunction: falls back to 'fn' when no named function is found", () => {
    const node = makeNode(EWorkflowNodeType.JS_FUNCTION, {
      code: "return 1;",
    });
    expect(summarizeNodeConfig(node)).toBe("fn() · 1 line");
  });

  it("jsFunction: empty when code is blank", () => {
    const node = makeNode(EWorkflowNodeType.JS_FUNCTION, { code: "" });
    expect(summarizeNodeConfig(node)).toBe("");
  });

  it("endpointCall (httpCall): method + url host", () => {
    const node = makeNode(EWorkflowNodeType.ENDPOINT_CALL, {
      method: "GET",
      url: "https://api.example.com/user",
    });
    expect(summarizeNodeConfig(node)).toBe("GET · api.example.com");
  });

  it("endpointCall: falls back to the raw url when it isn't a parseable absolute URL", () => {
    const node = makeNode(EWorkflowNodeType.ENDPOINT_CALL, {
      method: "POST",
      url: "{{results['prev'].data.url}}",
    });
    expect(summarizeNodeConfig(node)).toBe(
      "POST · {{results['prev'].data.url}}"
    );
  });

  it("endpointCall: empty when neither method nor url is set", () => {
    const node = makeNode(EWorkflowNodeType.ENDPOINT_CALL, {
      method: "",
      url: "",
    });
    expect(summarizeNodeConfig(node)).toBe("");
  });

  it("mcpCall: serverId + toolName", () => {
    const node = makeNode(EWorkflowNodeType.MCP_CALL, {
      serverId: "srv-1",
      toolName: "lookup",
    });
    expect(summarizeNodeConfig(node)).toBe("srv-1 · lookup");
  });

  it("mcpCall: empty when both fields are blank", () => {
    const node = makeNode(EWorkflowNodeType.MCP_CALL, {
      serverId: "",
      toolName: "",
    });
    expect(summarizeNodeConfig(node)).toBe("");
  });

  it("serviceCall: method + path once a service is chosen", () => {
    const node = makeNode(EWorkflowNodeType.SERVICE_CALL, {
      serviceId: "svc-1",
      method: "POST",
      path: "/lookup",
    });
    expect(summarizeNodeConfig(node)).toBe("POST · /lookup");
  });

  it("serviceCall: empty when no service is chosen yet (fresh default node)", () => {
    const node = makeNode(EWorkflowNodeType.SERVICE_CALL, {
      serviceId: "",
      method: "GET",
      path: "/",
    });
    expect(summarizeNodeConfig(node)).toBe("");
  });

  it("serviceBusCall: subject", () => {
    const node = makeNode(EWorkflowNodeType.SERVICE_BUS_CALL, {
      subject: "events.test",
    });
    expect(summarizeNodeConfig(node)).toBe("events.test");
  });

  it("serviceBusCall: empty when subject is blank", () => {
    const node = makeNode(EWorkflowNodeType.SERVICE_BUS_CALL, { subject: "" });
    expect(summarizeNodeConfig(node)).toBe("");
  });

  it("agentCall: agent id", () => {
    const node = makeNode(EWorkflowNodeType.AGENT_CALL, {
      agentId: "agent-1",
    });
    expect(summarizeNodeConfig(node)).toBe("agent-1");
  });

  it("agentCall: empty when no agent is chosen", () => {
    const node = makeNode(EWorkflowNodeType.AGENT_CALL, { agentId: "" });
    expect(summarizeNodeConfig(node)).toBe("");
  });

  it("branch: path count", () => {
    const node = makeNode(EWorkflowNodeType.BRANCH, {
      branches: ["pathA", "pathB"],
    });
    expect(summarizeNodeConfig(node)).toBe("2 paths");
  });

  it("branch: empty when no branches are configured", () => {
    const node = makeNode(EWorkflowNodeType.BRANCH, { branches: [] });
    expect(summarizeNodeConfig(node)).toBe("");
  });

  it("conditional: first branch's expression, truncated", () => {
    const node = makeNode(EWorkflowNodeType.CONDITIONAL, {
      branches: [
        {
          label: "vip",
          condition: { variable: "user.tier", comparator: "eq", value: "vip" },
        },
      ],
    });
    expect(summarizeNodeConfig(node)).toBe("user.tier eq vip");
  });

  it("conditional: appends a '+N more' suffix for additional branches", () => {
    const node = makeNode(EWorkflowNodeType.CONDITIONAL, {
      branches: [
        {
          label: "vip",
          condition: { variable: "user.tier", comparator: "eq", value: "vip" },
        },
        {
          label: "regular",
          condition: { variable: "user.tier", comparator: "eq", value: "reg" },
        },
      ],
    });
    expect(summarizeNodeConfig(node)).toBe("user.tier eq vip +1 more");
  });

  it("conditional: truncates a long expression with an ellipsis", () => {
    const node = makeNode(EWorkflowNodeType.CONDITIONAL, {
      branches: [
        {
          label: "long",
          condition: {
            variable: "some.very.long.nested.request.variable.path",
            comparator: "contains",
            value: "a-fairly-long-comparison-value",
          },
        },
      ],
    });
    const result = summarizeNodeConfig(node);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result.endsWith("…")).toBe(true);
  });

  it("conditional: empty when no branches are configured", () => {
    const node = makeNode(EWorkflowNodeType.CONDITIONAL, { branches: [] });
    expect(summarizeNodeConfig(node)).toBe("");
  });
});
