import {
  EWorkflowConnectionType,
  EWorkflowNodeType,
  type IWorkflowConnection,
  type IWorkflowFlow,
  type IWorkflowNode,
} from "../../workflow-node.types";
import { validateWorkflow } from "../workflow.validator";
import { SOURCE_ACCOUNT_TEMPLATE } from "../../workflow-node-defaults";

function makeNode(
  key: string,
  type: EWorkflowNodeType,
  configuration: Record<string, unknown> = {},
  name = key,
): IWorkflowNode {
  return {
    key,
    type,
    name,
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
  overrides: Partial<IWorkflowFlow> = {},
): IWorkflowFlow {
  return {
    key: "wf",
    name: "Test Workflow",
    application: "default",
    nodes: Object.fromEntries(nodes.map((n) => [n.key, n])),
    connections: Object.fromEntries(conns.map((c) => [c.key, c])),
    ...overrides,
  };
}

describe("validateWorkflow — top-level", () => {
  it("requires non-empty name", () => {
    const flow = makeFlow(
      [makeNode("a", EWorkflowNodeType.JS_FUNCTION, { code: "1" })],
      [],
      { name: "" },
    );
    const result = validateWorkflow(flow);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.field === "name" && e.code === "REQUIRED"),
    ).toBe(true);
  });

  it("requires non-empty application", () => {
    const flow = makeFlow(
      [makeNode("a", EWorkflowNodeType.JS_FUNCTION, { code: "1" })],
      [],
      { application: "" },
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) => e.field === "application" && e.code === "REQUIRED",
      ),
    ).toBe(true);
  });

  it("rejects names longer than 128 chars", () => {
    const flow = makeFlow(
      [makeNode("a", EWorkflowNodeType.JS_FUNCTION, { code: "1" })],
      [],
      { name: "x".repeat(200) },
    );
    expect(
      validateWorkflow(flow).errors.some((e) => e.code === "TOO_LONG"),
    ).toBe(true);
  });
});

describe("validateWorkflow — empty actions", () => {
  it("flags EMPTY_ACTIONS when only the inbound trigger exists", () => {
    const flow = makeFlow([
      makeNode("t", EWorkflowNodeType.CHANNEL, {
        direction: "inbound",
        mode: "shared",
      }),
    ]);
    const result = validateWorkflow(flow);
    expect(result.errors.some((e) => e.code === "EMPTY_ACTIONS")).toBe(true);
  });

  it("flags EMPTY_ACTIONS when the flow has no nodes", () => {
    const flow = makeFlow([]);
    const result = validateWorkflow(flow);
    expect(result.errors.some((e) => e.code === "EMPTY_ACTIONS")).toBe(true);
  });
});

describe("validateWorkflow — endpointCall modes", () => {
  it("URL ad-hoc mode flags missing method/url and ties errors to the node", () => {
    const flow = makeFlow([
      makeNode("ep", EWorkflowNodeType.ENDPOINT_CALL, {}, "HTTP Step"),
    ]);
    const result = validateWorkflow(flow);
    const epErrors = result.errors.filter((e) => e.nodeKey === "ep");
    expect(epErrors.some((e) => e.field === "args.method")).toBe(true);
    expect(epErrors.some((e) => e.field === "args.url")).toBe(true);
    expect(epErrors[0].nodeName).toBe("HTTP Step");
  });

  it("adapter mode requires only endpointId", () => {
    const flow = makeFlow([
      makeNode("ep", EWorkflowNodeType.ENDPOINT_CALL, {
        adapterId: "ad-1",
      }),
    ]);
    const result = validateWorkflow(flow);
    const epErrors = result.errors.filter((e) => e.nodeKey === "ep");
    expect(epErrors.length).toBe(1);
    expect(epErrors[0].field).toBe("args.endpointId");
  });

  it("adapter mode passes when endpointId is present", () => {
    const flow = makeFlow([
      makeNode("ep", EWorkflowNodeType.ENDPOINT_CALL, {
        adapterId: "ad-1",
        endpointId: "e-1",
      }),
    ]);
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) => e.nodeKey === "ep" && e.code === "REQUIRED",
      ),
    ).toBe(false);
  });
});

describe("validateWorkflow — branch", () => {
  it("flags BRANCH_EMPTY when a branch has no outgoing connections", () => {
    const flow = makeFlow([
      makeNode("br", EWorkflowNodeType.BRANCH, { branches: ["yes"] }),
    ]);
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) => e.nodeKey === "br" && e.code === "BRANCH_EMPTY",
      ),
    ).toBe(true);
  });

  it("does not flag branches with at least one outgoing connection", () => {
    const flow = makeFlow(
      [
        makeNode("br", EWorkflowNodeType.BRANCH, { branches: ["yes"] }),
        makeNode("step", EWorkflowNodeType.JS_FUNCTION, { code: "1" }),
      ],
      [makeConn("c1", "br", "step")],
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) => e.nodeKey === "br" && e.code === "BRANCH_EMPTY",
      ),
    ).toBe(false);
  });
});

describe("validateWorkflow — happy path", () => {
  it("passes for a complete trigger + js function flow", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, {
          direction: "inbound",
          mode: "shared",
          accountIds: ["acc-1"],
        }),
        makeNode("step", EWorkflowNodeType.JS_FUNCTION, {
          code: "return 1;",
        }),
      ],
      [makeConn("c1", "t", "step")],
    );
    const result = validateWorkflow(flow);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("flags missing accountIds on the inbound trigger node", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, {
          direction: "inbound",
          mode: "shared",
        }),
        makeNode("step", EWorkflowNodeType.JS_FUNCTION, { code: "1" }),
      ],
      [makeConn("c1", "t", "step")],
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) =>
          e.nodeKey === "t" &&
          e.field === "trigger.config.accountIds" &&
          e.code === "REQUIRED",
      ),
    ).toBe(true);
  });
});

describe("validateWorkflow — trigger forwarding", () => {
  it("invalid trigger mode is reported on the inbound node", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, {
          direction: "inbound",
          mode: "broadcast",
        }),
        makeNode("step", EWorkflowNodeType.JS_FUNCTION, { code: "1" }),
      ],
      [makeConn("c1", "t", "step")],
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) => e.nodeKey === "t" && e.field === "trigger.mode",
      ),
    ).toBe(true);
  });
});

describe("validateWorkflow — trigger presence", () => {
  it("flags NO_TRIGGER when actions exist but no inbound channel", () => {
    const flow = makeFlow([
      makeNode("step", EWorkflowNodeType.JS_FUNCTION, { code: "1" }),
    ]);
    const result = validateWorkflow(flow);
    expect(result.errors.some((e) => e.code === "NO_TRIGGER")).toBe(true);
  });

  it("does not flag NO_TRIGGER on a fully empty flow", () => {
    const flow = makeFlow([]);
    const result = validateWorkflow(flow);
    expect(result.errors.some((e) => e.code === "NO_TRIGGER")).toBe(false);
    // Empty flows still hit EMPTY_ACTIONS, which is fine.
    expect(result.errors.some((e) => e.code === "EMPTY_ACTIONS")).toBe(true);
  });

  it("flags TRIGGER_DISCONNECTED when inbound has no outgoing edges", () => {
    const flow = makeFlow([
      makeNode("t", EWorkflowNodeType.CHANNEL, {
        direction: "inbound",
        mode: "shared",
      }),
      makeNode("step", EWorkflowNodeType.JS_FUNCTION, { code: "1" }),
    ]);
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) => e.nodeKey === "t" && e.code === "TRIGGER_DISCONNECTED",
      ),
    ).toBe(true);
  });

  it("does not flag TRIGGER_DISCONNECTED when inbound is the only node", () => {
    const flow = makeFlow([
      makeNode("t", EWorkflowNodeType.CHANNEL, {
        direction: "inbound",
        mode: "shared",
      }),
    ]);
    const result = validateWorkflow(flow);
    expect(
      result.errors.some((e) => e.code === "TRIGGER_DISCONNECTED"),
    ).toBe(false);
  });

  it("requires the inbound trigger to declare a mode", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, { direction: "inbound" }),
        makeNode("step", EWorkflowNodeType.JS_FUNCTION, { code: "1" }),
      ],
      [makeConn("c1", "t", "step")],
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) =>
          e.nodeKey === "t" &&
          e.field === "trigger.mode" &&
          e.code === "REQUIRED",
      ),
    ).toBe(true);
  });
});

describe("validateWorkflow — outbound account vs trigger", () => {
  it("flags outbound channel using an account not present on the trigger", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, {
          direction: "inbound",
          mode: "shared",
          accountIds: ["acc-1"],
        }),
        makeNode("out", EWorkflowNodeType.CHANNEL, {
          direction: "outbound",
          accountId: "acc-rogue",
          channel: "whatsapp",
          provider: "meta",
          to: "+1",
          messageType: "text",
        }),
      ],
      [makeConn("c1", "t", "out")],
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) =>
          e.nodeKey === "out" &&
          e.field === "args.accountId" &&
          e.code === "INVALID_VALUE",
      ),
    ).toBe(true);
  });

  it("does not flag outbound when accountId matches the trigger list", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, {
          direction: "inbound",
          mode: "shared",
          accountIds: ["acc-1", "acc-2"],
        }),
        makeNode("out", EWorkflowNodeType.CHANNEL, {
          direction: "outbound",
          accountId: "acc-2",
          channel: "whatsapp",
          provider: "meta",
          to: "+1",
          messageType: "text",
        }),
      ],
      [makeConn("c1", "t", "out")],
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) => e.nodeKey === "out" && e.field === "args.accountId",
      ),
    ).toBe(false);
  });

  it("does not flag the 'same as incoming message' source-account template", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, {
          direction: "inbound",
          mode: "shared",
          accountIds: ["acc-1"],
        }),
        makeNode("out", EWorkflowNodeType.CHANNEL, {
          direction: "outbound",
          accountId: SOURCE_ACCOUNT_TEMPLATE,
          channel: "{{request.channel}}",
          provider: "{{request.provider}}",
          to: "{{request.from}}",
          messageType: "text",
          text: "hi",
        }),
      ],
      [makeConn("c1", "t", "out")],
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) => e.nodeKey === "out" && e.field === "args.accountId",
      ),
    ).toBe(false);
  });

  it("does not double-report when outbound has no accountId at all", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, {
          direction: "inbound",
          mode: "shared",
          accountIds: ["acc-1"],
        }),
        makeNode("out", EWorkflowNodeType.CHANNEL, {
          direction: "outbound",
        }),
      ],
      [makeConn("c1", "t", "out")],
    );
    const result = validateWorkflow(flow);
    const outAccount = result.errors.filter(
      (e) => e.nodeKey === "out" && e.field === "args.accountId",
    );
    // Only the REQUIRED error from validateChannelSend, not the
    // mismatch error on top of it.
    expect(outAccount.length).toBe(1);
    expect(outAccount[0].code).toBe("REQUIRED");
  });
});

describe("validateWorkflow — channel direction", () => {
  it("flags non-inbound CHANNEL nodes that have no direction", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, {
          direction: "inbound",
          mode: "shared",
        }),
        makeNode("ch", EWorkflowNodeType.CHANNEL, {}),
      ],
      [makeConn("c1", "t", "ch")],
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) =>
          e.nodeKey === "ch" &&
          e.field === "configuration.direction" &&
          e.code === "REQUIRED",
      ),
    ).toBe(true);
  });

  it("does not flag direction when CHANNEL is properly outbound", () => {
    const flow = makeFlow(
      [
        makeNode("t", EWorkflowNodeType.CHANNEL, {
          direction: "inbound",
          mode: "shared",
        }),
        makeNode("ch", EWorkflowNodeType.CHANNEL, {
          direction: "outbound",
          accountId: "a",
          channel: "whatsapp",
          provider: "meta",
          to: "+1",
          messageType: "text",
        }),
      ],
      [makeConn("c1", "t", "ch")],
    );
    const result = validateWorkflow(flow);
    expect(
      result.errors.some(
        (e) => e.field === "configuration.direction",
      ),
    ).toBe(false);
  });
});
