import { deserializeFlow } from "../flow-deserializer";
import { EWorkflowNodeType, type IWorkflowNode } from "../workflow-node.types";

function nodeByName(
  nodes: Record<string, IWorkflowNode>,
  name: string
): IWorkflowNode {
  const found = Object.values(nodes).find((n) => n.name === name);
  if (!found) {
    throw new Error(`Node "${name}" not found`);
  }
  return found;
}

function outgoingOf(
  connections: Record<string, { source: string; target: string }>,
  sourceKey: string
): string[] {
  return Object.values(connections)
    .filter((c) => c.source === sourceKey)
    .map((c) => c.target);
}

function hasConnection(
  connections: Record<string, { source: string; target: string }>,
  sourceKey: string,
  targetKey: string
): boolean {
  return outgoingOf(connections, sourceKey).includes(targetKey);
}

function labelOf(
  connections: Record<
    string,
    { source: string; target: string; label?: string }
  >,
  sourceKey: string,
  targetKey: string
): string | undefined {
  return Object.values(connections).find(
    (c) => c.source === sourceKey && c.target === targetKey
  )?.label;
}

describe("deserializeFlow — fan-out branch", () => {
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

  it("gives the branch node exactly 3 outgoing connections (the path heads)", () => {
    const { nodes, connections } = deserializeFlow(fanoutDto);
    const branch = nodeByName(nodes, "fanout");
    expect(outgoingOf(connections, branch.key).length).toBe(3);
  });

  it("links each path node to the join node with exactly one outgoing edge", () => {
    const { nodes, connections } = deserializeFlow(fanoutDto);
    const join = nodeByName(nodes, "join");
    for (const pathNodeName of ["getPost", "getPokemon", "getCatFact"]) {
      const pathNode = nodeByName(nodes, pathNodeName);
      const out = outgoingOf(connections, pathNode.key);
      expect(out.length).toBe(1);
      expect(out[0]).toBe(join.key);
    }
  });

  it("places the join node strictly below the parallel path nodes", () => {
    const { nodes } = deserializeFlow(fanoutDto);
    const join = nodeByName(nodes, "join");
    for (const pathNodeName of ["getPost", "getPokemon", "getCatFact"]) {
      expect(join.position.y).toBeGreaterThan(
        nodeByName(nodes, pathNodeName).position.y
      );
    }
  });

  it("does not create a direct branch -> join connection", () => {
    const { nodes, connections } = deserializeFlow(fanoutDto);
    const branch = nodeByName(nodes, "fanout");
    const join = nodeByName(nodes, "join");
    expect(hasConnection(connections, branch.key, join.key)).toBe(false);
  });

  it("keeps postToHttpbin and notify on the trunk after join", () => {
    const { nodes, connections } = deserializeFlow(fanoutDto);
    const join = nodeByName(nodes, "join");
    const post = nodeByName(nodes, "postToHttpbin");
    const notify = nodeByName(nodes, "notify");
    expect(hasConnection(connections, join.key, post.key)).toBe(true);
    expect(hasConnection(connections, post.key, notify.key)).toBe(true);
  });

  /**
   * Design mockup follow-up (11-builder.png): branch fan-out edges carry the
   * real path key as their label — the same string already stored verbatim
   * in the branch node's own `configuration["branches"]`, not fabricated.
   */
  it("labels each fan-out edge with its real branch path key", () => {
    const { nodes, connections } = deserializeFlow(fanoutDto);
    const branch = nodeByName(nodes, "fanout");
    const getPost = nodeByName(nodes, "getPost");
    const getPokemon = nodeByName(nodes, "getPokemon");
    const getCatFact = nodeByName(nodes, "getCatFact");
    expect(labelOf(connections, branch.key, getPost.key)).toBe(
      "jsonplaceholder"
    );
    expect(labelOf(connections, branch.key, getPokemon.key)).toBe("pokeapi");
    expect(labelOf(connections, branch.key, getCatFact.key)).toBe("catfacts");
  });
});

describe("deserializeFlow — empty-path branch", () => {
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

  it("creates a direct branch -> next edge for the empty path", () => {
    const { nodes, connections } = deserializeFlow(emptyPathDto);
    const branch = nodeByName(nodes, "check");
    const after = nodeByName(nodes, "afterBranch");
    expect(hasConnection(connections, branch.key, after.key)).toBe(true);
  });

  it("still links the non-empty path to the next trunk action", () => {
    const { nodes, connections } = deserializeFlow(emptyPathDto);
    const doWork = nodeByName(nodes, "doWork");
    const after = nodeByName(nodes, "afterBranch");
    expect(hasConnection(connections, doWork.key, after.key)).toBe(true);
  });

  /**
   * The direct branch -> converge edge for an empty path is created
   * generically by the trunk-linking code (shared with every other
   * next-action link), not the branch-specific loop that knows the path
   * name — so no label metadata exists there and none must be invented.
   */
  it("does not invent a label for the empty path's direct branch -> next edge", () => {
    const { nodes, connections } = deserializeFlow(emptyPathDto);
    const branch = nodeByName(nodes, "check");
    const after = nodeByName(nodes, "afterBranch");
    expect(labelOf(connections, branch.key, after.key)).toBeUndefined();
  });
});

describe("deserializeFlow — conditional edge labels", () => {
  const conditionalDto = {
    trigger: null,
    actions: [
      {
        name: "priceCheck",
        activity: "conditional",
        branches: [
          {
            label: "cheap",
            condition: {
              variable: "request.text",
              comparator: "contains",
              value: "precio",
            },
            actions: [{ name: "replyCheap", activity: "jsFunction", args: {} }],
          },
        ],
        default: [{ name: "replyDefault", activity: "jsFunction", args: {} }],
      },
    ],
  };

  /**
   * Design mockup follow-up (11-builder.png): the mockup shows the
   * condition text riding the edge (e.g. `request.text contains "precio"`).
   * Derived verbatim from the branch's own real condition rule.
   */
  it("labels a real conditional branch edge with its condition text", () => {
    const { nodes, connections } = deserializeFlow(conditionalDto);
    const node = nodeByName(nodes, "priceCheck");
    const replyCheap = nodeByName(nodes, "replyCheap");
    expect(labelOf(connections, node.key, replyCheap.key)).toBe(
      'request.text contains "precio"'
    );
  });

  /**
   * "default" is the real semantic meaning of this path (the conditional's
   * else/default branch) — a literal, honest label, not an invented one.
   */
  it("labels the default-path edge literally as 'default'", () => {
    const { nodes, connections } = deserializeFlow(conditionalDto);
    const node = nodeByName(nodes, "priceCheck");
    const replyDefault = nodeByName(nodes, "replyDefault");
    expect(labelOf(connections, node.key, replyDefault.key)).toBe("default");
  });
});

describe("deserializeFlow — trigger", () => {
  it("creates a channel node in inbound mode for the trigger", () => {
    const { nodes } = deserializeFlow({
      trigger: { mode: "shared", config: { channels: ["telegram"] } },
      actions: [],
    });
    const trigger = Object.values(nodes).find(
      (n) => n.type === EWorkflowNodeType.CHANNEL
    );
    expect(trigger).toBeDefined();
    expect(trigger?.configuration["direction"]).toBe("inbound");
  });
});
