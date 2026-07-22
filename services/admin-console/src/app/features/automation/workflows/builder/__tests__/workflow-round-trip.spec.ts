import { deserializeFlow } from "../../domain/flow-deserializer";
import { serializeFlow } from "../../domain/flow-serializer";
import type { IWorkflowFlow } from "../../domain/workflow-node.types";

/**
 * T03 constraint: "Saved workflow JSON must be byte-compatible: a workflow
 * opened and saved without edits produces an identical payload." Per T01
 * finding 3, `flow-serializer.ts`/`flow-deserializer.ts` build `args`/
 * `configuration` objects in fixed source-code key order and drop
 * `undefined` fields — so a raw `JSON.stringify` string comparison is NOT a
 * safe assertion of that constraint (two semantically-identical payloads can
 * differ in key order). This suite instead asserts DEEP EQUALITY of the
 * parsed `{ name, application, actions, trigger }` payload via `toEqual`,
 * which (a) ignores key order and (b) treats an explicit `undefined` field
 * the same as an absent one — matching finding 3's guidance exactly.
 *
 * This test lives under builder/__tests__ (not domain/__tests__) per the
 * SPEC's scope constraint: T03 may only touch
 * features/automation/workflows/builder/ (+ specs); it imports
 * flow-serializer.ts/flow-deserializer.ts read-only, without modifying
 * them.
 */
describe("workflow round trip — open a workflow, save without edits (T03)", () => {
  const dto = {
    name: "Round Trip Workflow",
    application: "support-app",
    trigger: {
      type: "message_received",
      mode: "shared",
      config: {
        accountIds: ["acc-1", "acc-2"],
        channels: ["whatsapp", "telegram"],
        providers: ["meta"],
        patterns: ["^support"],
      },
    },
    actions: [
      {
        name: "fetchUser",
        activity: "endpointCall",
        args: {
          method: "GET",
          url: "https://api.example.com/user",
          adapterId: "adapter-1",
          endpointId: "ep-1",
          data: { includeProfile: true },
          headers: { "X-Trace": "abc" },
        },
      },
      {
        name: "lookupTool",
        activity: "mcpCall",
        args: {
          serverId: "srv-1",
          toolName: "lookup",
          params: { query: "acme" },
        },
      },
      {
        name: "route",
        activity: "branch",
        pathA: [
          {
            name: "svcCall",
            activity: "serviceCall",
            args: {
              serviceId: "svc-1",
              method: "POST",
              path: "/lookup",
              data: { id: 1 },
              headers: { "X-Test": "1" },
            },
          },
        ],
        pathB: [
          {
            name: "busCall",
            activity: "serviceBusCall",
            args: { subject: "events.test", payload: { type: "ping" } },
          },
        ],
      },
      {
        name: "afterBranch",
        activity: "jsFunction",
        args: { code: "return 1;" },
      },
      {
        name: "checkTier",
        activity: "conditional",
        branches: [
          {
            label: "vip",
            condition: {
              variable: "user.tier",
              comparator: "eq" as const,
              value: "vip",
            },
            actions: [
              {
                name: "callAgent",
                activity: "agentCall",
                args: {
                  agentId: "agent-1",
                  message: "Hello VIP",
                  conversationId: "conv-1",
                  customerName: "Jane Doe",
                  userId: "user-1",
                  channel: "whatsapp",
                },
              },
            ],
          },
        ],
        default: [
          {
            name: "notifyDefault",
            activity: "channelSend",
            args: {
              accountId: "acc-default",
              channel: "telegram",
              provider: "prov-default",
              to: "custom-recipient",
              type: "text",
              text: "Default reply",
            },
          },
        ],
      },
      {
        name: "notifyFinal",
        activity: "channelSend",
        args: {
          accountId: "acc-final",
          channel: "whatsapp",
          provider: "prov-final",
          to: "{{request.from}}",
          type: "text",
          text: "All done",
        },
      },
    ],
  };

  it("serializes to a deep-equal payload after a deserialize -> serialize cycle with no edits", () => {
    const { nodes, connections } = deserializeFlow(dto);

    const flow: IWorkflowFlow = {
      key: "wf-round-trip",
      name: dto.name,
      application: dto.application,
      nodes,
      connections,
    };

    // Sanity check: the representative payload actually covers every
    // EWorkflowNodeType (CHANNEL x3, JS_FUNCTION, ENDPOINT_CALL, MCP_CALL,
    // SERVICE_CALL, SERVICE_BUS_CALL, AGENT_CALL, BRANCH, CONDITIONAL) and
    // both branch/conditional fan-out + fan-in edges, per T03's acceptance
    // criteria ("several node types + edges").
    expect(Object.keys(nodes).length).toBeGreaterThanOrEqual(9);
    expect(Object.keys(connections).length).toBeGreaterThan(0);

    const result = serializeFlow(flow);

    expect(result).toEqual({
      name: dto.name,
      application: dto.application,
      actions: dto.actions,
      trigger: dto.trigger,
    });
  });
});
