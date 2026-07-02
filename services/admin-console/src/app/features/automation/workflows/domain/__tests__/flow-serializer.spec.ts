import { deserializeFlow } from "../flow-deserializer";
import { serializeFlow } from "../flow-serializer";
import type { IWorkflowFlow } from "../workflow-node.types";

function toFlow(
  deserialized: ReturnType<typeof deserializeFlow>
): IWorkflowFlow {
  return {
    key: "wf",
    name: "wf",
    application: "default",
    nodes: deserialized.nodes,
    connections: deserialized.connections,
  };
}

describe("serializeFlow — round trip with a fan-out branch", () => {
  const fanoutDto = {
    trigger: null,
    actions: [
      {
        name: "fanout",
        activity: "branch",
        jsonplaceholder: [
          { name: "getPost", activity: "endpointCall", args: {} },
        ],
        pokeapi: [{ name: "getPokemon", activity: "endpointCall", args: {} }],
        catfacts: [{ name: "getCatFact", activity: "endpointCall", args: {} }],
      },
      { name: "join", activity: "jsFunction", args: { code: "" } },
      { name: "postToHttpbin", activity: "endpointCall", args: {} },
      { name: "notify", activity: "channelSend", args: { type: "text" } },
    ],
  };

  it("keeps the branch paths under the same keys and the trailing trunk order", () => {
    const flow = toFlow(deserializeFlow(fanoutDto));
    const { actions } = serializeFlow(flow);

    expect(actions.length).toBe(4);
    expect(actions[0].activity).toBe("branch");

    const branch = actions[0] as Record<
      string,
      Array<{ name: string; activity: string }>
    >;
    expect(branch["jsonplaceholder"][0].name).toBe("getPost");
    expect(branch["jsonplaceholder"][0].activity).toBe("endpointCall");
    expect(branch["pokeapi"][0].name).toBe("getPokemon");
    expect(branch["pokeapi"][0].activity).toBe("endpointCall");
    expect(branch["catfacts"][0].name).toBe("getCatFact");
    expect(branch["catfacts"][0].activity).toBe("endpointCall");

    expect(actions[1].name).toBe("join");
    expect(actions[1].activity).toBe("jsFunction");
    expect(actions[2].name).toBe("postToHttpbin");
    expect(actions[2].activity).toBe("endpointCall");
    expect(actions[3].name).toBe("notify");
    expect(actions[3].activity).toBe("channelSend");
  });
});

describe("serializeFlow — empty-path branch", () => {
  const emptyPathDto = {
    trigger: null,
    actions: [
      {
        name: "check",
        activity: "branch",
        pathA: [],
        pathB: [{ name: "doWork", activity: "jsFunction", args: {} }],
      },
      { name: "afterBranch", activity: "jsFunction", args: {} },
    ],
  };

  it("emits the empty path and keeps the next action on the trunk", () => {
    const flow = toFlow(deserializeFlow(emptyPathDto));
    const { actions } = serializeFlow(flow);

    expect(actions.length).toBe(2);
    const branchAction = actions[0] as Record<string, unknown>;
    expect(branchAction["activity"]).toBe("branch");

    const pathValues = Object.entries(branchAction).filter(
      ([key]) => !["activity", "name"].includes(key)
    );
    const emptyPaths = pathValues.filter(
      ([, v]) => Array.isArray(v) && v.length === 0
    );
    const nonEmptyPaths = pathValues.filter(
      ([, v]) => Array.isArray(v) && v.length > 0
    );
    expect(emptyPaths.length).toBe(1);
    expect(nonEmptyPaths.length).toBe(1);
    expect((nonEmptyPaths[0][1] as Array<{ name: string }>)[0].name).toBe(
      "doWork"
    );

    expect(actions[1].name).toBe("afterBranch");
  });
});

describe("serializeFlow — nested branch inside a branch path", () => {
  const nestedDto = {
    trigger: null,
    actions: [
      {
        name: "outer",
        activity: "branch",
        pathX: [
          {
            name: "inner",
            activity: "branch",
            innerA: [{ name: "stepA", activity: "jsFunction", args: {} }],
            innerB: [{ name: "stepB", activity: "jsFunction", args: {} }],
          },
        ],
        pathY: [{ name: "stepY", activity: "jsFunction", args: {} }],
      },
      { name: "afterOuter", activity: "jsFunction", args: {} },
    ],
  };

  it("converges the nested branch and keeps the trailing action on the trunk", () => {
    const flow = toFlow(deserializeFlow(nestedDto));
    const { actions } = serializeFlow(flow);

    expect(actions.length).toBe(2);
    expect(actions[0].activity).toBe("branch");
    expect(actions[0].name).toBe("outer");

    const outer = actions[0] as Record<string, unknown>;
    const pathXActions = outer["pathX"] as Array<Record<string, unknown>>;
    expect(pathXActions.length).toBe(1);
    expect(pathXActions[0]["activity"]).toBe("branch");
    expect(pathXActions[0]["name"]).toBe("inner");
    expect((pathXActions[0]["innerA"] as Array<{ name: string }>)[0].name).toBe(
      "stepA"
    );
    expect((pathXActions[0]["innerB"] as Array<{ name: string }>)[0].name).toBe(
      "stepB"
    );

    const pathYActions = outer["pathY"] as Array<Record<string, unknown>>;
    expect(pathYActions.length).toBe(1);
    expect(pathYActions[0]["name"]).toBe("stepY");

    expect(actions[1].name).toBe("afterOuter");
  });
});

describe("serializeFlow — conditional with default followed by a trunk action", () => {
  const conditionalDto = {
    trigger: null,
    actions: [
      {
        name: "route",
        activity: "conditional",
        branches: [
          {
            label: "isVip",
            condition: {
              variable: "user.tier",
              comparator: "eq",
              value: "vip",
            },
            actions: [{ name: "vipStep", activity: "jsFunction", args: {} }],
          },
        ],
        default: [{ name: "defaultStep", activity: "jsFunction", args: {} }],
      },
      { name: "afterRoute", activity: "jsFunction", args: {} },
    ],
  };

  it("preserves branch condition and default target, and converges to the trunk", () => {
    const flow = toFlow(deserializeFlow(conditionalDto));
    const { actions } = serializeFlow(flow);

    expect(actions.length).toBe(2);
    expect(actions[0].activity).toBe("conditional");

    const conditional = actions[0] as Record<string, unknown>;
    const branches = conditional["branches"] as Array<{
      label: string;
      condition: { variable: string; comparator: string; value: string };
      actions: Array<{ name: string }>;
    }>;
    expect(branches.length).toBe(1);
    expect(branches[0].label).toBe("isVip");
    expect(branches[0].condition).toEqual({
      variable: "user.tier",
      comparator: "eq",
      value: "vip",
    });
    expect(branches[0].actions[0].name).toBe("vipStep");

    const defaultActions = conditional["default"] as Array<{
      name: string;
    }>;
    expect(defaultActions[0].name).toBe("defaultStep");

    expect(actions[1].name).toBe("afterRoute");
  });
});
