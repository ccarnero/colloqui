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

  it("places the join node strictly to the right of the parallel path nodes", () => {
    const { nodes } = deserializeFlow(fanoutDto);
    const join = nodeByName(nodes, "join");
    for (const pathNodeName of ["getPost", "getPokemon", "getCatFact"]) {
      expect(join.position.x).toBeGreaterThan(
        nodeByName(nodes, pathNodeName).position.x
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
});

describe("deserializeFlow — trigger", () => {
  it("creates a channel node in inbound mode for the trigger", () => {
    const { nodes } = deserializeFlow({
      trigger: { mode: "shared", config: { channels: ["whatsapp"] } },
      actions: [],
    });
    const trigger = Object.values(nodes).find(
      (n) => n.type === EWorkflowNodeType.CHANNEL
    );
    expect(trigger).toBeDefined();
    expect(trigger?.configuration["direction"]).toBe("inbound");
  });
});
